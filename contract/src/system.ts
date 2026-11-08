import { z } from 'zod';
import type { RouteSchema } from './routes.ts';
import type { systemEndpoints } from './system-endpoints.ts';

export const HealthcheckResponseSchema = z
  .object({
    status: z.enum(['ok', 'restoring']),
    version: z.string(),
  })
  .meta({ id: 'HealthcheckResponse' });
export type HealthcheckResponse = z.infer<typeof HealthcheckResponseSchema>;

export const OpenApiDocumentSchema = z.record(z.string(), z.unknown()).meta({ id: 'OpenApiDocument' });
export type OpenApiDocument = Readonly<z.infer<typeof OpenApiDocumentSchema>>;

export const systemRoutes = {
  healthcheck: {
    responses: { 200: HealthcheckResponseSchema },
    errors: [],
    summary: 'Check that Cellar is running',
    tag: 'system',
  },
  getOpenApiDocument: {
    responses: { 200: OpenApiDocumentSchema },
    errors: [],
    summary: "Get this install's OpenAPI document",
    tag: 'system',
  },
} as const satisfies Record<keyof typeof systemEndpoints, RouteSchema>;
