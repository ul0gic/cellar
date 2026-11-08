import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const DATA_FILES = [
  'glasses',
  'methods',
  'utensils',
  'taste-descriptors',
  'calculators',
  'ingredients',
  'recipes',
] as const;
export type DataFile = (typeof DATA_FILES)[number];

export interface Problem {
  file: string;
  record: string | null;
  where: string | null;
  rule: string | null;
  message: string;
}

export interface DatasetFiles {
  version: unknown;
  data: Record<DataFile, unknown>;
  imageFiles: string[];
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

export function readJsonFile(
  path: string,
): { ok: true; value: unknown } | { ok: false; reason: 'missing' | 'invalid' } {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return { ok: false, reason: 'missing' };
    }
    throw error;
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, reason: 'invalid' };
    }
    throw error;
  }
}

export function readBytes(root: string, file: string): Buffer | null {
  try {
    return readFileSync(join(root, file));
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

export function listFiles(root: string, folder: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, folder), { recursive: true, withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort(compareCodePoints);
}

export function compareCodePoints(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function readDataset(dir: string): { ok: true; files: DatasetFiles } | { ok: false; problems: Problem[] } {
  const problems: Problem[] = [];
  const version = readJsonFile(join(dir, 'version.json'));
  if (!version.ok) {
    const message =
      version.reason === 'missing'
        ? `${dir} is not a Cellar dataset: version.json is missing`
        : 'version.json is not valid JSON';
    problems.push({ file: 'version.json', record: null, where: null, rule: null, message });
  }
  const data: Partial<Record<DataFile, unknown>> = {};
  for (const name of DATA_FILES) {
    const file = `data/${name}.json`;
    const read = readJsonFile(join(dir, file));
    if (read.ok) {
      data[name] = read.value;
    } else {
      const message = read.reason === 'missing' ? `${file} is missing` : `${file} is not valid JSON`;
      problems.push({ file, record: null, where: null, rule: null, message });
    }
  }
  if (!version.ok || problems.length > 0) {
    return { ok: false, problems };
  }
  const complete: Record<DataFile, unknown> = {
    glasses: data.glasses,
    methods: data.methods,
    utensils: data.utensils,
    'taste-descriptors': data['taste-descriptors'],
    calculators: data.calculators,
    ingredients: data.ingredients,
    recipes: data.recipes,
  };
  return { ok: true, files: { version: version.value, data: complete, imageFiles: listFiles(dir, 'images') } };
}
