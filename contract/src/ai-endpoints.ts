import type { Endpoint } from './endpoints.ts';

export const aiEndpoints = {
  aiDraftRecipe: { method: 'POST', path: '/api/v1/ai/recipe-draft', access: 'session' },
  aiGenerateImage: { method: 'POST', path: '/api/v1/ai/image', access: 'session' },
  aiDrinkHistory: { method: 'POST', path: '/api/v1/ai/history', access: 'session' },
} as const satisfies Readonly<Record<string, Endpoint>>;
