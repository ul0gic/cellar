import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CommandError, outputError } from './exit.ts';
import {
  compareCodePoints,
  DATA_FILES,
  type DataFile,
  listFiles,
  type Problem,
  readBytes,
  readJsonFile,
} from './read.ts';
import {
  buildRelease,
  type Counts,
  canonicalJson,
  type Manifest,
  type ManifestFile,
  RECORD_TYPES,
  type RecordSummary,
  type RecordType,
  type Release,
  releaseName,
  sha256Hex,
} from './release.ts';
import { FORMAT_VERSION, VERSION_PATTERN, validateDataset } from './validate.ts';
import { storedZip } from './zip.ts';

export interface PackOptions {
  releaseDir: string;
  baseUrl: string;
  previous: string | null;
  index: string | null;
  out: string;
}

interface CheckedRelease {
  release: Release;
  manifest: Manifest;
  manifestBytes: Buffer;
  bytes: Map<string, Buffer>;
}

const RELEASE_PATH =
  /^(manifest\.json|data\/(glasses|methods|utensils|taste-descriptors|calculators|ingredients|recipes)\.json|images\/(recipes|ingredients)\/[a-z0-9]+(-[a-z0-9]+)*\/[1-9]\.(webp|jpg|png))$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COUNT_KEYS = [
  'recipes',
  'ingredients',
  'images',
  'glasses',
  'methods',
  'utensils',
  'calculators',
  'tasteDescriptors',
  'tags',
] as const;
const COUNT_SOURCES: Readonly<Record<keyof Counts, string>> = {
  recipes: 'recipes.json has',
  ingredients: 'ingredients.json has',
  images: 'the records name',
  glasses: 'glasses.json has',
  methods: 'methods.json has',
  utensils: 'utensils.json has',
  calculators: 'calculators.json has',
  tasteDescriptors: 'taste-descriptors.json has',
  tags: 'recipes.json has distinct',
};
const LABELS: Readonly<Record<RecordType, string>> = {
  recipes: 'recipes',
  ingredients: 'ingredients',
  glasses: 'glasses',
  methods: 'methods',
  utensils: 'utensils',
  calculators: 'calculators',
  tasteDescriptors: 'taste descriptors',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function integer(n: number): string {
  return n.toLocaleString('en-US');
}

function packProblem(problem: Problem): string {
  if (problem.record === null) {
    return problem.where === null ? problem.message : `${problem.file} ${problem.where}: ${problem.message}`;
  }
  const type = problem.file.replace(/^data\//, '').replace(/\.json$/, '');
  const where = problem.where === null ? '' : ` ${problem.where}`;
  const message =
    problem.rule === 'X-04' ? problem.message.replace(/ names no record$/, ' not found') : problem.message;
  return `${type} "${problem.record}"${where}: ${message}`;
}

function readManifest(dir: string): Manifest {
  const read = readJsonFile(join(dir, 'manifest.json'));
  if (!read.ok) {
    throw new CommandError(4, [
      read.reason === 'missing' ? `${dir} has no manifest.json` : 'manifest.json is not valid JSON',
    ]);
  }
  const m = read.value;
  const fail = (what: string): never => {
    throw new CommandError(4, [`manifest.json: ${what}`]);
  };
  if (!isRecord(m)) {
    return fail('is not a JSON object');
  }
  if (m.format !== 'cellar-catalog') {
    fail('format is not "cellar-catalog"');
  }
  if (m.formatVersion !== FORMAT_VERSION) {
    fail(`formatVersion is ${JSON.stringify(m.formatVersion)}; this tool reads ${FORMAT_VERSION}`);
  }
  if (typeof m.version !== 'string' || !VERSION_PATTERN.test(m.version)) {
    return fail('version must be YYYY.MM.DD-N');
  }
  if (basename(dir) !== releaseName(m.version)) {
    fail(`version ${m.version} does not match the folder name ${basename(dir)}`);
  }
  const counts = m.counts;
  if (!isRecord(counts) || !COUNT_KEYS.every((key) => isCount(counts[key]))) {
    return fail('counts must hold a whole number for each record type');
  }
  if (!isCount(m.imageBytes)) {
    return fail('imageBytes must be a whole number');
  }
  if (!Array.isArray(m.files)) {
    return fail('files must be an array');
  }
  const files: ManifestFile[] = [];
  for (const entry of m.files) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== 'string' ||
      !isCount(entry.bytes) ||
      typeof entry.sha256 !== 'string' ||
      !SHA256.test(entry.sha256)
    ) {
      return fail('every files entry must be { path, bytes, sha256 }');
    }
    files.push({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 });
  }
  return {
    format: 'cellar-catalog',
    formatVersion: FORMAT_VERSION,
    version: m.version,
    counts: {
      recipes: Number(counts.recipes),
      ingredients: Number(counts.ingredients),
      images: Number(counts.images),
      glasses: Number(counts.glasses),
      methods: Number(counts.methods),
      utensils: Number(counts.utensils),
      calculators: Number(counts.calculators),
      tasteDescriptors: Number(counts.tasteDescriptors),
      tags: Number(counts.tags),
    },
    imageBytes: m.imageBytes,
    files,
  };
}

