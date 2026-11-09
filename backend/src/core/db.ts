// biome-ignore lint/correctness/noUnresolvedImports: Biome 2.6.6's Node built-in module list lacks node:sqlite
import { DatabaseSync } from 'node:sqlite';
import { foldName } from '@cellar/contract';
import { StartupExit } from './problems.ts';

export type Database = DatabaseSync;

const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

function isUnreadableDatabase(error: unknown): boolean {
  if (!(error instanceof Error && 'errcode' in error && typeof error.errcode === 'number')) {
    return false;
  }
  const primary = error.errcode & 0xff;
  return primary === SQLITE_NOTADB || primary === SQLITE_CORRUPT;
}

export function isIntact(db: Database): boolean {
  try {
    return db.prepare('PRAGMA quick_check(1)').get()?.quick_check === 'ok';
  } catch (error) {
    if (isUnreadableDatabase(error)) {
      return false;
    }
    throw error;
  }
}

export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true });
  let intact: boolean;
  try {
    db.exec('PRAGMA journal_mode = WAL');
    intact = isIntact(db);
  } catch (error) {
    if (!isUnreadableDatabase(error)) {
      db.close();
      throw error;
    }
    intact = false;
  }
  if (!intact) {
    db.close();
    throw new StartupExit(
      15,
      `${path} isn't a SQLite database or is damaged. Restore a backup (cellar restore) or move the file away to start fresh.`,
    );
  }
  db.function('fold_name', { deterministic: true }, (name) => {
    if (typeof name !== 'string') {
      throw new TypeError('fold_name takes text');
    }
    return foldName(name);
  });
  return db;
}

export function withTransaction<T>(db: Database, fn: () => T): T {
  if (db.isTransaction) {
    return fn();
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  }
}
