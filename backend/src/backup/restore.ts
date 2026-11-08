import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
// biome-ignore lint/correctness/noUnresolvedImports: Biome 2.6.6's Node built-in module list lacks node:sqlite
import { backup, DatabaseSync } from 'node:sqlite';
import { type BackupManifest, LIMITS, type RestoreReport } from '@cellar/contract';
import { BackupManifestSchema } from '@cellar/contract/schemas';
import type { JobProgress } from '../core/jobs.ts';
import { isIntact } from '../core/db.ts';
import { migrate } from '../core/migrate.ts';
import { ProblemError, payloadTooLarge, problem } from '../core/problems.ts';
import { ArchiveError, readBoundedZip, type ZipEntry } from './archive.ts';
import {
  CATALOG_ROOT,
  type DataContext,
  DATABASE_FILE,
  freeBytes,
  insufficientStorage,
  MANIFEST_FILE,
  MEDIA_ROOT,
  readSchemaVersion,
} from './backup.ts';

const MANIFEST_MAX_BYTES = 1_048_576;
const RESTORE_PREVIOUS = 'restore-previous';
const RESTORE_EXTRACT = 'restore-extract';
const RESTORE_MARKER = 'restore-in-progress.json';
export const RESTORE_UPLOAD = 'restore-upload.zip';
const DATA_FOLDERS = ['media', 'catalog'] as const;

export class BackupTooNew extends ProblemError {
  readonly backupVersion: string;
  readonly backupSchema: number;

  constructor(manifest: BackupManifest, schemaVersion: number) {
    super(
      'backup_too_new',
      `This backup is from a newer Cellar (schema ${manifest.schemaVersion}). This one is schema ${schemaVersion}. Update Cellar, then restore.`,
      undefined,
      { versions: { backup: manifest.schemaVersion, app: schemaVersion } },
    );
    this.backupVersion = manifest.appVersion;
    this.backupSchema = manifest.schemaVersion;
  }
}

function isBackupPath(path: string): boolean {
  return (
    path === MANIFEST_FILE || path === DATABASE_FILE || path.startsWith(MEDIA_ROOT) || path.startsWith(CATALOG_ROOT)
  );
}

async function entriesOf(path: string): Promise<Map<string, ZipEntry>> {
  const entries = new Map<string, ZipEntry>();
  for await (const entry of readBoundedZip(path, {
    entries: LIMITS.archiveEntries,
    expandedBytes: LIMITS.archiveExpandedBytes,
    allowPath: isBackupPath,
  })) {
    entries.set(entry.path, entry);
  }
  return entries;
}

async function readManifest(entry: ZipEntry): Promise<BackupManifest> {
  if (entry.size > MANIFEST_MAX_BYTES) {
    throw new ArchiveError('unreadable', 'manifest.json is too large');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of await entry.open()) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ArchiveError('unreadable', 'manifest.json is not JSON');
  }
  const parsed = BackupManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ArchiveError('unreadable', 'manifest.json is not a Cellar backup manifest');
  }
  return parsed.data;
}

export async function checkRestoreArchive(ctx: DataContext, path: string): Promise<BackupManifest> {
  const { size } = await stat(path);
  if (size > LIMITS.archiveExpandedBytes) {
    throw payloadTooLarge(LIMITS.archiveExpandedBytes);
  }
  const entries = await entriesOf(path);
  const manifestEntry = entries.get(MANIFEST_FILE);
  if (manifestEntry === undefined || !entries.has(DATABASE_FILE)) {
    throw new ArchiveError('unreadable', 'manifest.json or cellar.db is missing');
  }
  const expanded = [...entries.values()].reduce((sum, entry) => sum + entry.size, 0);
  const free = await freeBytes(ctx.settings.dataDir);
  if (free < expanded) {
    ctx.log.error(`Not enough free disk space to restore: needs ${expanded}, ${free} free.`);
    throw insufficientStorage(expanded, free);
  }
  const manifest = await readManifest(manifestEntry);
  if (manifest.schemaVersion > ctx.schemaVersion) {
    throw new BackupTooNew(manifest, ctx.schemaVersion);
  }
  return manifest;
}

