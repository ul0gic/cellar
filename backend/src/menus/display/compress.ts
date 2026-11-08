import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function acceptsGzip(request: FastifyRequest): boolean {
  const header = request.headers['accept-encoding'];
  return typeof header === 'string' && /\bgzip\b/i.test(header);
}

export function gzipped(request: FastifyRequest, reply: FastifyReply, body: string): string | Readable {
  reply.header('Vary', 'Accept-Encoding');
  if (!acceptsGzip(request)) {
    return body;
  }
  reply.header('Content-Encoding', 'gzip');
  return Readable.from([gzipSync(body)]);
}
