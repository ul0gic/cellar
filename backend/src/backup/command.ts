import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { stderr } from 'node:process';
import type { BackupCounts } from '@cellar/contract';
import { type Database, openDatabase } from '../core/db.ts';
import { createLogger } from '../core/logger.ts';
import { StartupExit } from '../core/problems.ts';
import { SCHEMA_VERSION } from '../core/schema.ts';
import { loadSettings, type Settings } from '../core/settings.ts';
import { APP_VERSION } from '../core/version.ts';
import { DATABASE_FILE, type DataContext, readSchemaVersion } from './backup.ts';

export interface CommandContext {
  readonly ctx: DataContext;
  readonly settings: Settings;
  close(): void;
}

export class CommandExit extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, message: string) {
    super(message);
    this.name = 'CommandExit';
    this.exitCode = exitCode;
  }
}

export function readCommandSettings(): Settings {
  try {
    return loadSettings(process.env);
  } catch (error) {
    if (error instanceof StartupExit) {
      throw new CommandExit(error.exitCode, error.message);
    }
    throw error;
  }
}

export function openCommandContext(settings: Settings, allowMissing: boolean): CommandContext {
  const path = join(settings.dataDir, DATABASE_FILE);
  const damaged = new CommandExit(15, `${path} isn't a Cellar database or is damaged.`);
  if (!(allowMissing || existsSync(path))) {
    throw damaged;
  }
  let db: Database;
  try {
    db = openDatabase(path);
  } catch (error) {
    if (error instanceof StartupExit && error.exitCode === 15) {
      throw damaged;
    }
    throw error;
  }
  const schema = readSchemaVersion(db);
  if (schema > SCHEMA_VERSION) {
    db.close();
    throw new CommandExit(
      11,
      `This database is from a newer Cellar (schema ${schema}); this is Cellar ${APP_VERSION} (schema ${SCHEMA_VERSION}).`,
    );
  }
  if (schema === 0 && !allowMissing) {
    db.close();
    throw damaged;
  }
  return {
    settings,
    ctx: {
      settings,
      db,
      log: createLogger('error', () => undefined),
      version: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      now: () => new Date(),
    },
    close() {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
    },
  };
}

export function countsLine(counts: BackupCounts): string {
  const n = (value: number) => value.toLocaleString('en-US');
  return `${n(counts.recipes)} recipes, ${n(counts.ingredients)} ingredients, ${n(counts.bottles)} bottles, ${n(counts.notes + counts.ratings)} notes and ratings, ${n(counts.members)} people, ${n(counts.images)} images`;
}

export async function runCommand(body: () => Promise<number>): Promise<number> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof CommandExit) {
      stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    throw error;
  }
}
