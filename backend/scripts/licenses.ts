import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stderr } from 'node:process';

interface LicenseEntry {
  name: string;
  version: string;
  license: string | null;
  url: string | null;
  text: string | null;
}

interface Node {
  [key: string]: unknown;
}

const PACKAGES = ['@cellar/backend', '@cellar/frontend'];
const LICENSE_FILE = /^licen[cs]e/i;
const PNPM_LS_MAX_BYTES = 64 * 1024 * 1024;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dependencyPaths(tree: unknown, into: Set<string>): void {
  if (!isNode(tree) || !isNode(tree.dependencies)) {
    return;
  }
  for (const dependency of Object.values(tree.dependencies)) {
    if (!isNode(dependency) || typeof dependency.path !== 'string') {
      continue;
    }
    const workspacePackage = typeof dependency.version === 'string' && dependency.version.startsWith('link:');
    const installed = existsSync(join(dependency.path, 'package.json'));
    if (!workspacePackage && installed) {
      into.add(dependency.path);
    }
    dependencyPaths(dependency, into);
  }
}

function productionPaths(): Set<string> {
  const paths = new Set<string>();
  for (const name of PACKAGES) {
    const output = execFileSync('pnpm', ['ls', '--prod', '--json', '--depth', '99', '--filter', name], {
      encoding: 'utf8',
      maxBuffer: PNPM_LS_MAX_BYTES,
    });
    const roots: unknown = JSON.parse(output);
    if (!Array.isArray(roots) || roots.length !== 1) {
      throw new Error(`pnpm ls for ${name} did not return exactly one project`);
    }
    dependencyPaths(roots[0], paths);
  }
  return paths;
}

function licenseName(manifest: Node, label: string): string | null {
  if (typeof manifest.license === 'string') {
    return manifest.license;
  }
  if (isNode(manifest.license) && typeof manifest.license.type === 'string') {
    return manifest.license.type;
  }
  stderr.write(`licenses: ${label} declares no license in package.json\n`);
  return null;
}

function projectUrl(manifest: Node): string | null {
  if (typeof manifest.homepage === 'string') {
    return manifest.homepage;
  }
  if (typeof manifest.repository === 'string') {
    return manifest.repository;
  }
  if (isNode(manifest.repository) && typeof manifest.repository.url === 'string') {
    return manifest.repository.url;
  }
  return null;
}

function licenseText(path: string, label: string): string | null {
  const file = readdirSync(path)
    .filter((name) => LICENSE_FILE.test(name))
    .sort()[0];
  if (file === undefined) {
    stderr.write(`licenses: ${label} ships no LICENSE or LICENCE file\n`);
    return null;
  }
  return readFileSync(join(path, file), 'utf8');
}

function entryFor(path: string): LicenseEntry {
  const manifest: unknown = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  if (!isNode(manifest) || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`${path}/package.json has no name and version`);
  }
  const label = `${manifest.name}@${manifest.version}`;
  return {
    name: manifest.name,
    version: manifest.version,
    license: licenseName(manifest, label),
    url: projectUrl(manifest),
    text: licenseText(path, label),
  };
}

const entries = new Map<string, LicenseEntry>();
for (const path of productionPaths()) {
  const entry = entryFor(path);
  entries.set(`${entry.name}@${entry.version}`, entry);
}
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = [...entries.values()].sort((a, b) => byCodeUnit(a.name, b.name) || byCodeUnit(a.version, b.version));

const outDir = new URL('../generated/', import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL('licenses.json', outDir), `${JSON.stringify(sorted, null, 2)}\n`);
