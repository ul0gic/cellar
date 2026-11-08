import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { hashCredential, SESSION_COOKIE } from '../core/credentials.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import { applyCatalogVersion } from './apply.ts';
import { catalogStatus, runCheck } from './check.ts';
import { startCatalogLoad } from './loader.ts';
import { shippedRelease } from './release.ts';
import { startCatalogSchedule } from './schedule.ts';

function sessionHashOf(request: Pick<FastifyRequest, 'cookies'>): string | null {
  const cookie = request.cookies[SESSION_COOKIE];
  return cookie === undefined || cookie === '' ? null : hashCredential(cookie);
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  const stopSchedule = startCatalogSchedule(ctx);
  app.addHook('onClose', (_instance, done) => {
    stopSchedule();
    done();
  });

  route(app, 'getCatalogStatus', () => Promise.resolve(catalogStatus(ctx)));

  route(app, 'loadCatalog', (request) => {
    const { version } = shippedRelease(ctx.settings).manifest;
    if (
      ctx.jobs.running() === null &&
      ctx.db.prepare('SELECT 1 FROM catalog_loads WHERE version = ?').get(version) !== undefined
    ) {
      throw problem('catalog_loaded');
    }
    return Promise.resolve(startCatalogLoad(ctx, sessionHashOf(request)));
  });

  route(app, 'checkCatalog', async () => {
    await runCheck(ctx);
    return catalogStatus(ctx);
  });

  route(app, 'applyCatalogUpdate', (request) => {
    const { version } = request.body;
    if (catalogStatus(ctx).available?.version !== version) {
      throw problem('catalog_update_unavailable');
    }
    const job = ctx.jobs.start('catalog_apply', sessionHashOf(request), (progress) =>
      applyCatalogVersion(ctx, version, progress),
    );
    return Promise.resolve(job);
  });
}
