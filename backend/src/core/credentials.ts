import { createHash } from 'node:crypto';
import type { Id, PreferredUnit, Role } from '@cellar/contract';
import type { Database } from './db.ts';

export const SESSION_COOKIE = 'cellar_session';
export const SESSION_LIFETIME_SECONDS = 2_592_000;
const SESSION_TOUCH_MS = 3_600_000;
const TOKEN_TOUCH_MS = 60_000;

export interface MemberAccess {
  readonly id: Id;
  readonly role: Role;
  readonly showPrices: boolean;
  readonly preferredUnit: PreferredUnit;
  readonly mustChangePassword: boolean;
}

type Row = Readonly<Record<string, unknown>>;

export function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sessionCookieOptions(secure: boolean, basePath: string) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: basePath === '' ? '/' : basePath,
    maxAge: SESSION_LIFETIME_SECONDS,
  } as const;
}

function memberAccess(row: Row): MemberAccess {
  const { id, role, show_prices, preferred_unit, must_change_password } = row;
  if (
    typeof id !== 'number' ||
    (role !== 'owner' && role !== 'member') ||
    (preferred_unit !== 'oz' && preferred_unit !== 'ml')
  ) {
    throw new Error('members row has an unexpected shape');
  }
  return {
    id,
    role,
    showPrices: show_prices === 1,
    preferredUnit: preferred_unit,
    mustChangePassword: must_change_password === 1,
  };
}

const MEMBER_COLUMNS = 'm.id, m.role, m.show_prices, m.preferred_unit, m.must_change_password';

export function ownerExists(db: Database): boolean {
  return db.prepare("SELECT 1 FROM members WHERE role = 'owner' LIMIT 1").get() !== undefined;
}

export function requireLoginOn(db: Database): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'require_login'").get();
  return row?.value !== '0';
}

export function findSession(
  db: Database,
  tokenHash: string,
  now: Date,
): { readonly member: MemberAccess; readonly touched: boolean } | null {
  const row = db
    .prepare(
      `SELECT ${MEMBER_COLUMNS}, s.last_used_at FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = ?`,
    )
    .get(tokenHash);
  if (row === undefined || typeof row.last_used_at !== 'string') {
    return null;
  }
  const lastUsed = Date.parse(row.last_used_at);
  if (now.getTime() - lastUsed > SESSION_LIFETIME_SECONDS * 1000) {
    return null;
  }
  const touched = now.getTime() - lastUsed >= SESSION_TOUCH_MS;
  if (touched) {
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').run(now.toISOString(), tokenHash);
  }
  return { member: memberAccess(row), touched };
}

export function findToken(db: Database, tokenHash: string, now: Date): MemberAccess | null {
  const row = db
    .prepare(
      `SELECT ${MEMBER_COLUMNS}, t.id AS token_id, t.last_used_at FROM api_tokens t JOIN members m ON m.id = t.member_id WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
    )
    .get(tokenHash);
  if (row === undefined) {
    return null;
  }
  const lastUsed = typeof row.last_used_at === 'string' ? Date.parse(row.last_used_at) : Number.NEGATIVE_INFINITY;
  if (now.getTime() - lastUsed >= TOKEN_TOUCH_MS) {
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now.toISOString(), row.token_id ?? null);
  }
  return memberAccess(row);
}
