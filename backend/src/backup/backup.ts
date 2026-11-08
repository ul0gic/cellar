import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { join, relative } from 'node:path';
// biome-ignore lint/correctness/noUnresolvedImports: Biome 2.6.6's Node built-in module list lacks node:sqlite
import { backup, DatabaseSync } from 'node:sqlite';
import type { BackupCounts, BackupManifest } from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import type { Database } from '../core/db.ts';
import type { JobProgress } from '../core/jobs.ts';
import { problem } from '../core/problems.ts';
import { createZipWriter } from './archive.ts';

export const MANIFEST_FILE = 'manifest.json';
export const DATABASE_FILE = 'cellar.db';
export const MEDIA_ROOT = 'media/';
export const CATALOG_ROOT = 'catalog/';

export type DataContext = Pick<AppContext, 'settings' | 'db' | 'log' | 'version' | 'schemaVersion' | 'now'>;

export interface BackupSnapshot {
  readonly path: string;
  readonly manifest: BackupManifest;
  readonly files: readonly { readonly name: string; readonly path: string }[];
}

export function formatBytes(bytes: number): string {
  if (bytes >= 2 ** 30) {
    return `${(bytes / 2 ** 30).toFixed(1)} GB`;
  }
  if (bytes >= 2 ** 20) {
    return `${(bytes / 2 ** 20).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function freeBytes(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

export function insufficientStorage(needed: number, free: number) {
  return problem('insufficient_storage', {
    detail: `Not enough free disk space: this needs ${formatBytes(needed)}, ${formatBytes(free)} is free.`,
  });
}

export function countRows(db: Database): BackupCounts {
  const count = (table: string): number => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
    return typeof row?.n === 'number' ? row.n : 0;
  };
  return {
    members: count('members'),
    recipes: count('recipes'),
    ingredients: count('ingredients'),
    bottles: count('bottles'),
    notes: count('notes'),
    ratings: count('ratings'),
    images: count('images'),
    menus: count('menus'),
    collections: count('collections'),
    calculators: count('calculators'),
  };
}

export function readSchemaVersion(db: Database): number {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'").get();
  if (table === undefined) {
    return 0;
  }
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_meta').get();
  return typeof row?.version === 'number' ? row.version : 0;
}

function loadedCatalogVersion(db: Database): string | null {
  const row = db.prepare('SELECT version FROM catalog_loads ORDER BY loaded_at DESC, version DESC LIMIT 1').get();
  return typeof row?.version === 'string' ? row.version : null;
}

function listFiles(dataDir: string, folder: string): { name: string; path: string }[] {
  const root = join(dataDir, folder);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { name: relative(dataDir, path).split('\\').join('/'), path };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function databaseBytes(dataDir: string): number {
  return ['', '-wal'].reduce((sum, suffix) => {
    const path = join(dataDir, `${DATABASE_FILE}${suffix}`);
    return sum + (existsSync(path) ? statSync(path).size : 0);
  }, 0);
}

export async function takeSnapshot(ctx: DataContext): Promise<BackupSnapshot> {
  const { dataDir } = ctx.settings;
  const needed = databaseBytes(dataDir);
  const free = await freeBytes(dataDir);
  if (free < needed) {
    ctx.log.error('Not enough free disk space for the backup snapshot.', { needed, free });
    throw insufficientStorage(needed, free);
  }
  const path = join(dataDir, 'tmp', `backup-${randomUUID()}.db`);
  try {
    await backup(ctx.db, path);
    const snapshot = new DatabaseSync(path, { enableForeignKeyConstraints: false });
    let manifest: BackupManifest;
    try {
      snapshot.exec('PRAGMA secure_delete = ON');
      snapshot.exec("DELETE FROM sessions; DELETE FROM settings WHERE key = 'ai_key';");
      snapshot.exec('PRAGMA journal_mode = DELETE');
      const catalogVersion = loadedCatalogVersion(snapshot);
      manifest = {
        format: 'cellar.backup',
        formatVersion: 1,
        appVersion: ctx.version,
        schemaVersion: readSchemaVersion(snapshot),
        createdAt: ctx.now().toISOString(),
        catalogVersion,
        counts: countRows(snapshot),
        files: {
          database: DATABASE_FILE,
          media: MEDIA_ROOT,
          catalog: catalogVersion === null ? null : `${CATALOG_ROOT}${catalogVersion}/`,
        },
      };
    } finally {
      snapshot.close();
    }
    const files = [...listFiles(dataDir, 'media'), ...listFiles(dataDir, 'catalog')];
    return { path, manifest, files };
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
}

export async function streamSnapshot(
  snapshot: BackupSnapshot,
  out: NodeJS.WritableStream,
  progress?: JobProgress,
): Promise<number> {
  try {
    const zip = createZipWriter(out, new Date(snapshot.manifest.createdAt));
    await zip.addBuffer(MANIFEST_FILE, Buffer.from(`${JSON.stringify(snapshot.manifest, null, 2)}\n`), 'deflated');
    await zip.addFile(DATABASE_FILE, snapshot.path, 'deflated');
    let done = 0;
    for (const file of snapshot.files) {
      // Synchronous on purpose: each async file read costs several event-loop turns and stalls under concurrent writes.
      await zip.addBuffer(file.name, readFileSync(file.path), 'stored');
      done += 1;
      progress?.done(done);
    }
    return await zip.finish();
  } finally {
    rmSync(snapshot.path, { force: true });
  }
}

export async function writeBackup(
  ctx: DataContext,
  out: NodeJS.WritableStream,
  progress?: JobProgress,
): Promise<BackupManifest> {
  const snapshot = await takeSnapshot(ctx);
  await streamSnapshot(snapshot, out, progress);
  return snapshot.manifest;
}
