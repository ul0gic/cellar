import type { Endpoint } from './endpoints.ts';

export const taxonomyEndpoints = {
  listGlasses: { method: 'GET', path: '/api/v1/glasses', access: 'session' },
  createGlass: { method: 'POST', path: '/api/v1/glasses', access: 'owner' },
  updateGlass: { method: 'PATCH', path: '/api/v1/glasses/{id}', access: 'owner' },
  deleteGlass: { method: 'DELETE', path: '/api/v1/glasses/{id}', access: 'owner' },
  listMethods: { method: 'GET', path: '/api/v1/methods', access: 'session' },
  createMethod: { method: 'POST', path: '/api/v1/methods', access: 'owner' },
  updateMethod: { method: 'PATCH', path: '/api/v1/methods/{id}', access: 'owner' },
  deleteMethod: { method: 'DELETE', path: '/api/v1/methods/{id}', access: 'owner' },
  listUtensils: { method: 'GET', path: '/api/v1/utensils', access: 'session' },
  createUtensil: { method: 'POST', path: '/api/v1/utensils', access: 'owner' },
  updateUtensil: { method: 'PATCH', path: '/api/v1/utensils/{id}', access: 'owner' },
  deleteUtensil: { method: 'DELETE', path: '/api/v1/utensils/{id}', access: 'owner' },
  listTags: { method: 'GET', path: '/api/v1/tags', access: 'session' },
  createTag: { method: 'POST', path: '/api/v1/tags', access: 'owner' },
  updateTag: { method: 'PATCH', path: '/api/v1/tags/{id}', access: 'owner' },
  deleteTag: { method: 'DELETE', path: '/api/v1/tags/{id}', access: 'owner' },
  listDescriptors: { method: 'GET', path: '/api/v1/descriptors', access: 'session' },
  createDescriptor: { method: 'POST', path: '/api/v1/descriptors', access: 'owner' },
  updateDescriptor: { method: 'PATCH', path: '/api/v1/descriptors/{id}', access: 'owner' },
  deleteDescriptor: { method: 'DELETE', path: '/api/v1/descriptors/{id}', access: 'owner' },
} as const satisfies Readonly<Record<string, Endpoint>>;
