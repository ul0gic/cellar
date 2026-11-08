import type { Endpoint } from './endpoints.ts';

export const ingredientsEndpoints = {
  getIngredientTree: { method: 'GET', path: '/api/v1/ingredients/tree', access: 'session' },
  listIngredients: { method: 'GET', path: '/api/v1/ingredients', access: 'session' },
  getIngredient: { method: 'GET', path: '/api/v1/ingredients/{id}', access: 'session' },
  createIngredient: { method: 'POST', path: '/api/v1/ingredients', access: 'session' },
  updateIngredient: { method: 'PATCH', path: '/api/v1/ingredients/{id}', access: 'session' },
  deleteIngredient: { method: 'DELETE', path: '/api/v1/ingredients/{id}', access: 'session' },
  setOnHand: { method: 'PUT', path: '/api/v1/ingredients/{id}/on-hand', access: 'session' },
  addIngredientToShoppingList: { method: 'POST', path: '/api/v1/ingredients/{id}/shopping-list', access: 'session' },
} as const satisfies Readonly<Record<string, Endpoint>>;
