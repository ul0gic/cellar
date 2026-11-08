import type { Endpoint } from './endpoints.ts';

export const searchEndpoints = {
  search: { method: 'GET', path: '/api/v1/search', access: 'session' },
} as const satisfies Readonly<Record<string, Endpoint>>;
