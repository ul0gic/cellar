import type { Endpoint } from './endpoints.ts';

export const bottlesEndpoints = {
  listBottles: { method: 'GET', path: '/api/v1/bottles', access: 'session' },
  getBottle: { method: 'GET', path: '/api/v1/bottles/{id}', access: 'session' },
  createBottles: { method: 'POST', path: '/api/v1/bottles', access: 'session' },
  updateBottle: { method: 'PATCH', path: '/api/v1/bottles/{id}', access: 'session' },
  deleteBottle: { method: 'DELETE', path: '/api/v1/bottles/{id}', access: 'session' },
  openBottle: { method: 'POST', path: '/api/v1/bottles/{id}/open', access: 'session' },
  finishBottle: { method: 'POST', path: '/api/v1/bottles/{id}/finish', access: 'session' },
  reopenBottle: { method: 'POST', path: '/api/v1/bottles/{id}/reopen', access: 'session' },
  bulkBottles: { method: 'POST', path: '/api/v1/bottles/bulk', access: 'session' },
} as const satisfies Readonly<Record<string, Endpoint>>;
