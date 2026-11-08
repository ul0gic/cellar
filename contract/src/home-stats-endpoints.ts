import type { Endpoint } from './endpoints.ts';

export const homeStatsEndpoints = {
  getHome: { method: 'GET', path: '/api/v1/home', access: 'session' },
  getStats: { method: 'GET', path: '/api/v1/stats', access: 'session' },
} as const satisfies Readonly<Record<string, Endpoint>>;
