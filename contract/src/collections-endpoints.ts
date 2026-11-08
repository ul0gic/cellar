import type { Endpoint } from './endpoints.ts';

export const collectionsEndpoints = {
  listCollections: { method: 'GET', path: '/api/v1/collections', access: 'session' },
  createCollection: { method: 'POST', path: '/api/v1/collections', access: 'session' },
  getCollection: { method: 'GET', path: '/api/v1/collections/{id}', access: 'session' },
  updateCollection: { method: 'PATCH', path: '/api/v1/collections/{id}', access: 'creator' },
  deleteCollection: { method: 'DELETE', path: '/api/v1/collections/{id}', access: 'creator' },
  addRecipeToCollection: { method: 'POST', path: '/api/v1/collections/{id}/recipes', access: 'creator' },
  removeRecipeFromCollection: {
    method: 'DELETE',
    path: '/api/v1/collections/{id}/recipes/{recipeId}',
    access: 'creator',
  },
  calculateParty: { method: 'POST', path: '/api/v1/party-calculator', access: 'session' },
  listCalculators: { method: 'GET', path: '/api/v1/calculators', access: 'session' },
  getCalculator: { method: 'GET', path: '/api/v1/calculators/{id}', access: 'session' },
  createCalculator: { method: 'POST', path: '/api/v1/calculators', access: 'session' },
  replaceCalculator: { method: 'PUT', path: '/api/v1/calculators/{id}', access: 'creator' },
  deleteCalculator: { method: 'DELETE', path: '/api/v1/calculators/{id}', access: 'creator' },
} as const satisfies Readonly<Record<string, Endpoint>>;
