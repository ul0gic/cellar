import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CommandError, outputError } from './exit.ts';
import type { MediaType } from './image.ts';
import { compareCodePoints } from './read.ts';
import { type Catalog, type DatasetImage, FORMAT_VERSION, type Notice } from './validate.ts';

export interface ImageRef {
  file: string;
  mediaType: MediaType;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  placeholder: string | null;
}

export interface Counts {
  recipes: number;
  ingredients: number;
  images: number;
  glasses: number;
  methods: number;
  utensils: number;
  calculators: number;
  tasteDescriptors: number;
  tags: number;
}

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  format: 'cellar-catalog';
  formatVersion: number;
  version: string;
  counts: Counts;
  imageBytes: number;
  files: ManifestFile[];
}

export interface BuildReport {
  version: string;
  counts: Counts;
  imageBytes: number;
  notices: Notice[];
}

export const RECORD_TYPES = [
  'recipes',
  'ingredients',
  'glasses',
  'methods',
  'utensils',
  'calculators',
  'tasteDescriptors',
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export interface RecordSummary {
  key: string;
  rev: string;
  name: string;
}

export interface Release {
  name: string;
  files: { path: string; bytes: Buffer }[];
  records: Record<RecordType, RecordSummary[]>;
  manifest: Manifest;
  report: BuildReport;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function releaseName(version: string): string {
  return `cellar-catalog-${version}`;
}

function withRev<T extends { key: string }>(record: T): { key: string; rev: string } & Omit<T, 'key'> {
  const { key, ...rest } = record;
  const rev = sha256Hex(JSON.stringify(record, null, 2)).slice(0, 16);
  return { key, rev, ...rest };
}

export function buildRelease(catalog: Catalog): Release {
  const imageRef = (image: DatasetImage): ImageRef => {
    const data = catalog.images.get(image.file);
    if (data === undefined) {
      throw new Error(`image ${image.file} was not read`);
    }
    return {
      file: image.file,
      mediaType: data.header.mediaType,
      width: data.width,
      height: data.height,
      bytes: data.bytes.length,
      sha256: sha256Hex(data.bytes),
      placeholder: image.placeholder,
    };
  };
  const ingredients = catalog.ingredients.map((record) => withRev({ ...record, images: record.images.map(imageRef) }));
  const recipes = catalog.recipes.map((record) => withRev({ ...record, images: record.images.map(imageRef) }));
  const glasses = catalog.glasses.map(withRev);
  const methods = catalog.methods.map(withRev);
  const utensils = catalog.utensils.map(withRev);
  const tasteDescriptors = catalog.tasteDescriptors.map(withRev);
  const calculators = catalog.calculators.map(withRev);
  const dataFiles: [string, unknown][] = [
    ['data/glasses.json', glasses],
    ['data/methods.json', methods],
    ['data/utensils.json', utensils],
    ['data/taste-descriptors.json', tasteDescriptors],
    ['data/calculators.json', calculators],
    ['data/ingredients.json', ingredients],
    ['data/recipes.json', recipes],
  ];
  const summary = (list: RecordSummary[]): RecordSummary[] =>
    list.map((record) => ({ key: record.key, rev: record.rev, name: record.name }));
  const files = [
    ...dataFiles.map(([path, value]) => ({ path, bytes: Buffer.from(canonicalJson(value), 'utf8') })),
    ...[...catalog.images.entries()].map(([path, data]) => ({ path, bytes: data.bytes })),
  ].sort((a, b) => compareCodePoints(a.path, b.path));

  const imageBytes = [...catalog.images.values()].reduce((sum, data) => sum + data.bytes.length, 0);
  const counts: Counts = {
    recipes: catalog.recipes.length,
    ingredients: catalog.ingredients.length,
    images: catalog.images.size,
    glasses: catalog.glasses.length,
    methods: catalog.methods.length,
    utensils: catalog.utensils.length,
    calculators: catalog.calculators.length,
    tasteDescriptors: catalog.tasteDescriptors.length,
    tags: new Set(catalog.recipes.flatMap((recipe) => recipe.tags)).size,
  };
  return {
    name: releaseName(catalog.version),
    files,
    records: {
      recipes: summary(recipes),
      ingredients: summary(ingredients),
      glasses: summary(glasses),
      methods: summary(methods),
      utensils: summary(utensils),
      calculators: summary(calculators),
      tasteDescriptors: summary(tasteDescriptors),
    },
    manifest: {
      format: 'cellar-catalog',
      formatVersion: FORMAT_VERSION,
      version: catalog.version,
      counts,
      imageBytes,
      files: files.map((file) => ({ path: file.path, bytes: file.bytes.length, sha256: sha256Hex(file.bytes) })),
    },
    report: { version: catalog.version, counts, imageBytes, notices: catalog.notices },
  };
}

export function writeRelease(
  release: Release,
  outDir: string,
  force: boolean,
): { releaseDir: string; reportPath: string; totalBytes: number } {
  const releaseDir = join(outDir, release.name);
  const reportPath = join(outDir, `${release.name}.report.json`);
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (error) {
    throw outputError(outDir, error) ?? error;
  }
  if (!force) {
    for (const path of [releaseDir, reportPath]) {
      if (existsSync(path)) {
        throw new CommandError(5, [`${path} exists; pass --force to replace it`]);
      }
    }
  }
  let temp: string;
  try {
    temp = mkdtempSync(join(outDir, `.${release.name}-`));
  } catch (error) {
    throw outputError(outDir, error) ?? error;
  }
  const manifestBytes = Buffer.from(canonicalJson(release.manifest), 'utf8');
  try {
    const stagedRelease = join(temp, release.name);
    const stagedReport = join(temp, 'report.json');
    for (const file of release.files) {
      const target = join(stagedRelease, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
    }
    writeFileSync(join(stagedRelease, 'manifest.json'), manifestBytes);
    writeFileSync(stagedReport, canonicalJson(release.report));
    if (force) {
      rmSync(releaseDir, { recursive: true, force: true });
      rmSync(reportPath, { force: true });
    }
    renameSync(stagedRelease, releaseDir);
    renameSync(stagedReport, reportPath);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw outputError(outDir, error) ?? error;
  }
  rmSync(temp, { recursive: true, force: true });
  const totalBytes = release.files.reduce((sum, file) => sum + file.bytes.length, manifestBytes.length);
  return { releaseDir, reportPath, totalBytes };
}
