import type { Endpoint } from './endpoints.ts';

export const notesEndpoints = {
  listRecipeNotes: { method: 'GET', path: '/api/v1/recipes/{id}/notes', access: 'session' },
  listIngredientNotes: { method: 'GET', path: '/api/v1/ingredients/{id}/notes', access: 'session' },
  createRecipeNote: { method: 'POST', path: '/api/v1/recipes/{id}/notes', access: 'session' },
  createIngredientNote: { method: 'POST', path: '/api/v1/ingredients/{id}/notes', access: 'session' },
  updateNote: { method: 'PATCH', path: '/api/v1/notes/{id}', access: 'creator' },
  deleteNote: { method: 'DELETE', path: '/api/v1/notes/{id}', access: 'creator' },
  rateRecipe: { method: 'PUT', path: '/api/v1/recipes/{id}/rating', access: 'session' },
  rateIngredient: { method: 'PUT', path: '/api/v1/ingredients/{id}/rating', access: 'session' },
  clearRecipeRating: { method: 'DELETE', path: '/api/v1/recipes/{id}/rating', access: 'session' },
  clearIngredientRating: { method: 'DELETE', path: '/api/v1/ingredients/{id}/rating', access: 'session' },
  favoriteRecipe: { method: 'PUT', path: '/api/v1/recipes/{id}/favorite', access: 'session' },
  unfavoriteRecipe: { method: 'DELETE', path: '/api/v1/recipes/{id}/favorite', access: 'session' },
  recordMadeIt: { method: 'POST', path: '/api/v1/recipes/{id}/made-it', access: 'session' },
  undoMadeIt: { method: 'DELETE', path: '/api/v1/made-it/{entryId}', access: 'creator' },
} as const satisfies Readonly<Record<string, Endpoint>>;
