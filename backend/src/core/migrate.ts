import { rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
// biome-ignore lint/correctness/noUnresolvedImports: Biome 2.6.6's Node built-in module list lacks node:sqlite
import { backup, DatabaseSync } from 'node:sqlite';
import { type Database, withTransaction } from './db.ts';
import type { Logger } from './logger.ts';
import { initial } from './migrations/001-initial.ts';
import { StartupExit } from './problems.ts';
import { SCHEMA_VERSION } from './schema.ts';
import { APP_VERSION } from './version.ts';

interface Migration {
  readonly version: number;
  up(db: Database): void;
}

const MIGRATIONS: readonly Migration[] = [initial];

export const PRE_MIGRATION_FILE = 'cellar.pre-migration.db';

function readSchemaVersion(db: Database): number {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'").get();
  if (table === undefined) {
    return 0;
  }
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_meta').get();
  const version = row?.version;
  return typeof version === 'number' ? version : 0;
}

function removeDatabaseFiles(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

export async function copyDatabase(db: Database, target: string): Promise<{ durationMs: number; bytes: number }> {
  const started = performance.now();
  removeDatabaseFiles(target);
  await backup(db, target);
  return { durationMs: Math.round(performance.now() - started), bytes: statSync(target).size };
}

function applyPending(db: Database, from: number, now: string): void {
  withTransaction(db, () => {
    for (const migration of MIGRATIONS) {
      if (migration.version > from) {
        migration.up(db);
      }
    }
    db.exec('DELETE FROM schema_meta');
    db.prepare('INSERT INTO schema_meta (version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION, now);
  });
}

function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function restoreCopy(copyPath: string, livePath: string): Promise<void> {
  const copy = new DatabaseSync(copyPath, { readOnly: true });
  try {
    await backup(copy, livePath);
  } finally {
    copy.close();
  }
}

export async function migrate(db: Database, dataDir: string, log: Logger): Promise<{ from: number; to: number }> {
  const from = readSchemaVersion(db);
  const to = SCHEMA_VERSION;
  if (from > to) {
    throw new StartupExit(
      11,
      `This database is from a newer Cellar (schema ${from}). This is Cellar ${APP_VERSION} (schema ${to}). Start a newer Cellar, or roll back as the install guide describes.`,
    );
  }
  if (from === to) {
    return { from, to };
  }
  const started = performance.now();
  if (from === 0) {
    applyPending(db, from, new Date().toISOString());
    log.info(`Created the database at schema ${to}.`, { durationMs: Math.round(performance.now() - started) });
    return { from, to };
  }
  const livePath = join(dataDir, 'cellar.db');
  const copyPath = join(dataDir, PRE_MIGRATION_FILE);
  const copy = await copyDatabase(db, copyPath);
  log.info(`Upgrading the database from schema ${from} to ${to}. Copy saved as ${copyPath}.`, {
    copyMs: copy.durationMs,
    copyBytes: copy.bytes,
  });
  try {
    applyPending(db, from, new Date().toISOString());
  } catch (error) {
    try {
      await restoreCopy(copyPath, livePath);
    } catch (restoreError) {
      throw new StartupExit(
        13,
        `The database upgrade failed and the copy couldn't be put back: ${causeOf(restoreError)}. Your data is in ${copyPath}. Rename it to cellar.db and start the previous Cellar version.`,
      );
    }
    throw new StartupExit(
      12,
      `The database upgrade from schema ${from} to ${to} failed: ${causeOf(error)}. The database was put back as it was. Start the previous Cellar version and report this with the log.`,
    );
  }
  log.info(`Database upgraded in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
  return { from, to };
}
