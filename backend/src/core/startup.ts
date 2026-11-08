import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from './context.ts';
import { ownerExists } from './credentials.ts';
import { type Database, openDatabase } from './db.ts';
import { buildHttp } from './http.ts';
import { createJobRunner } from './jobs.ts';
import { createMediaStore } from '../media/store.ts';
import { createLogger, type Logger } from './logger.ts';
import { migrate } from './migrate.ts';
import { createOutbound } from './outbound.ts';
import { StartupExit } from './problems.ts';
import type { Settings } from './settings.ts';
import { APP_VERSION } from './version.ts';

const HEARTBEAT_MS = 10_000;
const TMP_MAX_AGE_MS = 3_600_000;
const DRAIN_MS = 10_000;
const RESTORE_PREVIOUS = 'restore-previous';
const RESTORE_EXTRACT = 'restore-extract';
const RESTORE_MARKER = 'restore-in-progress.json';
const RESTORE_UPLOAD = 'restore-upload.zip';

type RestorePhase = 'db' | 'files' | 'cleanup';

export interface RunningServer {
  readonly app: FastifyInstance;
  readonly ctx: AppContext;
  close(): Promise<void>;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function checkDataDir(dataDir: string, log: Logger): void {
  const uid = process.getuid === undefined ? 'unknown' : String(process.getuid());
  let owner: number;
  try {
    owner = statSync(dataDir).uid;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      throw new StartupExit(
        10,
        `Cellar can't write to ${dataDir} (it doesn't exist). Create the data folder yourself before starting, or mount a folder there (see compose.yaml).`,
      );
    }
    throw error;
  }
  const probe = join(dataDir, '.write-test');
  try {
    writeFileSync(probe, '');
    rmSync(probe);
  } catch (error) {
    if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM') || hasCode(error, 'EROFS')) {
      throw new StartupExit(
        10,
        `Cellar can't write to ${dataDir} (it is owned by UID ${owner} and Cellar runs as UID ${uid}). Create the data folder yourself before starting, or set user: in compose.yaml to the folder owner's id. See "If your user isn't UID 1000" in the install guide.`,
      );
    }
    throw error;
  }
  if (statSync(dataDir).dev === statSync(dirname(dataDir)).dev) {
    log.warn(
      `${dataDir} isn't a mounted folder. Your data will be lost when this container is removed. Mount a folder at ${dataDir} (see compose.yaml).`,
    );
  }
  log.info(`Data folder ${dataDir} is writable.`);
}

function readRestorePhase(marker: string): RestorePhase {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(marker, 'utf8'));
  } catch (error) {
    throw new StartupExit(
      15,
      `Cellar can't read ${marker} (${causeOf(error)}). Restore from a backup with "cellar restore".`,
    );
  }
  const phase = typeof parsed === 'object' && parsed !== null && 'phase' in parsed ? parsed.phase : undefined;
  if (phase === 'db' || phase === 'files' || phase === 'cleanup') {
    return phase;
  }
  throw new StartupExit(
    15,
    `Cellar can't read ${marker} (unknown phase). Restore from a backup with "cellar restore".`,
  );
}

function finishInterruptedRestore(dataDir: string, log: Logger): void {
  const tmp = join(dataDir, 'tmp');
  const marker = join(tmp, RESTORE_MARKER);
  const previous = join(tmp, RESTORE_PREVIOUS);
  const extract = join(tmp, RESTORE_EXTRACT);
  const phase = existsSync(marker) ? readRestorePhase(marker) : null;
  if (phase === 'db') {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(join(dataDir, `cellar.db${suffix}`), { force: true });
    }
    renameSync(join(previous, 'cellar.db'), join(dataDir, 'cellar.db'));
    log.warn('A restore was interrupted. The data from before it was put back.');
  }
  if (phase === 'files') {
    for (const name of ['media', 'catalog']) {
      const live = join(dataDir, name);
      const staged = join(extract, name);
      if (existsSync(staged) && existsSync(live)) {
        renameSync(live, join(previous, name));
      }
      if (existsSync(staged)) {
        renameSync(staged, live);
      }
    }
    log.warn('A restore was interrupted after its database step. It was finished.');
  }
  rmSync(previous, { recursive: true, force: true });
  rmSync(extract, { recursive: true, force: true });
  rmSync(join(tmp, RESTORE_UPLOAD), { force: true });
  rmSync(marker, { force: true });
}