function checkFiles(dir: string, manifest: Manifest): Map<string, Buffer> {
  const problems: string[] = [];
  const listed = new Set<string>();
  let previous = '';
  for (const file of manifest.files) {
    if (file.path === 'manifest.json' || !RELEASE_PATH.test(file.path)) {
      problems.push(`manifest.json lists ${file.path}, which is not a release path`);
    } else if (file.path <= previous) {
      problems.push('manifest.json: files are not sorted by path, or one repeats');
    }
    previous = file.path;
    listed.add(file.path);
  }
  for (const path of listFiles(dir, '')) {
    if (path !== 'manifest.json' && !listed.has(path)) {
      problems.push(`unexpected file ${path}`);
    }
  }
  for (const name of DATA_FILES) {
    if (!listed.has(`data/${name}.json`)) {
      problems.push(`manifest.json does not list data/${name}.json`);
    }
  }
  const bytes = new Map<string, Buffer>();
  for (const file of manifest.files) {
    const data = readBytes(dir, file.path);
    if (data === null) {
      problems.push(`${file.path} is missing`);
    } else if (data.length !== file.bytes || sha256Hex(data) !== file.sha256) {
      problems.push(`${file.path}: checksum does not match the manifest`);
    } else {
      bytes.set(file.path, data);
    }
  }
  if (problems.length > 0) {
    throw new CommandError(4, problems);
  }
  return bytes;
}

function toDatasetShape(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((record) => {
    if (!isRecord(record)) {
      return record;
    }
    const shaped = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'rev'));
    if (Array.isArray(shaped.images)) {
      shaped.images = shaped.images.map((image) =>
        isRecord(image) ? { file: image.file, placeholder: image.placeholder } : image,
      );
    }
    return shaped;
  });
}

