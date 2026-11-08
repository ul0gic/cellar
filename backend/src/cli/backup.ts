import { createWriteStream, existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { stdout } from 'node:process';
import { finished } from 'node:stream/promises';
import type { CommandArgs } from '../../bin/cellar.ts';
import { databaseBytes, formatBytes, freeBytes, streamSnapshot, takeSnapshot, countRows } from '../backup/backup.ts';
import { CommandExit, countsLine, openCommandContext, readCommandSettings, runCommand } from '../backup/command.ts';
import { ProblemError } from '../core/problems.ts';

const KEEP_MAX = 1000;
const BACKUP_PATTERN = /^cellar-backup-.*\.zip$/;

function parseKeep(value: string | true | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const keep = typeof value === 'string' && /^[0-9]{1,4}$/.test(value) ? Number.parseInt(value, 10) : 0;
  if (keep < 1 || keep > KEEP_MAX) {
    throw new CommandExit(2, '--keep must be a number from 1 to 1000.');
  }
  return keep;
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function defaultName(at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `cellar-backup-${stamp}.zip`;
}

function folderBytes(root: string): number {
  if (!existsSync(root)) {
    return 0;
  }
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((sum, entry) => sum + statSync(join(entry.parentPath, entry.name)).size, 0);
}

export function run(args: CommandArgs): Promise<number> {
  return runCommand(async () => {
    const keep = parseKeep(args.options['--keep']);
    const settings = readCommandSettings();
    const { dataDir } = settings;
    const option = args.options['--output'];
    const output =
      typeof option === 'string' ? resolve(dataDir, option) : join(dataDir, 'backups', defaultName(new Date()));
    if (!isInside(dataDir, output)) {
      throw new CommandExit(
        40,
        `--output must be a path inside ${dataDir}, like ${join(dataDir, 'backups', 'mine.zip')}.`,
      );
    }
    const opened = openCommandContext(settings, false);
    const started = performance.now();
    const partial = `${output}.partial`;
    try {
      const needed =
        2 * databaseBytes(dataDir) + folderBytes(join(dataDir, 'media')) + folderBytes(join(dataDir, 'catalog'));
      const free = await freeBytes(dataDir);
      if (free < needed) {
        throw new CommandExit(
          41,
          `Not enough free disk space: the backup needs about ${formatBytes(needed)}, ${formatBytes(free)} is free.`,
        );
      }
      stdout.write(`Backing up ${countsLine(countRows(opened.ctx.db))}...\n`);
      await mkdir(dirname(output), { recursive: true });
      try {
        const snapshot = await takeSnapshot(opened.ctx);
        const file = createWriteStream(partial, { flags: 'w', mode: 0o600 });
        await streamSnapshot(snapshot, file);
        file.end();
        await finished(file);
        await rename(partial, output);
      } catch (error) {
        await rm(partial, { force: true });
        if (error instanceof ProblemError && error.code === 'insufficient_storage') {
          throw new CommandExit(41, error.detail);
        }
        throw new CommandExit(
          1,
          `Backup failed: ${error instanceof Error ? error.message : String(error)}. No file was written.`,
        );
      }
    } finally {
      opened.close();
    }
    const seconds = Math.max(1, Math.round((performance.now() - started) / 1000));
    stdout.write(`Saved ${output} (${formatBytes(statSync(output).size)}) in ${seconds} s.\n`);
    if (keep !== null) {
      const backups = join(dataDir, 'backups');
      const names = readdirSync(backups)
        .filter((name) => BACKUP_PATTERN.test(name))
        .sort();
      const stale = names.slice(0, Math.max(0, names.length - keep));
      for (const name of stale) {
        await rm(join(backups, name), { force: true });
      }
      stdout.write(`Kept the newest ${keep} backups; removed ${stale.length}.\n`);
    }
    return 0;
  });
}
