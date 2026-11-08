import type { Endpoint } from './endpoints.ts';

export const backupEndpoints = {
  downloadBackup: { method: 'GET', path: '/api/v1/backup', access: 'owner' },
  uploadRestore: { method: 'POST', path: '/api/v1/restore/uploads', access: 'owner' },
  startRestore: { method: 'POST', path: '/api/v1/restore', access: 'owner' },
} as const satisfies Readonly<Record<string, Endpoint>>;

export const RESTORE_CONFIRMATION = 'replace everything';
