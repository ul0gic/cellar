#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { stderr, stdout } from 'node:process';

export interface CommandArgs {
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string | true>>;
}

interface CommandModule {
  run(args: CommandArgs): Promise<number>;
}

interface CommandSpec {
  readonly usage: string;
  readonly summary: string;
  readonly options: Readonly<Record<string, { readonly takesValue: boolean }>>;
  readonly positionals: { readonly min: number; readonly max: number };
  readonly details: string;
}

const COMMANDS = {
  serve: {
    usage: 'cellar serve',
    summary: 'Start the server (the image runs this by default).',
    options: {},
    positionals: { min: 0, max: 0 },
    details: [
      'Exit codes:',
      '  0   stopped by a signal, cleanly',
      '  1   unexpected failure; the log has the cause',
      '  2   invalid setting',
      '  10  data directory missing or not writable',
      '  11  database is from a newer Cellar',
      '  12  migration failed; database restored to its pre-upgrade copy',
      '  13  migration failed and the copy could not be put back',
      '  14  port in use or cannot listen',
      '  15  database file is not a SQLite database or is damaged',
    ].join('\n'),
  },
  healthcheck: {
    usage: 'cellar healthcheck',
    summary: 'Check that the running server answers (used by the image health check).',
    options: {},
    positionals: { min: 0, max: 0 },
    details: [
      'Requests /healthcheck on 127.0.0.1 with a 4 s timeout. Prints nothing on success.',
      '',
      'Exit codes:',
      '  0   the server answered 200',
      '  1   it did not',
    ].join('\n'),
  },
  'reset-owner-password': {
    usage: 'cellar reset-owner-password',
    summary: "Give the owner a one-time password and end the owner's sessions.",
    options: {},
    positionals: { min: 0, max: 0 },
    details: [
      'Works while the server runs. Cellar asks for a new password at the next sign-in.',
      '',
      'Exit codes:',
      '  0   done',
      "  1   couldn't reset the password",
      '  11  the database is from a newer Cellar',
      "  15  /data/cellar.db isn't a Cellar database or is damaged",
      "  30  Cellar isn't set up yet, so there's no owner",
    ].join('\n'),
  },
  backup: {
    usage: 'cellar backup [--output <path>] [--keep <n>]',
    summary: 'Write a backup zip, whether or not the server is running.',
    options: { '--output': { takesValue: true }, '--keep': { takesValue: true } },
    positionals: { min: 0, max: 0 },
    details: [
      'Arguments:',
      '  --output <path>  where to write the zip, inside /data',
      '                   (default /data/backups/cellar-backup-<yyyymmdd-hhmmss>.zip)',
      '  --keep <n>       then keep only the newest n backups in /data/backups (1 to 1000)',
      '',
      'Exit codes:',
      '  0   done',
      '  1   backup failed; no file was written',
      '  2   --keep is not a number from 1 to 1000',
      '  11  the database is from a newer Cellar',
      "  15  /data/cellar.db isn't a Cellar database or is damaged",
      '  40  --output is not a path inside /data',
      '  41  not enough free disk space',
    ].join('\n'),
  },
  restore: {
    usage: 'cellar restore <file> [--yes]',
    summary: 'Replace everything in /data with a backup (stop the server first).',
    options: { '--yes': { takesValue: false } },
    positionals: { min: 1, max: 1 },
    details: [
      'Arguments:',
      '  <file>  a backup inside /data, absolute or relative to /data',
      '  --yes   restore without the prompt',
      '',
      'Exit codes:',
      '  0   restored, or the prompt was declined',
      '  1   restore failed',
      '  2   usage, or no terminal and no --yes',
      "  20  the file isn't a usable Cellar backup; nothing was changed",
      '  21  the backup is from a newer Cellar',
      '  22  Cellar is running on this data directory',
      '  23  the restore failed and the previous data was put back',
      '  24  no such file inside /data',
      '  41  not enough free disk space',
    ].join('\n'),
  },
  version: {
    usage: 'cellar version',
    summary: 'Print the Cellar and Node versions.',
    options: {},
    positionals: { min: 0, max: 0 },
    details: 'Exit codes:\n  0   always',
  },
  help: {
    usage: 'cellar help [<command>]',
    summary: 'List the commands, or explain one.',
    options: {},
    positionals: { min: 0, max: 1 },
    details: 'Exit codes:\n  0   always\n  2   unknown command',
  },
} as const satisfies Readonly<Record<string, CommandSpec>>;

