import type { Endpoint } from './endpoints.ts';

export const importEndpoints = {
  getCsvTemplate: { method: 'GET', path: '/api/v1/import/templates/{kind}.csv', access: 'session' },
  importCsv: { method: 'POST', path: '/api/v1/import/csv', access: 'session' },
  importRecipes: { method: 'POST', path: '/api/v1/import/recipes', access: 'session' },
  importFromUrl: { method: 'POST', path: '/api/v1/import/url', access: 'session' },
  importFromText: { method: 'POST', path: '/api/v1/import/text', access: 'session' },
} as const satisfies Readonly<Record<string, Endpoint>>;