function prepareFolders(dataDir: string, log: Logger, now: Date): void {
  finishInterruptedRestore(dataDir, log);
  for (const folder of ['media/u', 'catalog', 'backups', 'tmp', 'run']) {
    mkdirSync(join(dataDir, folder), { recursive: true });
  }
  const tmp = join(dataDir, 'tmp');
  let removed = 0;
  for (const entry of readdirSync(tmp)) {
    const path = join(tmp, entry);
    if (now.getTime() - lstatSync(path).mtimeMs > TMP_MAX_AGE_MS) {
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    }
  }
  log.info('Data folders ready.', { tmpRemoved: removed });
}

function writeHeartbeat(dataDir: string, startedAt: string, now: Date): void {
  const target = join(dataDir, 'run', 'server.json');
  const staging = `${target}.tmp`;
  writeFileSync(
    staging,
    JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt, heartbeatAt: now.toISOString() }),
  );
  renameSync(staging, target);
}

function folderStep<T>(step: () => T): T {
  try {
    return step();
  } catch (error) {
    if (error instanceof StartupExit) {
      throw error;
    }
    throw new StartupExit(10, `Cellar can't prepare its data folder: ${causeOf(error)}`);
  }
}

async function listen(app: FastifyInstance, port: number): Promise<void> {
  try {
    const listening: Promise<string> = app.listen({ port, host: '0.0.0.0' });
    await listening;
  } catch (error) {
    if (hasCode(error, 'EADDRINUSE')) {
      throw new StartupExit(
        14,
        `Port ${port} is already in use inside the container. Set CELLAR_PORT or free the port.`,
      );
    }
    throw new StartupExit(14, `Cellar can't listen on port ${port}: ${causeOf(error)}`);
  }
}

function closeDatabase(db: Database): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}

export async function startServer(settings: Settings): Promise<RunningServer> {
  const log = createLogger(settings.logLevel);
  const now = () => new Date();
  const startedAt = now().toISOString();
  log.info('Settings read.', { basePath: settings.basePath || '/', port: settings.port });
  if (settings.outboundAllow.length > 0) {
    log.warn(
      `CELLAR_OUTBOUND_ALLOW is set (development only): Cellar will contact private addresses for ${settings.outboundAllow.join(', ')}.`,
    );
  }
  if (settings.aiBaseUrl !== null) {
    log.warn(`CELLAR_AI_BASE_URL is set (development only): AI requests go to ${settings.aiBaseUrl.origin}.`);
  }

  folderStep(() => checkDataDir(settings.dataDir, log));
  folderStep(() => prepareFolders(settings.dataDir, log, now()));

  const db = openDatabase(join(settings.dataDir, 'cellar.db'));
  log.info('Database opened.');
  let app: FastifyInstance | null = null;
  try {
    const { from, to } = await migrate(db, settings.dataDir, log);
    log.info(`Database schema is ${to}.`, { from });

    const ctx: AppContext = {
      settings,
      db,
      log,
      jobs: createJobRunner(log, now),
      outbound: createOutbound(settings, log, APP_VERSION),
      media: createMediaStore(settings, db, log),
      version: APP_VERSION,
      schemaVersion: to,
      startedAt,
      now,
    };
    const server = buildHttp(ctx);
    app = server;
    await listen(server, settings.port);
    log.info(`Listening on port ${settings.port}.`);

    folderStep(() => writeHeartbeat(settings.dataDir, startedAt, now()));
    const heartbeat = setInterval(() => {
      try {
        writeHeartbeat(settings.dataDir, startedAt, now());
      } catch (error) {
        log.error('The heartbeat file could not be written.', { err: error });
      }
    }, HEARTBEAT_MS);
    log.info('Heartbeat started.', { everyMs: HEARTBEAT_MS });

    log.info(`Cellar ${APP_VERSION} is ready on port ${settings.port} at ${settings.basePath || '/'}`);
    if (!ownerExists(db)) {
      log.info(`Cellar isn't set up yet. Open it in a browser on port ${settings.port} to create the owner.`);
    }

    return {
      app: server,
      ctx,
      async close() {
        clearInterval(heartbeat);
        log.info('Stopping.');
        const drained = await Promise.race([
          server.close().then(() => true),
          new Promise<false>((resolve) => setTimeout(resolve, DRAIN_MS, false).unref()),
        ]);
        if (!drained) {
          log.warn(`Requests were still running after ${DRAIN_MS / 1000} s; stopping anyway.`);
        }
        closeDatabase(db);
        rmSync(join(settings.dataDir, 'run', 'server.json'), { force: true });
        log.info('Stopped.');
      },
    };
  } catch (error) {
    if (app !== null) {
      await app.close();
    }
    db.close();
    throw error;
  }
}
