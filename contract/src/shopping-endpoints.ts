import type { Endpoint } from './endpoints.ts';

export const shoppingEndpoints = {
  listSubstitutions: { method: 'GET', path: '/api/v1/substitutions', access: 'session' },
  createSubstitution: { method: 'POST', path: '/api/v1/substitutions', access: 'session' },
  deleteSubstitution: { method: 'DELETE', path: '/api/v1/substitutions/{id}', access: 'session' },
  getBuyNext: { method: 'GET', path: '/api/v1/buy-next', access: 'session' },
  getShoppingList: { method: 'GET', path: '/api/v1/shopping-list', access: 'session' },
  addToShoppingList: { method: 'POST', path: '/api/v1/shopping-list/items', access: 'session' },
  updateShoppingItem: { method: 'PATCH', path: '/api/v1/shopping-list/items/{id}', access: 'session' },
  checkOffShoppingItem: { method: 'DELETE', path: '/api/v1/shopping-list/items/{id}', access: 'session' },
} as const satisfies Readonly<Record<string, Endpoint>>;