function parseData(bytes: Map<string, Buffer>): Record<DataFile, unknown> {
  const parse = (name: DataFile): unknown => {
    const data = bytes.get(`data/${name}.json`);
    if (data === undefined) {
      throw new Error(`data/${name}.json was not read`);
    }
    try {
      return JSON.parse(data.toString('utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new CommandError(4, [`data/${name}.json is not valid JSON`]);
      }
      throw error;
    }
  };
  return {
    glasses: parse('glasses'),
    methods: parse('methods'),
    utensils: parse('utensils'),
    'taste-descriptors': parse('taste-descriptors'),
    calculators: parse('calculators'),
    ingredients: parse('ingredients'),
    recipes: parse('recipes'),
  };
}

function compareRebuilt(release: Release, bytes: Map<string, Buffer>, data: Record<DataFile, unknown>): void {
  const problems: string[] = [];
  for (const name of DATA_FILES) {
    const path = `data/${name}.json`;
    const rebuilt = release.files.find((file) => file.path === path);
    const actual = bytes.get(path);
    if (rebuilt === undefined || actual === undefined || rebuilt.bytes.equals(actual)) {
      continue;
    }
    const expected: unknown = JSON.parse(rebuilt.bytes.toString('utf8'));
    const found = data[name];
    let named = false;
    if (Array.isArray(expected) && Array.isArray(found)) {
      for (const [index, record] of expected.entries()) {
        if (canonicalJson(record) !== canonicalJson(found[index])) {
          const key = isRecord(record) ? String(record.key) : String(index + 1);
          problems.push(`${name} "${key}": rev or image fields do not match the record`);
          named = true;
          break;
        }
      }
    }
    if (!named) {
      problems.push(`${path} is not serialised in canonical form`);
    }
  }
  if (problems.length > 0) {
    throw new CommandError(4, problems);
  }
}

function compareCounts(manifest: Manifest, release: Release): void {
  const problems: string[] = [];
  for (const key of COUNT_KEYS) {
    const actual = release.manifest.counts[key];
    if (manifest.counts[key] !== actual) {
      problems.push(`counts.${key} is ${manifest.counts[key]} but ${COUNT_SOURCES[key]} ${actual}`);
    }
  }
  if (manifest.imageBytes !== release.manifest.imageBytes) {
    problems.push(`imageBytes is ${manifest.imageBytes} but the images hold ${release.manifest.imageBytes}`);
  }
  if (problems.length > 0) {
    throw new CommandError(4, problems);
  }
}

function checkRelease(dir: string, label: string): CheckedRelease {
  try {
    const manifest = readManifest(dir);
    const bytes = checkFiles(dir, manifest);
    const data = parseData(bytes);
    const shaped: Record<DataFile, unknown> = {
      glasses: toDatasetShape(data.glasses),
      methods: toDatasetShape(data.methods),
      utensils: toDatasetShape(data.utensils),
      'taste-descriptors': toDatasetShape(data['taste-descriptors']),
      calculators: toDatasetShape(data.calculators),
      ingredients: toDatasetShape(data.ingredients),
      recipes: toDatasetShape(data.recipes),
    };
    const imageFiles = manifest.files.map((file) => file.path).filter((path) => path.startsWith('images/'));
    const validated = validateDataset(
      { version: { formatVersion: manifest.formatVersion, version: manifest.version }, data: shaped, imageFiles },
      (file) => bytes.get(file) ?? null,
    );
    if (!validated.ok) {
      throw new CommandError(4, validated.problems.map(packProblem));
    }
    const release = buildRelease(validated.catalog);
    compareRebuilt(release, bytes, data);
    compareCounts(manifest, release);
    const manifestBytes = readBytes(dir, 'manifest.json');
    if (manifestBytes === null || !manifestBytes.equals(Buffer.from(canonicalJson(release.manifest), 'utf8'))) {
      throw new CommandError(4, ['manifest.json does not match the release it lists']);
    }
    return { release, manifest, manifestBytes, bytes };
  } catch (error) {
    if (error instanceof CommandError && label !== '') {
      throw new CommandError(
        error.exitCode,
        error.lines.map((line) => `${label}: ${line}`),
      );
    }
    throw error;
  }
}

function compareVersions(a: string, b: string): number {
  const [dateA, buildA] = a.split('-');
  const [dateB, buildB] = b.split('-');
  if (dateA !== dateB) {
    return dateA < dateB ? -1 : 1;
  }
  return Number.parseInt(buildA, 10) - Number.parseInt(buildB, 10);
}

function readIndex(path: string): Record<string, unknown>[] {
  const read = readJsonFile(path);
  if (!read.ok) {
    throw new CommandError(4, [read.reason === 'missing' ? `${path} is missing` : `${path} is not valid JSON`]);
  }
  const index = read.value;
  const invalid = new CommandError(4, [`${path} is not a Cellar catalog index`]);
  if (
    !isRecord(index) ||
    index.format !== 'cellar-catalog-index' ||
    index.formatVersion !== 1 ||
    !Array.isArray(index.releases)
  ) {
    throw invalid;
  }
  const releases: Record<string, unknown>[] = [];
  for (const entry of index.releases) {
    if (
      !isRecord(entry) ||
      typeof entry.version !== 'string' ||
      !VERSION_PATTERN.test(entry.version) ||
      typeof entry.sha256 !== 'string'
    ) {
      throw invalid;
    }
    releases.push(entry);
  }
  return releases;
}

function changes(current: RecordSummary[], previous: RecordSummary[] | null) {
  const before = new Map((previous ?? []).map((record) => [record.key, record]));
  const now = new Set(current.map((record) => record.key));
  const pick = (record: RecordSummary) => ({ key: record.key, name: record.name });
  return {
    added: current.filter((record) => !before.has(record.key)).map(pick),
    changed: current
      .filter((record) => {
        const old = before.get(record.key);
        return old !== undefined && old.rev !== record.rev;
      })
      .map(pick),
    removed: (previous ?? []).filter((record) => !now.has(record.key)).map(pick),
  };
}

function writeAtomic(outDir: string, name: string, data: Buffer | string): string {
  const target = join(outDir, name);
  const temp = join(outDir, `.${name}.${process.pid}.tmp`);
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(temp, data);
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw outputError(outDir, error) ?? error;
  }
  return target;
}

