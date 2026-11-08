import type { Endpoint } from './endpoints.ts';
import type { membersEndpoints } from './members-endpoints.ts';

export const setupSessionEndpoints = {
  runSetup: { method: 'POST', path: '/api/v1/setup', access: 'setup' },
  getSession: { method: 'GET', path: '/api/v1/session', access: 'session' },
  login: { method: 'POST', path: '/api/v1/session', access: 'public' },
  chooseProfile: { method: 'POST', path: '/api/v1/session/profile', access: 'profile-picker' },
  logout: { method: 'DELETE', path: '/api/v1/session', access: 'session' },
  listProfiles: { method: 'GET', path: '/api/v1/profiles', access: 'profile-picker' },
} as const satisfies Readonly<Record<string, Endpoint>>;

export const PASSWORD_CHANGE_ALLOWED_OPERATIONS = [
  'getSession',
  'logout',
  'changeMyPassword',
] as const satisfies readonly (keyof typeof setupSessionEndpoints | keyof typeof membersEndpoints)[];
