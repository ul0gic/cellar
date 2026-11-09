import { randomBytes } from 'node:crypto';
import { type ApiToken, foldName, type Id, LIMITS, type Member, type Profile } from '@cellar/contract';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { hashCredential, requireLoginOn, SESSION_COOKIE } from '../core/credentials.ts';
import { withTransaction } from '../core/db.ts';
import { hashPassword, oneTimePassword, verifyPassword } from '../core/passwords.ts';
import { problem } from '../core/problems.ts';
import { route, type TypedRequest } from '../core/route.ts';
import { findImage } from '../media/store.ts';
import { avatarOf, endSessions, findMember, type MemberRow, profileOf, requirePerson } from './sessions.ts';

const TOKEN_PREFIX_LENGTH = 8;

function assertNameFree(ctx: AppContext, name: string, exceptId: Id | null): void {
  const taken = ctx.db
    .prepare('SELECT name FROM members WHERE folded_name = ? AND id IS NOT ?')
    .get(foldName(name), exceptId);
  if (typeof taken?.name === 'string') {
    throw problem('duplicate_name', { detail: `There is already a member called “${taken.name}”.` });
  }
}

function lastSeenAt(ctx: AppContext, id: Id): string | null {
  const row = ctx.db
    .prepare(
      `SELECT MAX(seen) AS seen FROM (
         SELECT MAX(last_used_at) AS seen FROM sessions WHERE member_id = :id
         UNION ALL SELECT MAX(last_used_at) FROM api_tokens WHERE member_id = :id)`,
    )
    .get({ id });
  return typeof row?.seen === 'string' ? row.seen : null;
}

function memberOf(ctx: AppContext, member: MemberRow): Member {
  return {
    id: member.id,
    name: member.name,
    role: member.role,
    avatar: avatarOf(ctx, member),
    hasPassword: member.passwordHash !== null,
    createdAt: member.createdAt,
    lastSeenAt: lastSeenAt(ctx, member.id),
  };
}

function existingMember(ctx: AppContext, id: Id): MemberRow {
  const member = findMember(ctx.db, id);
  if (member === null) {
    throw problem('not_found');
  }
  return member;
}

function apiTokenOf(row: Readonly<Record<string, unknown>>): ApiToken {
  const { id, name, prefix, created_at, last_used_at } = row;
  if (
    typeof id !== 'number' ||
    typeof name !== 'string' ||
    typeof prefix !== 'string' ||
    typeof created_at !== 'string' ||
    (last_used_at !== null && typeof last_used_at !== 'string')
  ) {
    throw new Error('api_tokens row has an unexpected shape');
  }
  return { id, name, prefix, createdAt: created_at, lastUsedAt: last_used_at };
}

