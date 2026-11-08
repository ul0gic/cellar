import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { BackupManifest } from '@cellar/contract';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { hashCredential, SESSION_COOKIE } from '../core/credentials.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import { countRows, streamSnapshot, takeSnapshot } from './backup.ts';
import { checkRestoreArchive, RESTORE_UPLOAD, runRestore } from './restore.ts';

const UPLOAD_LIFETIME_MS = 3_600_000;

interface StagedUpload {
  readonly uploadId: string;
  readonly path: string;
  readonly manifest: BackupManifest;
  readonly expiresAt: Date;
  readonly timer: NodeJS.Timeout;
}

function backupFileName(at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `cellar-backup-${stamp}Z.zip`;
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  let staged: StagedUpload | null = null;

  const discard = async (): Promise<void> => {
    if (staged !== null) {
      clearTimeout(staged.timer);
      staged = null;
    }
    await rm(join(ctx.settings.dataDir, 'tmp', RESTORE_UPLOAD), { force: true });
  };

  route(app, 'downloadBackup', async (_request, reply) => {
    const snapshot = await takeSnapshot(ctx);
    reply.header('Content-Disposition', `attachment; filename="${backupFileName(ctx.now())}"`);
    const body = new PassThrough();
    streamSnapshot(snapshot, body).then(
      () => body.end(),
      (error: unknown) => {
        ctx.log.error('The backup download stopped.', { err: error });
        body.destroy(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return body;
  });

  route(app, 'uploadRestore', async (request) => {
    await discard();
    const path = join(ctx.settings.dataDir, 'tmp', RESTORE_UPLOAD);
    await rename(request.body.file.path, path);
    let manifest: BackupManifest;
    try {
      manifest = await checkRestoreArchive(ctx, path);
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    const expiresAt = new Date(ctx.now().getTime() + UPLOAD_LIFETIME_MS);
    const timer = setTimeout(() => {
      discard().catch((error: unknown) => ctx.log.error('The staged restore upload was not removed.', { err: error }));
    }, UPLOAD_LIFETIME_MS);
    timer.unref();
    const uploadId = randomUUID();
    staged = { uploadId, path, manifest, expiresAt, timer };
    return { uploadId, manifest, current: countRows(ctx.db), expiresAt: expiresAt.toISOString() };
  });

  route(app, 'startRestore', (request) => {
    const upload = staged;
    if (upload === null || upload.uploadId !== request.body.uploadId || upload.expiresAt <= ctx.now()) {
      throw problem('not_found');
    }
    const cookie = request.cookies[SESSION_COOKIE];
    const sessionHash = cookie === undefined || cookie === '' ? null : hashCredential(cookie);
    const job = ctx.jobs.start('restore', sessionHash, async (progress) => {
      try {
        return await runRestore(ctx, upload.path, progress);
      } finally {
        await discard();
      }
    });
    return Promise.resolve(job);
  });
}
