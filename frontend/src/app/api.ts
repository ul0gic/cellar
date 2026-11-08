import {
  buildPath,
  type ErrorCode,
  endpoints,
  type FieldError,
  isProblem,
  type OperationId,
  type OperationInput,
  type OperationOutput,
  type Problem,
} from '@cellar/contract';
import { text } from '../text/index.ts';
import { basePath } from './base.ts';

export type ApiInput<Op extends OperationId> = OperationInput<Op>;
export type ApiOutput<Op extends OperationId> = OperationOutput<Op>;

interface WireInput {
  readonly params?: unknown;
  readonly query?: unknown;
  readonly body?: unknown;
}

type PathParams = Readonly<Record<string, string | number>>;

function isPathParams(value: unknown): value is PathParams {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((item) => typeof item === 'string' || typeof item === 'number')
  );
}

function isQueryItem(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string;
  readonly fields: readonly FieldError[];
  readonly requestId: string;
  readonly problem: Problem | null;

  constructor(code: ErrorCode, status: number, detail: string, problem: Problem | null) {
    super(detail);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.fields = problem?.fields ?? [];
    this.requestId = problem?.requestId ?? '';
    this.problem = problem;
  }
}

export const AUTH_CODES = ['setup_required', 'login_required', 'profile_required', 'password_change_required'] as const;
export type AuthCode = (typeof AUTH_CODES)[number];

const RETRY_MS = 10_000;
const UNREACHABLE_AFTER_MS = 10_000;

const authListeners = new Set<(code: AuthCode) => void>();
const reachListeners = new Set<(reachable: boolean) => void>();
let reachable = true;
let answeredOnce = false;
let failingSince: number | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function isAuthCode(code: ErrorCode): code is AuthCode {
  return AUTH_CODES.some((auth) => auth === code);
}

function setReachable(next: boolean): void {
  if (reachable === next) {
    return;
  }
  reachable = next;
  for (const listener of reachListeners) {
    listener(next);
  }
}

function answered(): void {
  answeredOnce = true;
  failingSince = null;
  setReachable(true);
}

function unanswered(): void {
  const now = Date.now();
  failingSince ??= now;
  if (!answeredOnce || now - failingSince >= UNREACHABLE_AFTER_MS) {
    setReachable(false);
    scheduleRetry();
  }
}

function scheduleRetry(): void {
  if (retryTimer !== null) {
    return;
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!reachable) {
      void checkReachable();
    }
  }, RETRY_MS);
}

export async function checkReachable(): Promise<boolean> {
  try {
    await call('healthcheck', {});
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'network_error') {
      return false;
    }
    throw error;
  }
}

export function onReachabilityChange(fn: (reachable: boolean) => void): () => void {
  reachListeners.add(fn);
  return () => {
    reachListeners.delete(fn);
  };
}

export function onAuthProblem(fn: (code: AuthCode) => void): () => void {
  authListeners.add(fn);
  return () => {
    authListeners.delete(fn);
  };
}

function searchOf(query: unknown): string {
  if (typeof query !== 'object' || query === null) {
    return '';
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const items: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (isQueryItem(item)) {
        search.append(key, String(item));
      }
    }
  }
  const encoded = search.toString();
  return encoded.length > 0 ? `?${encoded}` : '';
}

function requestBody(body: unknown): { body?: BodyInit; headers: Record<string, string> } {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body === undefined) {
    return { headers };
  }
  if (body instanceof FormData) {
    return { body, headers };
  }
  headers['content-type'] = 'application/json';
  return { body: JSON.stringify(body), headers };
}

async function problemOf(response: Response): Promise<ApiError> {
  const type = response.headers.get('content-type') ?? '';
  const parsed: unknown = type.includes('json') ? await response.json() : null;
  if (isProblem(parsed)) {
    return new ApiError(parsed.code, parsed.status, parsed.detail, parsed);
  }
  if (response.status >= 500) {
    return new ApiError('network_error', response.status, text('error.network_error'), null);
  }
  return new ApiError('bad_request', response.status, text('error.bad_request'), null);
}

function successOf(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return Promise.resolve(undefined);
  }
  const type = response.headers.get('content-type') ?? '';
  return type.includes('json') ? response.json() : response.blob();
}

function report(error: ApiError): ApiError {
  if (error.code === 'network_error') {
    unanswered();
    return error;
  }
  answered();
  if (isAuthCode(error.code)) {
    const code = error.code;
    for (const listener of authListeners) {
      listener(code);
    }
  }
  return error;
}

export async function call<Op extends OperationId>(op: Op, input: ApiInput<Op>): Promise<ApiOutput<Op>>;
export async function call(op: OperationId, input: WireInput): Promise<unknown> {
  const endpoint = endpoints[op];
  const params = input.params === undefined || isPathParams(input.params) ? input.params : undefined;
  if (input.params !== undefined && params === undefined) {
    throw new TypeError(`${op} path parameters must be strings or numbers`);
  }
  const url = `${basePath()}${buildPath(op, params)}${searchOf(input.query)}`;
  let response: Response;
  try {
    response = await fetch(url, { method: endpoint.method, credentials: 'same-origin', ...requestBody(input.body) });
  } catch (error) {
    if (error instanceof TypeError) {
      throw report(new ApiError('network_error', 0, text('error.network_error'), null));
    }
    throw error;
  }
  if (!response.ok) {
    throw report(await problemOf(response));
  }
  answered();
  return successOf(response);
}

export const api = { call };
