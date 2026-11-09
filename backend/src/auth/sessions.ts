import { randomBytes } from 'node:crypto';
import type { Id, Profile, Session } from '@cellar/contract';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Person } from '../core/access.ts';
import type { AppContext } from '../core/context.ts';
import {
  hashCredential,
  requireLoginOn,
  SESSION_COOKIE,
  SESSION_LIFETIME_SECONDS,
  sessionCookieOptions,
} from '../core/credentials.ts';
import type { Database } from '../core/db.ts';
import { problem } from '../core/problems.ts';
import { householdBrief, readSettings } from '../household/settings.ts';
import { findImage } from '../media/store.ts';

const EXPIRED_SWEEP_BATCH = 500;

export type SessionVia = 'password' | 'profile';

export interface MemberRow {
  readonly id: Id;
  readonly name: string;
  readonly role: 'owner' | 'member';
  readonly passwordHash: string | null;
  readonly mustChangePassword: boolean;
  readonly avatarImageId: Id | null;
  readonly unit: Profile['unit'];
  readonly defaultVisibility: Profile['defaultVisibility'];
  readonly showPrices: boolean;
  readonly createdAt: string;
}

function memberRowOf(row: Readonly<Record<string, unknown>>): MemberRow {
  const {
    id,
    name,
    role,
    password_hash,
    must_change_password,
    avatar_image_id,
    preferred_unit,
    default_visibility,
    show_prices,
    created_at,
  } = row;
  if (
    typeof id !== 'number' ||
    typeof name !== 'string' ||
    (role !== 'owner' && role !== 'member') ||
    (password_hash !== null && typeof password_hash !== 'string') ||
    (avatar_image_id !== null && typeof avatar_image_id !== 'number') ||
    (preferred_unit !== 'oz' && preferred_unit !== 'ml') ||
    (default_visibility !== 'household' && default_visibility !== 'private') ||
    typeof created_at !== 'string'
  ) {
    throw new Error('members row has an unexpected shape');
  }
  return {
    id,
    name,
    role,
    passwordHash: password_hash,
    mustChangePassword: must_change_password === 1,
    avatarImageId: avatar_image_id,
    unit: preferred_unit,
    defaultVisibility: default_visibility,
    showPrices: show_prices === 1,
    createdAt: created_at,
  };
}

export function findMember(db: Database, id: Id): MemberRow | null {
  const row = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  return row === undefined ? null : memberRowOf(row);
}

export function findMemberByName(db: Database, foldedName: string): MemberRow | null {
  const row = db.prepare('SELECT * FROM members WHERE folded_name = ?').get(foldedName);
  return row === undefined ? null : memberRowOf(row);
}

export function allMembers(db: Database): MemberRow[] {
  return db.prepare("SELECT * FROM members ORDER BY role = 'owner' DESC, folded_name, id").all().map(memberRowOf);
}

export function avatarOf(ctx: AppContext, member: MemberRow): Profile['avatar'] {
  if (member.avatarImageId === null) {
    return null;
  }
  const image = findImage(ctx.db, member.avatarImageId);
  return image === null ? null : ctx.media.imageRef(image, ctx.settings.basePath);
}

export function profileOf(ctx: AppContext, member: MemberRow): Profile {
  return {
    id: member.id,
    name: member.name,
    role: member.role,
    avatar: avatarOf(ctx, member),
    unit: member.unit,
    defaultVisibility: member.defaultVisibility,
    showPrices: member.showPrices,
    mustChangePassword: member.mustChangePassword,
  };
}

export function requirePerson(ctx: AppContext, request: FastifyRequest): Person {
  if (request.person === null) {
    throw problem(requireLoginOn(ctx.db) ? 'login_required' : 'profile_required');
  }
  return request.person;
}

function expiresAt(lastUsedAt: string): string {
  return new Date(Date.parse(lastUsedAt) + SESSION_LIFETIME_SECONDS * 1000).toISOString();
}

function sessionView(ctx: AppContext, member: MemberRow, via: Session['via'], lastUsedAt: string | null): Session {
  return {
    person: profileOf(ctx, member),
    via,
    requireLogin: readSettings(ctx.db).requireLogin,
    expiresAt: lastUsedAt === null ? null : expiresAt(lastUsedAt),
    household: householdBrief(ctx.db),
  };
}

export function currentSession(ctx: AppContext, request: FastifyRequest): Session {
  const person = requirePerson(ctx, request);
  const member = findMember(ctx.db, person.id);
  if (member === null) {
    throw problem('not_found');
  }
  if (person.via === 'token') {
    return sessionView(ctx, member, 'token', null);
  }
  const cookie = request.cookies[SESSION_COOKIE] ?? '';
  const row = ctx.db.prepare('SELECT via, last_used_at FROM sessions WHERE token_hash = ?').get(hashCredential(cookie));
  if (row === undefined || (row.via !== 'password' && row.via !== 'profile') || typeof row.last_used_at !== 'string') {
    throw new Error('sessions row has an unexpected shape');
  }
  return sessionView(ctx, member, row.via, row.last_used_at);
}

export function createSession(ctx: AppContext, memberId: Id, via: SessionVia, now: Date): string {
  const cookie = randomBytes(32).toString('base64url');
  const nowText = now.toISOString();
  ctx.db
    .prepare(
      `DELETE FROM sessions WHERE rowid IN (
         SELECT rowid FROM sessions WHERE last_used_at < ? LIMIT ${EXPIRED_SWEEP_BATCH})`,
    )
    .run(new Date(now.getTime() - SESSION_LIFETIME_SECONDS * 1000).toISOString());
  ctx.db
    .prepare('INSERT INTO sessions (token_hash, member_id, via, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)')
    .run(hashCredential(cookie), memberId, via, nowText, nowText);
  return cookie;
}

export function sendSession(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  cookie: string,
  member: MemberRow,
  via: SessionVia,
  now: Date,
): Session {
  reply.setCookie(SESSION_COOKIE, cookie, sessionCookieOptions(request.protocol === 'https', ctx.settings.basePath));
  return sessionView(ctx, member, via, now.toISOString());
}

export function endSessions(db: Database, memberId: Id, keepCookie?: string): void {
  if (keepCookie === undefined) {
    db.prepare('DELETE FROM sessions WHERE member_id = ?').run(memberId);
  } else {
    db.prepare('DELETE FROM sessions WHERE member_id = ? AND token_hash <> ?').run(
      memberId,
      hashCredential(keepCookie),
    );
  }
}
