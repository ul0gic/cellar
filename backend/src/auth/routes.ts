import { foldName, type Session } from '@cellar/contract';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { startCatalogLoad } from '../catalog/loader.ts';
import type { AppContext } from '../core/context.ts';
import { hashCredential, ownerExists, SESSION_COOKIE, sessionCookieOptions } from '../core/credentials.ts';
import { withTransaction } from '../core/db.ts';
import { hashPassword, verifyPassword } from '../core/passwords.ts';
import { problem } from '../core/problems.ts';
import { route, type TypedRequest } from '../core/route.ts';
import { writeSetting } from '../household/settings.ts';
import { createSignInLimiter } from './limiter.ts';
import { registerMembers } from './members.ts';
import {
  allMembers,
  avatarOf,
  createSession,
  currentSession,
  findMember,
  findMemberByName,
  type MemberRow,
  sendSession,
} from './sessions.ts';

function rateLimited(retryAfterSeconds: number) {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return problem('rate_limited', {
    detail: `Too many sign-in attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    retryAfterSeconds,
  });
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  const limiter = createSignInLimiter();

  route(app, 'runSetup', async (request, reply) => {
    const { ownerName, password, requireLogin, loadCatalog } = request.body;
    const passwordHash = await hashPassword(password);
    const now = ctx.now();
    const nowText = now.toISOString();
    const { owner, cookie } = withTransaction(ctx.db, () => {
      if (ownerExists(ctx.db)) {
        throw problem('not_found');
      }
      const inserted = ctx.db
        .prepare(
          `INSERT INTO members (name, folded_name, role, password_hash, created_at, updated_at)
           VALUES (?, ?, 'owner', ?, ?, ?) RETURNING id`,
        )
        .get(ownerName, foldName(ownerName), passwordHash, nowText, nowText);
      if (typeof inserted?.id !== 'number') {
        throw new Error('members insert returned no id');
      }
      writeSetting(ctx.db, 'require_login', requireLogin ? '1' : '0');
      return { owner: inserted.id, cookie: createSession(ctx, inserted.id, 'password', now) };
    });
    const member = findMember(ctx.db, owner);
    if (member === null) {
      throw new Error('the new owner row is missing');
    }
    const session = sendSession(ctx, request, reply, cookie, member, 'password', now);
    const catalogJob = loadCatalog ? startCatalogLoad(ctx, hashCredential(cookie)) : null;
    return { session, catalogJob };
  });

  route(app, 'getSession', async (request) => currentSession(ctx, request));

  route(app, 'login', async (request, reply) => {
    const { name, password } = request.body;
    const folded = foldName(name);
    const now = ctx.now();
    const retryAfter = limiter.retryAfterSeconds(folded, request.ip, now.getTime());
    if (retryAfter !== null) {
      throw rateLimited(retryAfter);
    }
    const member: MemberRow | null = findMemberByName(ctx.db, folded);
    const matches = await verifyPassword(password, member?.passwordHash ?? null);
    if (member === null || !matches) {
      limiter.recordFailure(folded, request.ip, now.getTime());
      throw problem('invalid_credentials');
    }
    const cookie = withTransaction(ctx.db, () => createSession(ctx, member.id, 'password', now));
    return sendSession(ctx, request, reply, cookie, member, 'password', now);
  });

  const chooseProfile = (request: TypedRequest<'chooseProfile'>, reply: FastifyReply): Session => {
    const member = findMember(ctx.db, request.body.memberId);
    if (member === null) {
      throw problem('not_found');
    }
    const now = ctx.now();
    const cookie = withTransaction(ctx.db, () => createSession(ctx, member.id, 'profile', now));
    return sendSession(ctx, request, reply, cookie, member, 'profile', now);
  };
  route(app, 'chooseProfile', async (request, reply) => chooseProfile(request, reply));

  const logout = (request: TypedRequest<'logout'>, reply: FastifyReply): undefined => {
    const cookie = request.cookies[SESSION_COOKIE];
    if (cookie !== undefined && cookie !== '') {
      ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashCredential(cookie));
    }
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions(request.protocol === 'https', ctx.settings.basePath));
  };
  route(app, 'logout', async (request, reply) => logout(request, reply));

  route(app, 'listProfiles', async () => ({
    profiles: allMembers(ctx.db).map((member) => ({ id: member.id, name: member.name, avatar: avatarOf(ctx, member) })),
  }));

  registerMembers(app, ctx);
}
