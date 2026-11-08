import type { Endpoint } from './endpoints.ts';

export const systemEndpoints = {
  healthcheck: { method: 'GET', path: '/healthcheck', access: 'public' },
  getOpenApiDocument: { method: 'GET', path: '/api/v1/openapi.json', access: 'session' },
} as const satisfies Readonly<Record<string, Endpoint>>;
