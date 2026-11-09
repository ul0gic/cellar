import { resolve } from 'node:path';
import { type IpRange, PRIVATE_RANGES, parseIpRange } from './ip.ts';
import { LOG_LEVELS, type LogLevel } from './logger.ts';
import { StartupExit } from './problems.ts';

export interface Settings {
  readonly basePath: string;
  readonly trustedProxies: readonly IpRange[];
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly catalogUrl: URL;
  readonly dataDir: string;
  readonly shippedCatalogDir: string;
  readonly outboundAllow: readonly string[];
  readonly aiBaseUrl: URL | null;
}

const DEFAULT_CATALOG_URL = 'https://github.com/ul0gic/cellar/releases/download/catalog/catalog-index.json';

function invalid(message: string): never {
  throw new StartupExit(2, message);
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function parseBasePath(value: string | undefined): string {
  if (value === undefined) {
    return '';
  }
  if (!/^\/[A-Za-z0-9\-_./]*$/.test(value)) {
    invalid(`CELLAR_BASE_PATH must start with / and contain only letters, digits, - _ . and /. Got: ${value}`);
  }
  return value.replace(/\/+$/, '');
}

function parseTrustedProxies(value: string | undefined): readonly IpRange[] {
  if (value === undefined) {
    return [];
  }
  const ranges: IpRange[] = [];
  for (const entry of value.split(',').map((part) => part.trim())) {
    if (entry === '') {
      continue;
    }
    if (entry === 'private') {
      ranges.push(...PRIVATE_RANGES);
      continue;
    }
    const range = parseIpRange(entry);
    if (range === null) {
      invalid(`CELLAR_TRUSTED_PROXIES has an entry that isn't an address or range: ${entry}`);
    }
    ranges.push(range);
  }
  return ranges;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 7380;
  }
  const port = /^[0-9]{1,5}$/.test(value) ? Number.parseInt(value, 10) : 0;
  if (port < 1 || port > 65_535) {
    invalid(`CELLAR_PORT must be a number from 1 to 65535. Got: ${value}`);
  }
  return port;
}

function isLogLevel(value: string): value is LogLevel {
  return LOG_LEVELS.some((level) => level === value);
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined) {
    return 'info';
  }
  if (!isLogLevel(value)) {
    invalid(`CELLAR_LOG_LEVEL must be one of error, warn, info, debug. Got: ${value}`);
  }
  return value;
}

function parseHttpsUrl(name: string, value: string): URL {
  const url = URL.parse(value);
  if (url === null || url.protocol !== 'https:') {
    invalid(`${name} must be an https:// address. Got: ${value}`);
  }
  return url;
}

function parseHostList(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
}

export function loadSettings(env: NodeJS.ProcessEnv): Settings {
  const aiBaseUrl = read(env, 'CELLAR_AI_BASE_URL');
  return {
    basePath: parseBasePath(read(env, 'CELLAR_BASE_PATH')),
    trustedProxies: parseTrustedProxies(read(env, 'CELLAR_TRUSTED_PROXIES')),
    port: parsePort(read(env, 'CELLAR_PORT')),
    logLevel: parseLogLevel(read(env, 'CELLAR_LOG_LEVEL')),
    catalogUrl: parseHttpsUrl('CELLAR_CATALOG_URL', read(env, 'CELLAR_CATALOG_URL') ?? DEFAULT_CATALOG_URL),
    dataDir: resolve(read(env, 'CELLAR_DATA_DIR') ?? '/data'),
    shippedCatalogDir: resolve(read(env, 'CELLAR_SHIPPED_CATALOG_DIR') ?? '/app/catalog'),
    outboundAllow: parseHostList(read(env, 'CELLAR_OUTBOUND_ALLOW')),
    aiBaseUrl: aiBaseUrl === undefined ? null : parseHttpsUrl('CELLAR_AI_BASE_URL', aiBaseUrl),
  };
}