type CommandName = keyof typeof COMMANDS;

const handlers: Partial<Record<CommandName, () => Promise<CommandModule>>> = {
  serve: () => import('../src/cli/serve.ts'),
  healthcheck: () => import('../src/cli/healthcheck.ts'),
  backup: () => import('../src/cli/backup.ts'),
  restore: () => import('../src/cli/restore.ts'),
  'reset-owner-password': () => import('../src/cli/reset-owner-password.ts'),
};

class UsageError extends Error {}

function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name);
}

function parseArgs(name: CommandName, argv: readonly string[]): CommandArgs {
  const spec: CommandSpec = COMMANDS[name];
  const positionals: string[] = [];
  const options: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    const option = equals === -1 ? arg : arg.slice(0, equals);
    const optionSpec = spec.options[option];
    if (optionSpec === undefined) {
      throw new UsageError(`Unknown option '${option}' for ${name}. Run 'cellar help ${name}'.`);
    }
    if (!optionSpec.takesValue) {
      if (equals !== -1) {
        throw new UsageError(`Usage: ${spec.usage}`);
      }
      options[option] = true;
      continue;
    }
    const value = equals === -1 ? argv[index + 1] : arg.slice(equals + 1);
    if (value === undefined || value === '' || (equals === -1 && value.startsWith('--'))) {
      throw new UsageError(`Usage: ${spec.usage}`);
    }
    if (equals === -1) {
      index += 1;
    }
    options[option] = value;
  }
  if (positionals.length < spec.positionals.min || positionals.length > spec.positionals.max) {
    throw new UsageError(`Usage: ${spec.usage}`);
  }
  return { positionals, options };
}

function readVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string'
  ) {
    throw new Error('backend/package.json has no version string');
  }
  return manifest.version;
}

function synopsis(): string {
  const width = Math.max(...Object.values(COMMANDS).map((spec) => spec.usage.length));
  const lines = Object.values(COMMANDS).map((spec) => `  ${spec.usage.padEnd(width)}  ${spec.summary}`);
  return ['Usage:', ...lines, '', "Run 'cellar help <command>' for its arguments and exit codes."].join('\n');
}

function help(args: CommandArgs): number {
  const topic = args.positionals[0];
  if (topic === undefined) {
    stdout.write(`${synopsis()}\n`);
    return 0;
  }
  if (!isCommandName(topic)) {
    stderr.write(`Unknown command '${topic}'. Run 'cellar help' for the list.\n`);
    return 2;
  }
  const spec: CommandSpec = COMMANDS[topic];
  stdout.write(`Usage: ${spec.usage}\n\n${spec.summary}\n\n${spec.details}\n`);
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined) {
    stderr.write(`${synopsis()}\n`);
    return 2;
  }
  if (!isCommandName(name)) {
    stderr.write(`Unknown command '${name}'. Run 'cellar help' for the list.\n`);
    return 2;
  }
  let args: CommandArgs;
  try {
    args = parseArgs(name, rest);
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
  switch (name) {
    case 'version':
      stdout.write(`Cellar ${readVersion()} (node ${process.versions.node})\n`);
      return 0;
    case 'help':
      return help(args);
    default: {
      const load = handlers[name];
      if (load === undefined) {
        stderr.write(`'cellar ${name}' is not part of this build.\n`);
        return 1;
      }
      const command = await load();
      return command.run(args);
    }
  }
}

process.exitCode = await main(process.argv.slice(2));
