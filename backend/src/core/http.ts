import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { register as registerSystem } from '../system/routes.ts';
import { createAccessPreHandler } from './access.ts';
import type { AppContext } from './context.ts';
import { hashCredential, SESSION_COOKIE, sessionTheme } from './credentials.ts';
import { domains } from './domains.ts';
import { hidePrices } from './hide-prices.ts';
import { createErrorHandler, problem } from './problems.ts';

const BODY_LIMIT_BYTES = 1_048_576;
const FRONTEND_DIST = fileURLToPath(new URL('../../../frontend/dist/', import.meta.url));
const REQUEST_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const;

const PUBLIC_ROOT_FILES = [
  'favicon.ico',
  'favicon.svg',
  'favicon-32.png',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'prepaint.js',
] as const;
const PUBLIC_ROOT_MAX_AGE = '1h';

const NON_APP_PREFIXES = ['/api/', '/media/', '/m/', '/assets/'] as const;

function requestId(): string {
  return `r-${Array.from(randomBytes(12), (byte) => REQUEST_ID_ALPHABET[byte & 31]).join('')}`;
}

function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

interface IndexTemplate {
  render(basePath: string, scheme: 'light' | 'dark' | null): string;
}

function loadIndexTemplate(): IndexTemplate {
  const html = readFileSync(`${FRONTEND_DIST}index.html`, 'utf8');
  const scheme = /<html\b[^>]*?\sdata-color-scheme="([^"]*)"/.exec(html);
  const base = /<base\s+href="([^"]*)"/.exec(html);
  if (scheme === null || base === null || base.index < scheme.index) {
    throw new Error('frontend/dist/index.html lacks the <html data-color-scheme> or <base href> placeholder');
  }
  const schemeValue = scheme.index + scheme[0].length - 1 - scheme[1].length;
  const baseValue = base.index + base[0].length - 1 - base[1].length;
  const beforeScheme = html.slice(0, schemeValue);
  const schemeToBase = html.slice(schemeValue + scheme[1].length, baseValue);
  const afterBase = html.slice(baseValue + base[1].length);
  return {
    render(basePath, colorScheme) {
      return `${beforeScheme}${colorScheme ?? ''}${schemeToBase}${basePath}/${afterBase}`;
    },
  };
}

export function buildHttp(ctx: AppContext): FastifyInstance {
  const { basePath, trustedProxies } = ctx.settings;
  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    requestIdHeader: false,
    genReqId: requestId,
    trustProxy:
      trustedProxies.length === 0
        ? false
        : (address: string) => trustedProxies.some((range) => range.contains(address)),
  });
  const index = loadIndexTemplate();
  const appPath = (url: string): string | null => {
    const path = pathOf(url);
    if (basePath === '') {
      return path;
    }
    if (path === basePath) {
      return '/';
    }
    return path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : null;
  };

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(fastifyCookie);
  app.register(fastifyMultipart);
  app.decorate('uploadDir', join(ctx.settings.dataDir, 'tmp'));
  app.decorateRequest('person', null);

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('X-Request-Id', request.id);
    done();
  });
  app.addHook('onRequest', createAccessPreHandler(ctx));
  app.addHook('preSerialization', hidePrices);
  app.addHook('onSend', (request, reply, payload, done) => {
    if (appPath(request.url)?.startsWith('/api/v1/') === true) {
      reply.headers(SECURITY_HEADERS);
      reply.header('Cache-Control', 'no-store');
    }
    done(null, payload);
  });
  app.addHook('onResponse', (request, reply, done) => {
    const path = pathOf(request.url);
    const relative = appPath(request.url);
    const quiet = relative === '/healthcheck' || relative?.startsWith('/m/_/') === true;
    (quiet ? ctx.log.debug : ctx.log.info)('request', {
      reqId: request.id,
      method: request.method,
      path,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      personId: request.person?.id ?? null,
    });
    done();
  });

  app.setErrorHandler(createErrorHandler(ctx.log, BODY_LIMIT_BYTES));
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    if (appPath(request.url)?.startsWith('/api/') === true) {
      throw problem('not_found');
    }
    return reply.code(404).send();
  });

  app.register(
    (scope, _options, done) => {
      scope.register(fastifyStatic, {
        root: `${FRONTEND_DIST}assets`,
        prefix: '/assets/',
        immutable: true,
        maxAge: '365d',
        preCompressed: true,
        index: false,
      });
      const serveIndex = (request: FastifyRequest, reply: FastifyReply) => {
        const relative = appPath(request.url) ?? '';
        if (relative === '/healthcheck' || NON_APP_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
          reply.callNotFound();
          return reply;
        }
        const cookie = request.cookies[SESSION_COOKIE];
        const scheme =
          cookie === undefined || cookie === '' ? null : sessionTheme(ctx.db, hashCredential(cookie), ctx.now());
        return reply
          .headers(SECURITY_HEADERS)
          .header('Cache-Control', 'no-cache')
          .type('text/html; charset=utf-8')
          .send(index.render(basePath, scheme));
      };
      for (const file of PUBLIC_ROOT_FILES) {
        scope.get(`/${file}`, (_request, reply) =>
          reply.sendFile(file, FRONTEND_DIST, { maxAge: PUBLIC_ROOT_MAX_AGE, immutable: false }),
        );
      }
      scope.get('/', serveIndex);
      scope.get('/*', serveIndex);
      registerSystem(scope, ctx);
      for (const module of domains) {
        module.register(scope, ctx);
      }
      done();
    },
    { prefix: basePath },
  );

  return app;
}
