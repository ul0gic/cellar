import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { type BackupManifest, LIMITS, RESTORE_CONFIRMATION } from '@cellar/contract';
import type { CommandArgs } from '../../bin/cellar.ts';
import { ArchiveError, type ArchiveRefusal } from '../backup/archive.ts';
import { countRows, readSchemaVersion } from '../backup/backup.ts';
import { CommandExit, countsLine, openCommandContext, readCommandSettings, runCommand } from '../backup/command.ts';
import { BackupTooNew, checkRestoreArchive, runRestore } from '../backup/restore.ts';
import type { JobProgress } from '../core/jobs.ts';
import { ProblemError } from '../core/problems.ts';
import { SCHEMA_VERSION } from '../core/schema.ts';
import { APP_VERSION } from '../core/version.ts';

const HEARTBEAT_FRESH_MS = 30_000;

const REFUSALS: Readonly<Record<ArchiveRefusal, string>> = {
  unreadable: "This file isn't a Cellar backup, or it's damaged.",
  entries: `This backup has more than ${LIMITS.archiveEntries.toLocaleString('en-US')} files.`,
  expanded: 'This backup expands past 2 GB.',
  path: 'A file in this backup points outside it.',
};

function serverIsRunning(dataDir: string, now: Date): boolean {
  const path = join(dataDir, 'run', 'server.json');
  if (!existsSync(path)) {
    return false;
  }
  let heartbeat: unknown;
  try {
    heartbeat = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return false;
    }
    throw error;
  }
  if (typeof heartbeat !== 'object' || heartbeat === null || !('heartbeatAt' in heartbeat)) {
    return false;
  }
  const at = typeof heartbeat.heartbeatAt === 'string' ? Date.parse(heartbeat.heartbeatAt) : Number.NaN;
  return Number.isFinite(at) && now.getTime() - at < HEARTBEAT_FRESH_MS;
}

function madeAt(iso: string): string {
  const date = new Date(iso);
  const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()} ${time} UTC`;
}

function backupPath(dataDir: string, file: string): string {
  const path = resolve(dataDir, file);
  const rel = relative(dataDir, path);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new CommandExit(24, `The backup must be inside ${dataDir}.`);
  }
  if (!(existsSync(path) && statSync(path).isFile())) {
    throw new CommandExit(24, `No file at ${path}. Put the backup inside the data folder, for example data/backups/.`);
  }
  return path;
}

async function confirmed(args: CommandArgs): Promise<boolean> {
  if (args.options['--yes'] === true) {
    return true;
  }
  if (!stdin.isTTY) {
    throw new CommandExit(2, 'Add --yes to restore without the prompt.');
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(`Type ${RESTORE_CONFIRMATION} to continue: `);
    return answer.trim() === RESTORE_CONFIRMATION;
  } finally {
    prompt.close();
  }
}

function checkFailure(error: unknown): CommandExit | null {
  if (error instanceof ArchiveError) {
    return new CommandExit(20, `${REFUSALS[error.reason]} Nothing was changed.`);
  }
  if (error instanceof BackupTooNew) {
    return new CommandExit(
      21,
      `This backup is from Cellar ${error.backupVersion} (schema ${error.backupSchema}); this is Cellar ${APP_VERSION} (schema ${SCHEMA_VERSION}). Use a Cellar at least as new as the backup.`,
    );
  }
  if (error instanceof ProblemError && error.code === 'payload_too_large') {
    return new CommandExit(20, 'This backup is larger than 2 GB. Nothing was changed.');
  }
  if (error instanceof ProblemError && error.code === 'insufficient_storage') {
    return new CommandExit(41, error.detail);
  }
  return null;
}

export function run(args: CommandArgs): Promise<number> {
  return runCommand(async () => {
    const settings = readCommandSettings();
    const { dataDir } = settings;
    const path = backupPath(dataDir, args.positionals[0]);
    if (serverIsRunning(dataDir, new Date())) {
      throw new CommandExit(
        22,
        'Cellar is running on this data directory. Restore from Settings > Backup, or stop it first: docker compose stop cellar',
      );
    }
    const opened = openCommandContext(settings, true);
    try {
      let manifest: BackupManifest;
      try {
        manifest = await checkRestoreArchive(opened.ctx, path);
      } catch (error) {
        throw checkFailure(error) ?? error;
      }
      stdout.write(
        `Backup from Cellar ${manifest.appVersion} (schema ${manifest.schemaVersion}), made ${madeAt(manifest.createdAt)}:\n  ${countsLine(manifest.counts)}.\n`,
      );
      stdout.write(
        `This replaces everything now in ${dataDir}:\n  ${readSchemaVersion(opened.ctx.db) === 0 ? 'nothing yet' : countsLine(countRows(opened.ctx.db))}.\n`,
      );
      if (!(await confirmed(args))) {
        stdout.write('Nothing was changed.\n');
        return 0;
      }
      stdout.write('Restoring... ');
      const progress: JobProgress = { step: () => undefined, done: () => undefined };
      try {
        const report = await runRestore(opened.ctx, path, progress);
        stdout.write(`done in ${Math.max(1, Math.round(report.durationMs / 1000))} s.\n`);
      } catch (error) {
        stdout.write('\n');
        const refused = checkFailure(error);
        if (refused !== null) {
          throw refused;
        }
        if (error instanceof ProblemError && error.code === 'internal_error') {
          throw new CommandExit(23, error.detail);
        }
        throw new CommandExit(1, `Restore failed: ${error instanceof Error ? error.message : String(error)}.`);
      }
    } finally {
      opened.close();
    }
    stdout.write('Restored. Start Cellar with: docker compose start cellar\n');
    stdout.write('Everyone signs in again, and the owner re-enters the AI key if one was set.\n');
    return 0;
  });
}
