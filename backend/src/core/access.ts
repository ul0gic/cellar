import { type Access, endpoints, type Id, type OperationId, type PreferredUnit, type Role } from '@cellar/contract';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from './context.ts';
import {
  findSession,
  findToken,
  hashCredential,
  type MemberAccess,
  ownerExists,
  requireLoginOn,
  SESSION_COOKIE,
  sessionCookieOptions,
} from './credentials.ts';
import { problem } from './problems.ts';

export interface Person {
  readonly id: Id;
  readonly role: Role;
  readonly showPrices: boolean;
  readonly preferredUnit: PreferredUnit;
  readonly mustChangePassword: boolean;
  readonly via: 'session' | 'token';
}

declare module 'fastify' {
  interface FastifyRequest {
    person: Person | null;
  }
  interface FastifyContextConfig {
    access?: Access;
    op?: OperationId;
  }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PASSWORD_CHANGE_ALLOWED: ReadonlySet<string> = new Set(['getSession', 'logout', 'changeMyPassword']);
const RESTORE_RETRY_SECONDS = 5;

function jobIdParam(request: FastifyRequest): string | null {
  const params = request.params;
  if (typeof params === 'object' && params !== null && 'id' in params && typeof params.id === 'string') {
    return params.id;
  }
  return null;
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header === undefined) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match === null ? '' : match[1].trim();
}

function originMatches(origin: string, ownHost: string): boolean {
  const from = URL.parse(origin);
  const own = URL.parse(`http://${ownHost}`);
  if (from === null || own === null || (from.protocol !== 'http:' && from.protocol !== 'https:')) {
    return false;
  }
  const ownPort = own.port === '' ? null : own.port;
  const fromPort = from.port === '' ? null : from.port;
  return from.hostname === own.hostname && (ownPort === null ? fromPort === null : fromPort === ownPort);
}

function personOf(member: MemberAccess, via: Person['via']): Person {
  return { ...member, via };
}

export function createAccessPreHandler(ctx: AppContext) {
  const check = (request: FastifyRequest, reply: FastifyReply): void => {
    request.person = null;
    const { access, op } = request.routeOptions.config;
    if (access === undefined || op === undefined || !endpoints[op].path.startsWith('/api/v1/')) {
      return;
    }
    const opName: string = op;
    const cookie = request.cookies[SESSION_COOKIE];
    const cookieHash = cookie === undefined || cookie === '' ? null : hashCredential(cookie);
    const jobId = opName === 'getJob' ? jobIdParam(request) : null;
    const readsOwnRestoreJob =
      jobId !== null && cookieHash !== null && ctx.jobs.get(jobId, cookieHash)?.kind === 'restore';

    if (ctx.jobs.running()?.kind === 'restore' && !readsOwnRestoreJob) {
      throw problem('restoring', { retryAfterSeconds: RESTORE_RETRY_SECONDS });
    }
    if (readsOwnRestoreJob) {
      return;
    }
    const hasOwner = ownerExists(ctx.db);
    if (!hasOwner && access !== 'setup') {
      throw problem('setup_required');
    }

    const now = ctx.now();
    const bearer = bearerToken(request);
    if (bearer !== null) {
      const member = bearer === '' ? null : findToken(ctx.db, hashCredential(bearer), now);
      if (member === null) {
        throw problem('invalid_token');
      }
      request.person = personOf(member, 'token');
    } else if (cookie !== undefined && cookieHash !== null) {
      const session = findSession(ctx.db, cookieHash, now);
      if (session !== null) {
        request.person = personOf(session.member, 'session');
        if (session.touched) {
          reply.setCookie(
            SESSION_COOKIE,
            cookie,
            sessionCookieOptions(request.protocol === 'https', ctx.settings.basePath),
          );
        }
      }
    }

    const loginRequired = requireLoginOn(ctx.db);
    const credentialOptional = access === 'public' || access === 'setup' || access === 'profile-picker';
    if (request.person === null && !credentialOptional) {
      throw problem(loginRequired ? 'login_required' : 'profile_required');
    }

    const origin = request.headers.origin;
    if (
      bearer === null &&
      WRITE_METHODS.has(request.method) &&
      origin !== undefined &&
      !originMatches(origin, request.host)
    ) {
      throw problem('origin_mismatch');
    }

    if (request.person?.mustChangePassword === true && !PASSWORD_CHANGE_ALLOWED.has(opName)) {
      throw problem('password_change_required');
    }

    if (access === 'setup' && hasOwner) {
      throw problem('not_found');
    }
    if (access === 'profile-picker' && loginRequired) {
      throw problem('login_required');
    }
    if (access === 'owner' && request.person?.role !== 'owner') {
      throw problem('owner_only');
    }
  };

  return function accessPreHandler(request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void): void {
    try {
      check(request, reply);
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    done();
  };
}
