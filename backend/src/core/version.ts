import { readFileSync } from 'node:fs';

function readAppVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string'
  ) {
    throw new Error('backend/package.json has no version string');
  }
  return manifest.version;
}

export const APP_VERSION = readAppVersion();
