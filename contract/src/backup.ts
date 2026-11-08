import { z } from 'zod';
import { type backupEndpoints, RESTORE_CONFIRMATION } from './backup-endpoints.ts';
import { IsoDateTimeSchema } from './primitives.ts';
import type { RouteSchema } from './routes.ts';
import { BackupCountsSchema, BackupManifestSchema, JobSchema } from './jobs.ts';

export const RestoreUploadSchema = z
  .object({
    uploadId: z.uuid({ version: 'v4' }),
    manifest: BackupManifestSchema,
    current: BackupCountsSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .meta({ id: 'RestoreUpload' });
export type RestoreUpload = z.infer<typeof RestoreUploadSchema>;

export const RestoreUploadPartsSchema = z.object({ file: z.file().mime(['application/zip']) });
export type RestoreUploadParts = z.infer<typeof RestoreUploadPartsSchema>;

export const RestoreInputSchema = z
  .strictObject({ uploadId: z.uuid({ version: 'v4' }), confirmation: z.literal(RESTORE_CONFIRMATION) })
  .meta({ id: 'RestoreInput' });
export type RestoreInput = z.infer<typeof RestoreInputSchema>;

export const backupRoutes = {
  downloadBackup: {
    responses: { 200: 'zip' },
    errors: [],
    summary: 'Download a full backup',
    tag: 'backup',
  },
  uploadRestore: {
    body: { multipart: RestoreUploadPartsSchema },
    responses: { 201: RestoreUploadSchema },
    errors: ['payload_too_large', 'unsupported_media_type', 'backup_invalid', 'backup_too_new', 'archive_too_large'],
    summary: 'Upload and check a backup to restore',
    tag: 'backup',
  },
  startRestore: {
    body: RestoreInputSchema,
    responses: { 202: JobSchema },
    errors: ['not_found', 'validation_failed', 'job_running'],
    summary: 'Replace everything with the uploaded backup',
    tag: 'backup',
  },
} as const satisfies Record<keyof typeof backupEndpoints, RouteSchema>;
