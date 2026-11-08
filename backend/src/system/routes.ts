import type { HealthcheckResponse } from '@cellar/contract';
import { buildOpenApiDocument } from '@cellar/contract/schemas';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { route } from '../core/route.ts';

export function register(app: FastifyInstance, ctx: AppContext): void {
  const document = buildOpenApiDocument({ version: ctx.version, basePath: ctx.settings.basePath });
  route(
    app,
    'healthcheck',
    async (): Promise<HealthcheckResponse> => ({
      status: ctx.jobs.running()?.kind === 'restore' ? 'restoring' : 'ok',
      version: ctx.version,
    }),
  );
  route(app, 'getOpenApiDocument', async () => document);
}
