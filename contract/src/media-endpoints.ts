import type { Endpoint } from './endpoints.ts';

export const mediaEndpoints = {
  uploadImage: { method: 'POST', path: '/api/v1/images', access: 'session' },
  fetchImage: { method: 'POST', path: '/api/v1/images/fetch', access: 'session' },
  deleteImage: { method: 'DELETE', path: '/api/v1/images/{id}', access: 'creator' },
  getMedia: { method: 'GET', path: '/media/{file*}', access: 'public' },
} as const satisfies Readonly<Record<string, Endpoint>>;