async function extract(entry: ZipEntry, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await pipeline(await entry.open(), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
}

function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type RestorePhase = 'db' | 'files' | 'cleanup';

interface RestoreMarker {
  readonly startedAt: string;
  readonly manifest: BackupManifest;
}

async function writeMarker(marker: string, phase: RestorePhase, about: RestoreMarker): Promise<void> {
  await writeFile(`${marker}.tmp`, JSON.stringify({ phase, ...about }));
  await rename(`${marker}.tmp`, marker);
}

async function copyInto(source: string, target: string): Promise<void> {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, target);
  } finally {
    db.close();
  }
}

async function prepareDatabase(ctx: DataContext, path: string, manifest: BackupManifest, work: string): Promise<void> {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  try {
    if (!isIntact(db)) {
      throw new ArchiveError('unreadable', 'cellar.db is damaged');
    }
    if (readSchemaVersion(db) > ctx.schemaVersion) {
      throw new BackupTooNew(manifest, ctx.schemaVersion);
    }
    await migrate(db, work, ctx.log);
    db.exec('DELETE FROM sessions');
  } finally {
    db.close();
  }
}

export async function runRestore(ctx: DataContext, path: string, progress: JobProgress): Promise<RestoreReport> {
  const started = performance.now();
  const { dataDir } = ctx.settings;
  const tmp = join(dataDir, 'tmp');
  const previous = join(tmp, RESTORE_PREVIOUS);
  const work = join(tmp, RESTORE_EXTRACT);
  const marker = join(tmp, RESTORE_MARKER);
  const live = join(dataDir, DATABASE_FILE);
  const manifest = await checkRestoreArchive(ctx, path);
  const entries = await entriesOf(path);
  const database = entries.get(DATABASE_FILE);
  if (database === undefined) {
    throw new ArchiveError('unreadable', 'cellar.db is missing');
  }
  const dataFiles = [...entries.values()].filter(
    (entry) => !entry.path.endsWith('/') && entry.path !== MANIFEST_FILE && entry.path !== DATABASE_FILE,
  );

  const about: RestoreMarker = { startedAt: new Date().toISOString(), manifest };
  let phase: RestorePhase | null = null;
  const moved: string[] = [];
  try {
    progress.step('Putting your current data aside', null);
    await rm(previous, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
    await mkdir(previous, { recursive: true });
    await backup(ctx.db, join(previous, DATABASE_FILE));

    progress.step('Restoring the database', null);
    const extracted = join(work, DATABASE_FILE);
    await extract(database, extracted);

    progress.step('Restoring images', dataFiles.length);
    let done = 0;
    for (const entry of dataFiles) {
      await extract(entry, join(work, entry.path));
      done += 1;
      progress.done(done);
    }
    for (const folder of DATA_FOLDERS) {
      await mkdir(join(work, folder), { recursive: true });
    }
    await mkdir(join(work, 'media', 'u'), { recursive: true });

    progress.step('Updating the database', null);
    await prepareDatabase(ctx, extracted, manifest, work);
    phase = 'db';
    await writeMarker(marker, phase, about);
    await copyInto(extracted, live);
    phase = 'files';
    await writeMarker(marker, phase, about);
    for (const folder of DATA_FOLDERS) {
      if (existsSync(join(dataDir, folder))) {
        await rename(join(dataDir, folder), join(previous, folder));
        moved.push(folder);
      }
      await rename(join(work, folder), join(dataDir, folder));
    }
    phase = 'cleanup';
    await writeMarker(marker, phase, about);
  } catch (error) {
    ctx.log.error('The restore failed; putting the previous data back.', { err: error });
    try {
      if (phase === 'files') {
        for (const folder of moved) {
          await rm(join(dataDir, folder), { recursive: true, force: true });
          await rename(join(previous, folder), join(dataDir, folder));
        }
      }
      if (phase === 'db' || phase === 'files') {
        await copyInto(join(previous, DATABASE_FILE), live);
      }
      await rm(marker, { force: true });
    } catch (undoError) {
      ctx.log.error('The previous data could not be put back; the next start finishes the undo.', { err: undoError });
      throw undoError;
    }
    await rm(previous, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
    if (error instanceof ArchiveError) {
      throw error;
    }
    throw problem('internal_error', {
      detail: `The restore failed and your previous data was put back: ${causeOf(error)}.`,
    });
  }
  await rm(previous, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
  await rm(join(tmp, RESTORE_UPLOAD), { force: true });
  await rm(marker);
  return { manifest, durationMs: Math.round(performance.now() - started) };
}
