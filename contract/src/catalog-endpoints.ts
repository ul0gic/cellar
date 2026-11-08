import type { Endpoint } from './endpoints.ts';

export const catalogEndpoints = {
  getCatalogStatus: { method: 'GET', path: '/api/v1/catalog', access: 'owner' },
  loadCatalog: { method: 'POST', path: '/api/v1/catalog/load', access: 'owner' },
  checkCatalog: { method: 'POST', path: '/api/v1/catalog/check', access: 'owner' },
  applyCatalogUpdate: { method: 'POST', path: '/api/v1/catalog/apply', access: 'owner' },
} as const satisfies Readonly<Record<string, Endpoint>>;
