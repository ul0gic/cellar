import { readFile } from 'node:fs/promises';
import { versions } from 'node:process';
import type { About, AppNotification, HouseholdSettings } from '@cellar/contract';
import { AboutSchema } from '@cellar/contract/schemas';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { avatarOf, findMember, requirePerson } from '../auth/sessions.ts';
import type { AppContext } from '../core/context.ts';
import { hashCredential, SESSION_COOKIE, sessionCookieOptions } from '../core/credentials.ts';
import { verifyPassword } from '../core/passwords.ts';
import { problem } from '../core/problems.ts';
import { route, type TypedRequest } from '../core/route.ts';
import { deleteSetting, householdSettings, loadedCatalogVersion, readSettings, writeSetting } from './settings.ts';

const LICENSES_FILE = new URL('../../generated/licenses.json', import.meta.url);
const NOTIFICATIONS_SHOWN = 20;

type License = About['licenses'][number];

async function readLicenses(): Promise<License[]> {
  let text: string;
  try {
    text = await readFile(LICENSES_FILE, 'utf8');
  } catch (error) {
    throw new Error(`${LICENSES_FILE.pathname} can't be read; generate it with node backend/scripts/licenses.ts`, {
      cause: error,
    });
  }
  const parsed = AboutSchema.shape.licenses.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(
      `${LICENSES_FILE.pathname} doesn't hold the licenses list; regenerate it with node backend/scripts/licenses.ts`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

function notificationOf(row: Readonly<Record<string, unknown>>): AppNotification {
  const { id, kind, created_at, version, message } = row;
  if (
    typeof id !== 'number' ||
    (kind !== 'catalog_update_available' && kind !== 'catalog_check_failed') ||
    typeof created_at !== 'string' ||
    (version !== null && typeof version !== 'string') ||
    (message !== null && typeof message !== 'string')
  ) {
    throw new Error('notifications row has an unexpected shape');
  }
  return { id, kind, createdAt: created_at, version, message };
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  let licenses: License[] | null = null;
  const sqliteVersion = (): string => {
    const row = ctx.db.prepare('SELECT sqlite_version() AS version').get();
    if (typeof row?.version !== 'string') {
      throw new Error('sqlite_version() returned no text');
    }
    return row.version;
  };
  const current = (): HouseholdSettings => householdSettings(readSettings(ctx.db));

  route(app, 'getSettings', async () => current());

  const updateSettings = (request: TypedRequest<'updateSettings'>): HouseholdSettings => {
    const { currency, displayUnit, catalogSchedule } = request.body;
    if (currency !== undefined) {
      writeSetting(ctx.db, 'currency', currency);
    }
    if (displayUnit !== undefined) {
      writeSetting(ctx.db, 'display_unit', displayUnit);
    }
    if (catalogSchedule !== undefined) {
      writeSetting(ctx.db, 'catalog_schedule', catalogSchedule);
    }
    return current();
  };
  route(app, 'updateSettings', async (request) => updateSettings(request));

  route(app, 'setRequireLogin', async (request) => {
    const { requireLogin, ownerPassword } = request.body;
    const owner = findMember(ctx.db, requirePerson(ctx, request).id);
    if (owner === null || !(await verifyPassword(ownerPassword, owner.passwordHash))) {
      throw problem('validation_failed', {
        fields: [{ path: 'ownerPassword', code: 'wrong_password', message: 'That password is not right.' }],
      });
    }
    if (requireLogin) {
      const blocked = ctx.db
        .prepare('SELECT id FROM members WHERE password_hash IS NULL ORDER BY folded_name, id')
        .all()
        .map(({ id }) => {
          const member = typeof id === 'number' ? findMember(ctx.db, id) : null;
          if (member === null) {
            throw new Error('members row has an unexpected shape');
          }
          return { id: member.id, name: member.name, avatar: avatarOf(ctx, member) };
        });
      if (blocked.length > 0) {
        throw problem('require_login_blocked', {
          detail: `${blocked.map((member) => member.name).join(', ')} have no password and couldn't sign in. Set one for each first.`,
          membersWithoutPassword: blocked,
        });
      }
    }
    writeSetting(ctx.db, 'require_login', requireLogin ? '1' : '0');
    return current();
  });

  const saveAiKey = (request: TypedRequest<'saveAiKey'>): HouseholdSettings => {
    writeSetting(ctx.db, 'ai_key', request.body.key);
    return current();
  };
  route(app, 'saveAiKey', async (request) => saveAiKey(request));

  const removeAiKey = (): HouseholdSettings => {
    deleteSetting(ctx.db, 'ai_key');
    return current();
  };
  route(app, 'removeAiKey', async () => removeAiKey());

  route(app, 'getAbout', async () => {
    licenses ??= await readLicenses();
    return {
      version: ctx.version,
      schemaVersion: ctx.schemaVersion,
      catalogVersion: loadedCatalogVersion(ctx.db),
      runtime: { node: versions.node, sqlite: sqliteVersion() },
      licenses,
    };
  });

  const listNotifications = (request: TypedRequest<'listNotifications'>) => {
    if (requirePerson(ctx, request).role !== 'owner') {
      return { notifications: [] };
    }
    return {
      notifications: ctx.db
        .prepare(
          `SELECT id, kind, created_at, version, message FROM notifications
           WHERE dismissed_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ${NOTIFICATIONS_SHOWN}`,
        )
        .all()
        .map(notificationOf),
    };
  };
  route(app, 'listNotifications', async (request) => listNotifications(request));

  const dismissNotification = (request: TypedRequest<'dismissNotification'>): undefined => {
    const result = ctx.db
      .prepare('UPDATE notifications SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL')
      .run(ctx.now().toISOString(), request.params.id);
    if (result.changes === 0) {
      throw problem('not_found');
    }
  };
  route(app, 'dismissNotification', async (request) => dismissNotification(request));

  const getJob = (request: TypedRequest<'getJob'>, reply: FastifyReply) => {
    const cookie = request.cookies[SESSION_COOKIE];
    const job = ctx.jobs.get(request.params.id, cookie === undefined ? undefined : hashCredential(cookie));
    if (job === null) {
      throw problem('not_found');
    }
    if (job.kind === 'restore' && job.state !== 'running') {
      reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(request.protocol === 'https', ctx.settings.basePath));
    }
    return job;
  };
  route(app, 'getJob', async (request, reply) => getJob(request, reply));
}