export function registerMembers(app: FastifyInstance, ctx: AppContext): void {
  route(app, 'listMembers', async () => ({
    members: ctx.db
      .prepare("SELECT id FROM members ORDER BY role = 'owner' DESC, folded_name, id")
      .all()
      .map(({ id }) => {
        if (typeof id !== 'number') {
          throw new Error('members row has an unexpected shape');
        }
        return memberOf(ctx, existingMember(ctx, id));
      }),
  }));

  route(app, 'createMember', async (request) => {
    const { name, password } = request.body;
    if (password === null && requireLoginOn(ctx.db)) {
      throw problem('validation_failed', {
        fields: [{ path: 'password', code: 'required', message: 'Enter a password.' }],
      });
    }
    const passwordHash = password === null ? null : await hashPassword(password);
    const nowText = ctx.now().toISOString();
    const id = withTransaction(ctx.db, () => {
      assertNameFree(ctx, name, null);
      const row = ctx.db
        .prepare(
          `INSERT INTO members (name, folded_name, role, password_hash, created_at, updated_at)
           VALUES (?, ?, 'member', ?, ?, ?) RETURNING id`,
        )
        .get(name, foldName(name), passwordHash, nowText, nowText);
      if (typeof row?.id !== 'number') {
        throw new Error('members insert returned no id');
      }
      return row.id;
    });
    return memberOf(ctx, existingMember(ctx, id));
  });

  const updateMember = (request: TypedRequest<'updateMember'>): Member => {
    const { id } = request.params;
    const { name } = request.body;
    withTransaction(ctx.db, () => {
      existingMember(ctx, id);
      if (name !== undefined) {
        assertNameFree(ctx, name, id);
        ctx.db
          .prepare('UPDATE members SET name = ?, folded_name = ?, updated_at = ? WHERE id = ?')
          .run(name, foldName(name), ctx.now().toISOString(), id);
      }
    });
    return memberOf(ctx, existingMember(ctx, id));
  };
  route(app, 'updateMember', async (request) => updateMember(request));

  route(app, 'resetMemberPassword', async (request) => {
    const { id } = request.params;
    existingMember(ctx, id);
    const temporaryPassword = oneTimePassword();
    const passwordHash = await hashPassword(temporaryPassword);
    withTransaction(ctx.db, () => {
      existingMember(ctx, id);
      ctx.db
        .prepare('UPDATE members SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
        .run(passwordHash, ctx.now().toISOString(), id);
      endSessions(ctx.db, id);
    });
    return { temporaryPassword };
  });

  const removeMember = (request: TypedRequest<'removeMember'>): undefined => {
    const { id } = request.params;
    withTransaction(ctx.db, () => {
      const member = existingMember(ctx, id);
      if (member.role === 'owner') {
        throw problem('cannot_remove_owner');
      }
      const owner = ctx.db.prepare("SELECT id FROM members WHERE role = 'owner'").get();
      if (typeof owner?.id !== 'number') {
        throw new Error('the owner row is missing');
      }
      ctx.db.prepare('UPDATE collections SET created_by = ? WHERE created_by = ?').run(owner.id, id);
      ctx.db.prepare('UPDATE calculators SET created_by = ? WHERE created_by = ?').run(owner.id, id);
      for (const sql of [
        'UPDATE recipes SET created_by = NULL WHERE created_by = ?',
        'UPDATE ingredients SET created_by = NULL WHERE created_by = ?',
        'UPDATE ingredients SET on_hand_set_by = NULL WHERE on_hand_set_by = ?',
        'UPDATE bottles SET created_by = NULL WHERE created_by = ?',
        'UPDATE menus SET created_by = NULL WHERE created_by = ?',
        'UPDATE household_substitutions SET created_by = NULL WHERE created_by = ?',
        'DELETE FROM members WHERE id = ?',
      ]) {
        ctx.db.prepare(sql).run(id);
      }
    });
  };
  route(app, 'removeMember', async (request) => removeMember(request));

  route(app, 'getMe', async (request) => profileOf(ctx, existingMember(ctx, requirePerson(ctx, request).id)));

  const updateMe = (request: TypedRequest<'updateMe'>): Profile => {
    const { id } = requirePerson(ctx, request);
    const patch = request.body;
    withTransaction(ctx.db, () => {
      const member = existingMember(ctx, id);
      if (patch.name !== undefined) {
        assertNameFree(ctx, patch.name, id);
      }
      if (
        patch.avatarImageId !== undefined &&
        patch.avatarImageId !== null &&
        findImage(ctx.db, patch.avatarImageId) === null
      ) {
        throw problem('validation_failed', {
          fields: [{ path: 'avatarImageId', code: 'not_found', message: 'That image no longer exists.' }],
        });
      }
      const name = patch.name ?? member.name;
      ctx.db
        .prepare(
          `UPDATE members SET name = ?, folded_name = ?, avatar_image_id = ?, preferred_unit = ?,
             default_visibility = ?, show_prices = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          name,
          foldName(name),
          patch.avatarImageId === undefined ? member.avatarImageId : patch.avatarImageId,
          patch.unit ?? member.unit,
          patch.defaultVisibility ?? member.defaultVisibility,
          (patch.showPrices ?? member.showPrices) ? 1 : 0,
          ctx.now().toISOString(),
          id,
        );
    });
    return profileOf(ctx, existingMember(ctx, id));
  };
  route(app, 'updateMe', async (request) => updateMe(request));

  route(app, 'changeMyPassword', async (request): Promise<undefined> => {
    const person = requirePerson(ctx, request);
    const { currentPassword, newPassword } = request.body;
    const member = existingMember(ctx, person.id);
    if (!(await verifyPassword(currentPassword, member.passwordHash))) {
      throw problem('validation_failed', {
        fields: [{ path: 'currentPassword', code: 'wrong_password', message: 'That password is not right.' }],
      });
    }
    if (newPassword.normalize('NFC') === currentPassword.normalize('NFC')) {
      throw problem('validation_failed', {
        fields: [{ path: 'newPassword', code: 'invalid_value', message: 'Choose a new password.' }],
      });
    }
    const passwordHash = await hashPassword(newPassword);
    const cookie = person.via === 'session' ? request.cookies[SESSION_COOKIE] : undefined;
    withTransaction(ctx.db, () => {
      ctx.db
        .prepare('UPDATE members SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
        .run(passwordHash, ctx.now().toISOString(), person.id);
      endSessions(ctx.db, person.id, cookie);
    });
  });

  route(app, 'listMyTokens', async (request) => ({
    tokens: ctx.db
      .prepare(
        `SELECT id, name, prefix, created_at, last_used_at FROM api_tokens
         WHERE member_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(requirePerson(ctx, request).id, LIMITS.apiTokensPerMember.max)
      .map(apiTokenOf),
  }));

  const createMyToken = (request: TypedRequest<'createMyToken'>) => {
    const { id: memberId } = requirePerson(ctx, request);
    const token = `clr_${randomBytes(32).toString('base64url')}`;
    const prefix = token.slice(0, TOKEN_PREFIX_LENGTH);
    const row = withTransaction(ctx.db, () => {
      const live = ctx.db
        .prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE member_id = ? AND revoked_at IS NULL')
        .get(memberId);
      if (typeof live?.n !== 'number' || live.n >= LIMITS.apiTokensPerMember.max) {
        throw problem('token_limit');
      }
      return ctx.db
        .prepare(
          `INSERT INTO api_tokens (member_id, name, prefix, token_hash, created_at)
           VALUES (?, ?, ?, ?, ?) RETURNING id, name, prefix, created_at, last_used_at`,
        )
        .get(memberId, request.body.name, prefix, hashCredential(token), ctx.now().toISOString());
    });
    if (row === undefined) {
      throw new Error('api_tokens insert returned no row');
    }
    return { ...apiTokenOf(row), token };
  };
  route(app, 'createMyToken', async (request) => createMyToken(request));

  const revokeMyToken = (request: TypedRequest<'revokeMyToken'>): undefined => {
    const result = ctx.db
      .prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND member_id = ? AND revoked_at IS NULL')
      .run(ctx.now().toISOString(), request.params.id, requirePerson(ctx, request).id);
    if (result.changes === 0) {
      throw problem('not_found');
    }
  };
  route(app, 'revokeMyToken', async (request) => revokeMyToken(request));
}