export function pack(options: PackOptions): string[] {
  const checked = checkRelease(options.releaseDir, '');
  const { release, manifest } = checked;
  const previous = options.previous === null ? null : checkRelease(options.previous, 'previous release');
  if (previous !== null && compareVersions(manifest.version, previous.manifest.version) <= 0) {
    throw new CommandError(6, [
      `${manifest.version} is not newer than the previous release ${previous.manifest.version}`,
    ]);
  }

  const entries = [...checked.bytes.entries()]
    .map(([path, data]) => ({ path, data }))
    .concat([{ path: 'manifest.json', data: checked.manifestBytes }])
    .sort((a, b) => compareCodePoints(a.path, b.path))
    .map((file) => ({ name: `${release.name}/${file.path}`, data: file.data }));
  const zip = storedZip(entries);
  const zipSha = sha256Hex(zip);

  const existing = options.index === null ? [] : readIndex(options.index);
  const same = existing.find((listed) => listed.version === manifest.version);
  if (same !== undefined && same.sha256 !== zipSha) {
    throw new CommandError(6, [
      `catalog-index.json already lists ${manifest.version} with a different checksum; bump version in catalog/dataset/version.json`,
    ]);
  }
  const base = options.baseUrl.replace(/\/+$/, '');
  const entry = {
    version: manifest.version,
    formatVersion: manifest.formatVersion,
    url: `${base}/${release.name}.zip`,
    bytes: zip.length,
    sha256: zipSha,
    counts: manifest.counts,
    previous: previous === null ? null : previous.manifest.version,
    changes: Object.fromEntries(
      RECORD_TYPES.map((type) => [
        type,
        changes(release.records[type], previous === null ? null : previous.release.records[type]),
      ]),
    ),
  };
  const releases = (same === undefined ? [entry, ...existing] : existing).sort((a, b) =>
    compareVersions(String(b.version), String(a.version)),
  );
  const index = {
    format: 'cellar-catalog-index',
    formatVersion: 1,
    latest: String(releases[0].version),
    releases,
  };

  const zipPath = writeAtomic(options.out, `${release.name}.zip`, zip);
  const indexPath = writeAtomic(options.out, 'catalog-index.json', canonicalJson(index));

  const summary =
    previous === null
      ? `first release: ${RECORD_TYPES.map((type) => `${integer(release.records[type].length)} ${LABELS[type]}`).join(', ')} added`
      : `since ${previous.manifest.version}: ${
          RECORD_TYPES.map((type) => {
            const c = entry.changes[type];
            return c.added.length + c.changed.length + c.removed.length === 0
              ? null
              : `${LABELS[type]} ${c.added.length} added, ${c.changed.length} changed, ${c.removed.length} removed`;
          })
            .filter((part) => part !== null)
            .join('; ') || 'no record changes'
        }`;
  return [
    `Checked     ${release.name}: ${integer(manifest.files.length)} files, ${integer(manifest.counts.recipes)} recipes, ${integer(manifest.counts.ingredients)} ingredients, ${integer(manifest.counts.images)} images`,
    `Changes     ${summary}`,
    `Zip         ${zipPath}  (${(zip.length / 1_000_000).toFixed(1)} MB, sha256 ${zipSha.slice(0, 4)}…)`,
    `Index       ${indexPath}  (${releases.length} release${releases.length === 1 ? '' : 's'}, latest ${index.latest})`,
  ];
}
