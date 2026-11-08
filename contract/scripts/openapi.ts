import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildOpenApiDocument } from '../src/schemas.ts';

const packageRoot = new URL('../', import.meta.url);
const manifest: unknown = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
if (
  typeof manifest !== 'object' ||
  manifest === null ||
  !('version' in manifest) ||
  typeof manifest.version !== 'string'
) {
  throw new Error('contract/package.json has no version string');
}

const document = buildOpenApiDocument({ version: manifest.version, basePath: '' });
const outDir = new URL('dist/', packageRoot);
await mkdir(outDir, { recursive: true });
await writeFile(new URL('openapi.json', outDir), `${JSON.stringify(document, null, 2)}\n`);
