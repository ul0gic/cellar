import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { CatalogApplyReport } from '@cellar/contract';
import { CatalogBounds } from '@cellar/contract/schemas';
import { ArchiveError, readBoundedZip, type ZipEntry } from '../backup/archive.ts';
import { freeBytes } from '../backup/backup.ts';
import type { AppContext } from '../core/context.ts';
import type { JobProgress } from '../core/jobs.ts';
import { OutboundError } from '../core/outbound.ts';
import { problem } from '../core/problems.ts';
import { allowedCatalogHop, fetchIndex, writeJsonSetting } from './check.ts';
import { catalogLoadRelease } from './loader.ts';
import { FORMAT_VERSION, RELEASE_PATH, RELEASE_PREFIX, readManifest, ReleaseCheckError } from './release.ts';

const LOAD_TO_APPLY_STEP: Readonly<Record<string, string>> = {
  'Checking the catalog': 'Checking the download',
  'Adding glasses, methods and utensils': 'Adding new records',
  'Adding ingredients': 'Adding new records',
  'Adding recipes': 'Adding new records',
  'Copying images': 'Copying images',
};

function applyProgress(inner: JobProgress): JobProgress {
  let current = 'Checking the download';
  return {
    step(text, total) {
      const mapped = LOAD_TO_APPLY_STEP[text] ?? text;
      if (mapped !== current) {
        current = mapped;
        inner.step(mapped, mapped === 'Adding new records' ? null : total);
      }
    },
    done(n) {
      if (current !== 'Adding new records') {
        inner.done(n);
      }
    },
  };
}

function megabytes(bytes: number): string {
  return `${Math.ceil(bytes / 2 ** 20)} MB`;
}

async function download(ctx: AppContext, url: string, sha256: string, target: string): Promise<void> {
  let body: Uint8Array;
  try {
    const response = await ctx.outbound.fetch(url, {
      maxBytes: CatalogBounds.downloadBytes,
      timeoutMs: CatalogBounds.downloadTotalMs,
      idleMs: CatalogBounds.downloadIdleMs,
      allowOnly: allowedCatalogHop(new URL(url)),
    });
    body = response.body;
  } catch (error) {
    if (error instanceof OutboundError && (error.case === 'scheme_refused' || error.case === 'address_refused')) {
      throw problem('catalog_url_refused');
    }
    ctx.log.warn('The catalog download failed.', { err: error });
    throw problem('catalog_download_failed');
  }
  if (createHash('sha256').update(body).digest('hex') !== sha256) {
    throw problem('catalog_damaged');
  }
  await writeFile(target, body);
}

function entryLimit(path: string): number {
  return path.includes('/data/') ? CatalogBounds.dataFileBytes : CatalogBounds.imageEntryBytes;
}

async function unpack(zip: string, folder: string, into: string): Promise<void> {
  const prefix = `${folder}/`;
  const entries: ZipEntry[] = [];
  try {
    for await (const entry of readBoundedZip(zip, {
      entries: CatalogBounds.zipEntries,
      expandedBytes: CatalogBounds.zipExpandedBytes,
      allowPath: (path) => path.startsWith(prefix) && RELEASE_PATH.test(path.slice(prefix.length)),
    })) {
      if (entry.size > entryLimit(entry.path)) {
        throw problem('catalog_too_large');
      }
      entries.push(entry);
    }
    for (const entry of entries) {
      const target = join(into, entry.path);
      await mkdir(dirname(target), { recursive: true });
      await pipeline(await entry.open(), createWriteStream(target, { flags: 'wx' }));
    }
  } catch (error) {
    if (error instanceof ArchiveError) {
      throw error.reason === 'entries' || error.reason === 'expanded'
        ? problem('catalog_too_large')
        : problem('catalog_damaged');
    }
    throw error;
  }
}

export async function applyCatalogVersion(
  ctx: AppContext,
  version: string,
  progress: JobProgress,
): Promise<CatalogApplyReport> {
  progress.step('Downloading', null);
  const entry = (await fetchIndex(ctx)).find(
    (release) => release.version === version && release.formatVersion === FORMAT_VERSION,
  );
  if (entry === undefined) {
    throw problem('catalog_update_unavailable');
  }
  const base = new URL('.', ctx.settings.catalogUrl).href;
  if (!entry.url.startsWith(base)) {
    throw problem('catalog_url_refused');
  }
  const { dataDir } = ctx.settings;
  const needed = CatalogBounds.freeSpaceFactor * entry.bytes;
  if ((await freeBytes(dataDir)) < needed) {
    throw problem('catalog_no_space', {
      detail: `There isn't enough free space in the data folder for this catalog (it needs about ${megabytes(needed)}). Free some space, then try again.`,
    });
  }
  const zip = join(dataDir, 'tmp', `catalog-${version}.zip`);
  const staging = join(dataDir, 'tmp', `catalog-${version}`);
  const folder = `${RELEASE_PREFIX}${version}`;
  try {
    await download(ctx, entry.url, entry.sha256, zip);
    progress.step('Checking the download', null);
    await rm(staging, { recursive: true, force: true });
    await unpack(zip, folder, staging);
    const dir = join(staging, folder);
    let manifest: ReturnType<typeof readManifest>;
    try {
      manifest = readManifest(dir);
    } catch (error) {
      if (error instanceof ReleaseCheckError) {
        throw problem('catalog_invalid', {
          detail: `Catalog ${version} failed its checks, so nothing was changed: ${error.message}.`,
        });
      }
      throw error;
    }
    const report = await catalogLoadRelease(ctx, { dir, manifest }, applyProgress(progress));
    writeJsonSetting(ctx.db, 'catalog_available', null);
    return report;
  } finally {
    await rm(zip, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}
