import type { Endpoint } from './endpoints.ts';

export const settingsEndpoints = {
  getSettings: { method: 'GET', path: '/api/v1/settings', access: 'owner' },
  updateSettings: { method: 'PATCH', path: '/api/v1/settings', access: 'owner' },
  setRequireLogin: { method: 'PUT', path: '/api/v1/settings/require-login', access: 'owner' },
  saveAiKey: { method: 'PUT', path: '/api/v1/settings/ai-key', access: 'owner' },
  removeAiKey: { method: 'DELETE', path: '/api/v1/settings/ai-key', access: 'owner' },
  getAbout: { method: 'GET', path: '/api/v1/about', access: 'session' },
  listNotifications: { method: 'GET', path: '/api/v1/notifications', access: 'session' },
  dismissNotification: { method: 'DELETE', path: '/api/v1/notifications/{id}', access: 'owner' },
  getJob: { method: 'GET', path: '/api/v1/jobs/{id}', access: 'owner' },
} as const satisfies Readonly<Record<string, Endpoint>>;
