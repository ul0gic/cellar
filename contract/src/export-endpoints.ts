import type { Endpoint } from './endpoints.ts';

export const exportEndpoints = {
  exportBottles: { method: 'GET', path: '/api/v1/export/bottles.csv', access: 'session' },
  exportIngredients: { method: 'GET', path: '/api/v1/export/ingredients.csv', access: 'session' },
  exportRecipes: { method: 'GET', path: '/api/v1/export/recipes.zip', access: 'session' },
} as const satisfies Readonly<Record<string, Endpoint>>;
