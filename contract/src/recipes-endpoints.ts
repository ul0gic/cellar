import type { Endpoint } from './endpoints.ts';

export const recipesEndpoints = {
  listRecipes: { method: 'GET', path: '/api/v1/recipes', access: 'session' },
  getRecipe: { method: 'GET', path: '/api/v1/recipes/{id}', access: 'session' },
  createRecipe: { method: 'POST', path: '/api/v1/recipes', access: 'session' },
  replaceRecipe: { method: 'PUT', path: '/api/v1/recipes/{id}', access: 'session' },
  deleteRecipe: { method: 'DELETE', path: '/api/v1/recipes/{id}', access: 'session' },
  addMissingToShoppingList: {
    method: 'POST',
    path: '/api/v1/recipes/{id}/missing-to-shopping-list',
    access: 'session',
  },
} as const satisfies Readonly<Record<string, Endpoint>>;
