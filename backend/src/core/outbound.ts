import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { parseIp, rangesOf } from './ip.ts';
import type { Logger } from './logger.ts';
import type { Settings } from './settings.ts';

export type OutboundErrorCase =
  | 'scheme_refused'
  | 'address_refused'
  | 'too_many_redirects'
  | 'too_large'
  | 'timed_out'
  | 'upstream_status';

export class OutboundError extends Error {
  readonly case: OutboundErrorCase;
  readonly upstreamStatus: number | null;
  readonly body: Uint8Array | null;

  constructor(
    errorCase: OutboundErrorCase,
    message: string,
    upstreamStatus: number | null = null,
    body: Uint8Array | null = null,
  ) {
    super(message);
    this.name = 'OutboundError';
    this.case = errorCase;
    this.upstreamStatus = upstreamStatus;
    this.body = body;
  }
}

export interface OutboundOptions {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly idleMs?: number;
  readonly maxRedirects?: 3;
  readonly allowOnly?: (url: URL) => boolean;
  readonly accept?: string;
  readonly method?: 'GET' | 'POST';
  readonly body?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface OutboundResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
  readonly finalUrl: URL;
}

export interface Outbound {
  fetch(url: string, opts: OutboundOptions): Promise<OutboundResponse>;
}

const REFUSED_RANGES = rangesOf([
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '224.0.0.0/4',
  '255.255.255.255/32',
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
]);

const DEFAULT_MAX_REDIRECTS = 3;
const WRAPPER_HEADERS: ReadonlySet<string> = new Set(['user-agent', 'host', 'content-length']);

function checkCallerOptions(opts: OutboundOptions): void {
  if (opts.headers !== undefined && opts.allowOnly === undefined) {
    throw new Error('outbound.fetch takes caller headers only with allowOnly');
  }
  const owned = Object.keys(opts.headers ?? {}).find((name) => WRAPPER_HEADERS.has(name.toLowerCase()));
  if (owned !== undefined) {
    throw new Error(`outbound.fetch sets ${owned} itself`);
  }
  if (opts.body !== undefined && opts.method !== 'POST') {
    throw new Error('outbound.fetch sends a body only with POST');
  }
}

interface Hop {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

function isRefused(address: string): boolean {
  const parsed = parseIp(address);
  return parsed === null || REFUSED_RANGES.some((range) => range.contains(address));
}

function pinnedLookup(address: string, family: number): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

function headersOf(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function readBody(message: IncomingMessage, maxBytes: number, keepBody: boolean): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const declared = Number.parseInt(message.headers['content-length'] ?? '', 10);
    if (keepBody && Number.isFinite(declared) && declared > maxBytes) {
      message.destroy();
      reject(new OutboundError('too_large', `response declares ${declared} bytes, over ${maxBytes}`));
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    message.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        message.destroy();
        reject(new OutboundError('too_large', `response passed ${maxBytes} bytes`));
        return;
      }
      if (keepBody) {
        chunks.push(chunk);
      }
    });
    message.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    message.on('error', reject);
  });
}

export function createOutbound(settings: Settings, log: Logger, version: string): Outbound {
  const allowedHosts = new Set(settings.outboundAllow);

  const hop = async (url: URL, opts: OutboundOptions, signal: AbortSignal): Promise<Hop> => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new OutboundError('scheme_refused', `scheme ${url.protocol} is not http or https`);
    }
    if (opts.allowOnly !== undefined && !opts.allowOnly(url)) {
      throw new OutboundError('address_refused', 'address is outside the allowed list for this call');
    }
    const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    const addresses = await lookup(hostname, { all: true, order: 'verbatim' });
    const exempt = allowedHosts.has(hostname.toLowerCase());
    if (addresses.length === 0 || (!exempt && addresses.some((entry) => isRefused(entry.address)))) {
      throw new OutboundError('address_refused', 'host resolves to an address Cellar does not contact');
    }
    const target = addresses[0];
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<Hop>((resolve, reject) => {
      const outgoing = send(
        url,
        {
          method: opts.method ?? 'GET',
          headers: {
            ...opts.headers,
            ...(opts.accept === undefined ? {} : { Accept: opts.accept }),
            ...(opts.body === undefined ? {} : { 'Content-Length': String(opts.body.byteLength) }),
            'User-Agent': `Cellar/${version}`,
          },
          lookup: pinnedLookup(target.address, target.family),
          signal,
        },
        (message) => {
          const status = message.statusCode ?? 0;
          const redirect =
            opts.method !== 'POST' && status >= 300 && status < 400 && message.headers.location !== undefined;
          readBody(message, opts.maxBytes, !redirect).then(
            (body) => resolve({ status, headers: headersOf(message), body }),
            reject,
          );
        },
      );
      if (opts.idleMs !== undefined) {
        outgoing.setTimeout(opts.idleMs, () => {
          outgoing.destroy(new OutboundError('timed_out', `no data for ${opts.idleMs} ms`));
        });
      }
      outgoing.on('error', (error) => {
        reject(signal.aborted ? new OutboundError('timed_out', `no answer within ${opts.timeoutMs} ms`) : error);
      });
      outgoing.end(opts.body);
    });
  };

  const run = async (start: URL, opts: OutboundOptions, signal: AbortSignal, visit: (url: URL) => void) => {
    const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    let current = start;
    for (let redirects = 0; ; redirects += 1) {
      visit(current);
      const answer = await hop(current, opts, signal);
      const location = answer.headers.get('location');
      if (opts.method !== 'POST' && answer.status >= 300 && answer.status < 400 && location !== null) {
        if (redirects >= maxRedirects) {
          throw new OutboundError('too_many_redirects', `more than ${maxRedirects} redirects`);
        }
        current = new URL(location, current);
        continue;
      }
      if (answer.status < 200 || answer.status > 299) {
        throw new OutboundError('upstream_status', `answered ${answer.status}`, answer.status, answer.body);
      }
      return { status: answer.status, headers: answer.headers, body: answer.body, finalUrl: current };
    }
  };

  return {
    async fetch(url, opts) {
      checkCallerOptions(opts);
      const started = performance.now();
      let host = '';
      try {
        const parsed = URL.parse(url);
        if (parsed === null) {
          throw new OutboundError('scheme_refused', 'not a URL');
        }
        const response = await run(parsed, opts, AbortSignal.timeout(opts.timeoutMs), (visited) => {
          host = visited.host;
        });
        log.info('outbound', { host, status: response.status, durationMs: Math.round(performance.now() - started) });
        return response;
      } catch (error) {
        const failure =
          error instanceof Error && error.name === 'AbortError'
            ? new OutboundError('timed_out', `no answer within ${opts.timeoutMs} ms`)
            : error;
        log.info('outbound', {
          host,
          ...(failure instanceof OutboundError ? { status: failure.case } : { status: 'network_error', err: failure }),
          durationMs: Math.round(performance.now() - started),
        });
        throw failure;
      }
    },
  };
}
