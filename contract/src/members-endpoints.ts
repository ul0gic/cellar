import type { Endpoint } from './endpoints.ts';

export const membersEndpoints = {
  listMembers: { method: 'GET', path: '/api/v1/members', access: 'session' },
  createMember: { method: 'POST', path: '/api/v1/members', access: 'owner' },
  updateMember: { method: 'PATCH', path: '/api/v1/members/{id}', access: 'owner' },
  resetMemberPassword: { method: 'POST', path: '/api/v1/members/{id}/password-reset', access: 'owner' },
  removeMember: { method: 'DELETE', path: '/api/v1/members/{id}', access: 'owner' },
  getMe: { method: 'GET', path: '/api/v1/me', access: 'session' },
  updateMe: { method: 'PATCH', path: '/api/v1/me', access: 'session' },
  changeMyPassword: { method: 'PUT', path: '/api/v1/me/password', access: 'session' },
  listMyTokens: { method: 'GET', path: '/api/v1/me/tokens', access: 'session' },
  createMyToken: { method: 'POST', path: '/api/v1/me/tokens', access: 'session' },
  revokeMyToken: { method: 'DELETE', path: '/api/v1/me/tokens/{id}', access: 'session' },
} as const satisfies Readonly<Record<string, Endpoint>>;
