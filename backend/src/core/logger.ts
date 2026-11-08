import { stdout } from 'node:process';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

type LogFields = Readonly<Record<string, unknown>>;
type LogMethod = (msg: string, fields?: LogFields) => void;

export interface Logger {
  error: LogMethod;
  warn: LogMethod;
  info: LogMethod;
  debug: LogMethod;
  child(fields: LogFields): Logger;
}

const REDACTED_KEYS = new Set(
  [
    'password',
    'currentPassword',
    'newPassword',
    'ownerPassword',
    'oneTimePassword',
    'key',
    'secret',
    'token',
    'authorization',
    'cookie',
    'set-cookie',
  ].map((key) => key.toLowerCase()),
);

const MENU_TOKEN_PATH = /\/m\/(?!_\/)[^/?#\s"]+/g;
const API_TOKEN = /clr_[A-Za-z0-9_-]+/g;

export function redactText(text: string): string {
  return text.replace(MENU_TOKEN_PATH, '/m/[token]').replace(API_TOKEN, 'clr_[redacted]');
}

function errorFields(error: Error): Record<string, unknown> {
  return {
    type: error.name,
    message: redactText(error.message),
    stack: error.stack === undefined ? null : redactText(error.stack),
  };
}

function scrubFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(fields)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : scrub(inner);
  }
  return out;
}

function scrub(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (value instanceof Error) {
    return errorFields(value);
  }
  if (Array.isArray(value)) {
    return value.map(scrub);
  }
  if (typeof value === 'object' && value !== null) {
    return scrubFields({ ...value });
  }
  return value;
}

export function createLogger(level: LogLevel, write: (line: string) => void = (line) => stdout.write(line)): Logger {
  const threshold = LOG_LEVELS.indexOf(level);
  const build = (bound: LogFields): Logger => {
    const emit =
      (lineLevel: LogLevel): LogMethod =>
      (msg, fields) => {
        if (LOG_LEVELS.indexOf(lineLevel) > threshold) {
          return;
        }
        const body = scrubFields({ ...bound, ...fields });
        write(
          `${JSON.stringify({ time: new Date().toISOString(), level: lineLevel, msg: redactText(msg), ...body })}\n`,
        );
      };
    return {
      error: emit('error'),
      warn: emit('warn'),
      info: emit('info'),
      debug: emit('debug'),
      child: (fields) => build({ ...bound, ...fields }),
    };
  };
  return build({});
}
