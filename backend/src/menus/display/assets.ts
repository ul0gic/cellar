import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { acceptsGzip } from './compress.ts';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const VERSION_HEX_CHARS = 12;
const FONTS = ['Gloock-Regular-tv.woff2', 'HankenGrotesk-tv.woff2'] as const;

interface Asset {
  readonly type: string;
  readonly body: Buffer;
  readonly gzip: Buffer | null;
}

function load(file: string, type: string, compress: boolean): Asset {
  const body = readFileSync(new URL(file, import.meta.url));
  return { type, body, gzip: compress ? gzipSync(body) : null };
}

function send(asset: Asset, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  reply.header('Cache-Control', IMMUTABLE).header('X-Content-Type-Options', 'nosniff').type(asset.type);
  if (asset.gzip === null) {
    return reply.send(asset.body);
  }
  reply.header('Vary', 'Accept-Encoding');
  return acceptsGzip(request) ? reply.header('Content-Encoding', 'gzip').send(asset.gzip) : reply.send(asset.body);
}

export function registerDisplayAssets(app: FastifyInstance): string {
  const css = load('./display.css', 'text/css; charset=utf-8', true);
  const extraCss = load('./display-extra.css', 'text/css; charset=utf-8', true);
  const js = load('./display.js', 'text/javascript; charset=utf-8', true);
  const version = createHash('sha256')
    .update(css.body)
    .update(extraCss.body)
    .update(js.body)
    .digest('hex')
    .slice(0, VERSION_HEX_CHARS);
  app.get(`/m/_/display-${version}.css`, (request, reply) => send(css, request, reply));
  app.get(`/m/_/display-extra-${version}.css`, (request, reply) => send(extraCss, request, reply));
  app.get(`/m/_/display-${version}.js`, (request, reply) => send(js, request, reply));
  for (const font of FONTS) {
    const asset = load(`./fonts/${font}`, 'font/woff2', false);
    app.get(`/m/_/fonts/${font}`, (request, reply) => send(asset, request, reply));
  }
  return version;
}
