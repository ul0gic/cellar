import { ERROR_STATUS, type FieldError, type Problem, type ProblemCode } from '@cellar/contract';
import type { FastifyError, FastifyReply, FastifyRequest, FastifySchemaValidationError } from 'fastify';
import type { Logger } from './logger.ts';

export class StartupExit extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, message: string) {
    super(message);
    this.name = 'StartupExit';
    this.exitCode = exitCode;
  }
}

type ProblemExtra = Partial<Omit<Problem, 'type' | 'title' | 'status' | 'code' | 'detail' | 'requestId' | 'fields'>>;

export class ProblemError extends Error {
  readonly code: ProblemCode;
  readonly status: number;
  readonly detail: string;
  readonly fields: readonly FieldError[] | undefined;
  readonly extra: ProblemExtra;

  constructor(code: ProblemCode, detail: string, fields?: readonly FieldError[], extra: ProblemExtra = {}) {
    super(detail);
    this.name = 'ProblemError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.detail = detail;
    this.fields = fields;
    this.extra = extra;
  }
}

const FIXED_DETAIL = {
  bad_request: "Cellar couldn't read that request.",
  validation_failed: 'Check the highlighted fields.',
  prices_hidden: 'Turn on Show prices to sort by price.',
  login_required: 'Sign in to continue.',
  profile_required: "Choose who's here.",
  invalid_credentials: "That name and password don't match.",
  invalid_token: "This API token isn't valid. Create a new one in Settings.",
  owner_only: 'Only the owner can do this.',
  origin_mismatch: 'This request came from another site and was blocked.',
  password_change_required: 'Set a new password to continue.',
  not_found: "There's nothing here.",
  setup_required: "Cellar isn't set up yet.",
  menu_not_live: "This menu isn't live, so it has no link.",
  cannot_remove_owner: "The owner can't be removed.",
  token_limit: 'You have 20 tokens. Revoke one you no longer use.',
  image_in_use: 'This image is in use.',
  job_running: 'Another catalog or restore job is running. Wait for it to finish.',
  catalog_loaded: 'The catalog is already loaded.',
  catalog_update_unavailable: "That catalog version isn't available. Check for updates again.",
  ai_not_configured: 'AI is off. The owner can add an OpenAI key in Settings.',
  url_not_allowed: 'Cellar only imports from public web addresses.',
  page_too_large: 'That page is larger than 5 MB, so Cellar stopped reading it.',
  no_recipe_data: 'This page has no recipe data Cellar can read. Paste the recipe text instead.',
  backup_invalid: "This file isn't a Cellar backup, or it's damaged.",
  archive_too_large: 'This archive is too large or has unsafe paths, so nothing was restored.',
  catalog_invalid: "The catalog download didn't check out. Nothing changed. Try again later.",
  internal_error:
    'Something went wrong on the server. Nothing was saved. The server log has details under {requestId}.',
  catalog_unreachable: "Couldn't reach Cellar's release server. Check the host's internet connection.",
  restoring: 'Cellar is restoring a backup. This takes up to a minute.',
  fetch_timeout: 'That page took longer than 15 seconds to answer.',
  ai_timeout: 'The AI service timed out. Nothing changed.',
  catalog_index_invalid: "Cellar's catalog list couldn't be read. Try again later.",
  catalog_url_refused: "This catalog download points somewhere Cellar doesn't trust, so it was not fetched.",
  catalog_download_failed: "The catalog download didn't finish. Try again.",
  catalog_damaged: 'The catalog download was damaged, so nothing was changed. Try again.',
  catalog_too_large: 'This catalog is larger than Cellar accepts (512 MB), so it was not loaded.',
  catalog_busy: 'A catalog load is already running. It will finish on its own.',
  busy: 'Cellar is busy. Try again.',
} as const satisfies Partial<Record<ProblemCode, string>>;

type FixedCode = keyof typeof FIXED_DETAIL;
type TemplatedCode = Exclude<ProblemCode, FixedCode>;

interface ProblemOptions extends ProblemExtra {
  readonly detail?: string;
  readonly fields?: readonly FieldError[];
}

export function problem(code: FixedCode, options?: ProblemOptions): ProblemError;
export function problem(code: TemplatedCode, options: ProblemOptions & { readonly detail: string }): ProblemError;
export function problem(code: ProblemCode, options: ProblemOptions = {}): ProblemError {
  const { detail, fields, ...extra } = options;
  const fixed: Partial<Record<ProblemCode, string>> = FIXED_DETAIL;
  const text = detail ?? fixed[code];
  if (text === undefined) {
    throw new Error(`problem(${code}) needs a detail`);
  }
  return new ProblemError(code, text, fields, extra);
}

function titleOf(code: ProblemCode): string {
  const words = code.replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function problemBody(failure: ProblemError, requestId: string): Problem {
  return {
    ...failure.extra,
    type: `urn:cellar:problem:${failure.code}`,
    title: titleOf(failure.code),
    status: failure.status,
    code: failure.code,
    detail: failure.detail.replace('{requestId}', requestId),
    requestId,
    ...(failure.fields === undefined ? {} : { fields: [...failure.fields] }),
  };
}

function numberParam(params: Readonly<Record<string, unknown>>, name: string): number | undefined {
  const value = params[name];
  if (typeof value === 'number') {
    return value;
  }
  return typeof value === 'bigint' ? Number(value) : undefined;
}

function valueAt(input: unknown, path: readonly string[]): unknown {
  let current = input;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = Object.entries(current).find(([key]) => key === segment)?.[1];
  }
  return current;
}

