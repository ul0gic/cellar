export const BASE = process.env.CELLAR_BASE ?? 'http://localhost:8082';

export interface Reply {
  status: number;
  headers: Headers;
  text: string;
  // biome-ignore lint/suspicious/noExplicitAny: test helper reads untyped API JSON
  json: any;
  ms: number;
}

export class Client {
  cookie = '';
  bearer = '';
  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply> {
    const headers: Record<string, string> = { ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    let payload: string | undefined;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const t0 = performance.now();
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
    const text = await res.text();
    const ms = performance.now() - t0;
    const set = res.headers.getSetCookie();
    for (const c of set) {
      const pair = c.split(';')[0];
      if (pair.startsWith('cellar_session=') || pair.includes('session')) this.cookie = pair;
    }
    // biome-ignore lint/suspicious/noExplicitAny: test helper reads untyped API JSON
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, text, json, ms };
  }
  get = (p: string, extra?: Record<string, string>) => this.call('GET', p, undefined, extra);
  post = (p: string, b?: unknown, extra?: Record<string, string>) => this.call('POST', p, b ?? {}, extra);
  put = (p: string, b?: unknown) => this.call('PUT', p, b ?? {});
  patch = (p: string, b?: unknown) => this.call('PATCH', p, b ?? {});
  del = (p: string) => this.call('DELETE', p);
}

export function pct(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

export function out(...parts: unknown[]): void {
  process.stdout.write(`${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
}