function rangeMessage(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) {
    return `Enter a number from ${min} to ${max}.`;
  }
  return min === undefined ? `Enter a number no more than ${max}.` : `Enter a number of at least ${min}.`;
}

function formatMessage(format: unknown): string {
  if (format === 'date' || format === 'datetime') {
    return 'Enter a date like 2026-11-08.';
  }
  return format === 'url'
    ? 'Enter a web address starting with http:// or https://.'
    : 'Check the format of this field.';
}

const NUMBER_ORIGINS = new Set(['number', 'int', 'bigint']);

function fieldErrorsOf(issue: FastifySchemaValidationError, input: unknown): FieldError[] {
  const segments = issue.instancePath.split('/').filter((segment) => segment !== '');
  const path = segments.join('.');
  const params = issue.params;
  const origin = params.origin;
  switch (issue.keyword) {
    case 'invalid_type':
      return valueAt(input, segments) === undefined
        ? [{ path, code: 'required', message: 'Enter a value.' }]
        : [{ path, code: 'invalid_value', message: 'Choose one of the options.' }];
    case 'too_small': {
      const min = numberParam(params, 'minimum');
      if (typeof origin === 'string' && NUMBER_ORIGINS.has(origin)) {
        return [{ path, code: 'out_of_range', message: rangeMessage(min, undefined) }];
      }
      return [{ path, code: 'too_short', message: `Use at least ${min} characters.` }];
    }
    case 'too_big': {
      const max = numberParam(params, 'maximum');
      if (typeof origin === 'string' && NUMBER_ORIGINS.has(origin)) {
        return [{ path, code: 'out_of_range', message: rangeMessage(undefined, max) }];
      }
      if (origin === 'string') {
        return [{ path, code: 'too_long', message: `Keep it under ${max} characters.` }];
      }
      return [{ path, code: 'too_many', message: `Use at most ${max}.` }];
    }
    case 'invalid_format':
      return [{ path, code: 'invalid_format', message: formatMessage(params.format) }];
    case 'unrecognized_keys': {
      const keys = Array.isArray(params.keys) ? params.keys.filter((key) => typeof key === 'string') : [];
      return keys.map((key) => ({
        path: path === '' ? key : `${path}.${key}`,
        code: 'invalid_value',
        message: "Remove this field; Cellar doesn't accept it.",
      }));
    }
    case 'custom':
      return [{ path, code: 'invalid_value', message: issue.message ?? 'Choose one of the options.' }];
    default:
      return [{ path, code: 'invalid_value', message: 'Choose one of the options.' }];
  }
}

export function validationProblem(issues: readonly FastifySchemaValidationError[], input: unknown): ProblemError {
  return problem('validation_failed', { fields: issues.flatMap((issue) => fieldErrorsOf(issue, input)) });
}

function sizeText(bytes: number): string {
  if (bytes >= 2 ** 30) {
    return `${Math.round(bytes / 2 ** 30)} GB`;
  }
  return bytes >= 2 ** 20 ? `${Math.round(bytes / 2 ** 20)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function payloadTooLarge(limitBytes: number): ProblemError {
  return problem('payload_too_large', {
    detail: `This file is too large. The limit is ${sizeText(limitBytes)}.`,
    limitBytes,
  });
}

function validationInput(request: FastifyRequest, context: string | undefined): unknown {
  switch (context) {
    case 'body':
      return request.body;
    case 'querystring':
      return request.query;
    case 'params':
      return request.params;
    default:
      return undefined;
  }
}

const SQLITE_BUSY = 5;
const SQLITE_FULL = 13;
const DISK_FULL_LOG_INTERVAL_MS = 60_000;

function sqliteCode(error: unknown): number | undefined {
  if (error instanceof Error && 'errcode' in error && typeof error.errcode === 'number') {
    return error.errcode & 0xff;
  }
  return undefined;
}

function isDiskFull(error: unknown): boolean {
  return sqliteCode(error) === SQLITE_FULL || (error instanceof Error && 'code' in error && error.code === 'ENOSPC');
}

function isFastifyError(error: unknown): error is FastifyError {
  return error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number';
}

export function createErrorHandler(log: Logger, bodyLimitBytes: number) {
  let lastDiskFullLog = Number.NEGATIVE_INFINITY;

  const toProblem = (error: unknown, request: FastifyRequest): ProblemError => {
    if (error instanceof ProblemError) {
      return error;
    }
    if (isFastifyError(error) && error.validation !== undefined) {
      const input = validationInput(request, error.validationContext);
      return validationProblem(error.validation, input);
    }
    if (isFastifyError(error) && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return payloadTooLarge(bodyLimitBytes);
    }
    if (isFastifyError(error) && error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return problem('bad_request');
    }
    if (sqliteCode(error) === SQLITE_BUSY) {
      log.warn('The database stayed locked for 5 s.', { reqId: request.id });
      return problem('busy');
    }
    if (isDiskFull(error)) {
      const now = Date.now();
      if (now - lastDiskFullLog >= DISK_FULL_LOG_INTERVAL_MS) {
        lastDiskFullLog = now;
        log.error('The disk is full; writes are failing.', { reqId: request.id });
      }
      return problem('insufficient_storage', { detail: 'The disk is full; writes are failing.' });
    }
    log.error('Request failed', { reqId: request.id, err: error });
    return problem('internal_error');
  };

  return (error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply => {
    const failure = toProblem(error, request);
    if (failure.extra.retryAfterSeconds !== undefined) {
      reply.header('Retry-After', String(failure.extra.retryAfterSeconds));
    }
    return reply.code(failure.status).type('application/problem+json').send(problemBody(failure, request.id));
  };
}
