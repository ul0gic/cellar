import { randomBytes, randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  aspectMatches,
  buildPath,
  IMAGE_TYPES,
  type Id,
  type ImagePurpose,
  type ImageRef,
  LIMITS,
} from '@cellar/contract';
import type { ImageRow, MediaStore } from '../core/context.ts';
import { type Database, withTransaction } from '../core/db.ts';
import type { Logger } from '../core/logger.ts';
import { type Outbound, OutboundError } from '../core/outbound.ts';
import { payloadTooLarge, problem } from '../core/problems.ts';
import type { Settings } from '../core/settings.ts';

const ORPHAN_AGE_MS = 86_400_000;
const ORPHAN_BATCH = 100;
const ASPECT_MESSAGE = 'Recipe photos are 4:5 portrait; other images are square.';

interface ImageFormat {
  readonly mediaType: string;
  readonly ext: string;
}

const WEBP: ImageFormat = { mediaType: 'image/webp', ext: 'webp' };
const JPEG: ImageFormat = { mediaType: 'image/jpeg', ext: 'jpg' };
const PNG: ImageFormat = { mediaType: 'image/png', ext: 'png' };
const FORMAT_BY_EXT: Readonly<Record<string, ImageFormat>> = { webp: WEBP, jpg: JPEG, png: PNG };

const UPLOAD_NAME = /^u\/[0-9a-f]{32}\.(webp|jpg|png)$/;
const CATALOG_NAME =
  /^catalog\/[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[1-9][0-9]{0,2}\/images\/(recipes|ingredients)\/[a-z0-9]+(-[a-z0-9]+)*\/[1-9]\.(webp|jpg|png)$/;

function startsWith(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function sniff(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return WEBP;
  }
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) {
    return JPEG;
  }
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return PNG;
  }
  return null;
}

function unsupported() {
  return problem('unsupported_media_type', { detail: 'Use a WebP, JPEG or PNG image.' });
}

const FETCH_TIMEOUT_MS = 15_000;
const UNREACHABLE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

function fetchProblem(error: unknown) {
  if (error instanceof OutboundError) {
    switch (error.case) {
      case 'scheme_refused':
      case 'address_refused':
        return problem('url_not_allowed');
      case 'too_many_redirects':
        return problem('fetch_failed', { detail: 'That address redirected more than 3 times.' });
      case 'too_large':
        return payloadTooLarge(LIMITS.imageFetchedBytes);
      case 'timed_out':
        return problem('fetch_timeout');
      case 'upstream_status':
        return problem('fetch_failed', {
          detail: `That page answered with an error (${error.upstreamStatus}).`,
          ...(error.upstreamStatus === null ? {} : { upstreamStatus: error.upstreamStatus }),
        });
    }
  }
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    UNREACHABLE_CODES.has(error.code)
  ) {
    return problem('fetch_failed', { detail: "Cellar couldn't reach that address." });
  }
  return error;
}

export async function fetchImage(outbound: Outbound, url: string): Promise<Uint8Array> {
  try {
    const { body } = await outbound.fetch(url, {
      maxBytes: LIMITS.imageFetchedBytes,
      timeoutMs: FETCH_TIMEOUT_MS,
      accept: IMAGE_TYPES.join(', '),
    });
    return body;
  } catch (error) {
    throw fetchProblem(error);
  }
}

export function imageRowOf(row: Readonly<Record<string, unknown>>): ImageRow {
  const { id, file_name, media_type, bytes, width, height, thumbhash, purpose, uploaded_by, created_at } = row;
  if (
    typeof id !== 'number' ||
    typeof file_name !== 'string' ||
    typeof media_type !== 'string' ||
    typeof bytes !== 'number' ||
    (width !== null && typeof width !== 'number') ||
    (height !== null && typeof height !== 'number') ||
    (thumbhash !== null && typeof thumbhash !== 'string') ||
    (purpose !== 'recipe' && purpose !== 'ingredient' && purpose !== 'bottle' && purpose !== 'avatar') ||
    (uploaded_by !== null && typeof uploaded_by !== 'number') ||
    typeof created_at !== 'string'
  ) {
    throw new Error('images row has an unexpected shape');
  }
  return {
    id,
    fileName: file_name,
    mediaType: media_type,
    bytes,
    width,
    height,
    thumbhash,
    purpose,
    uploadedBy: uploaded_by,
    createdAt: created_at,
  };
}

export function findImage(db: Database, id: Id): ImageRow | null {
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(id);
  return row === undefined ? null : imageRowOf(row);
}

export function mediaTypeOf(file: string): string | null {
  const ext = file.slice(file.lastIndexOf('.') + 1);
  return FORMAT_BY_EXT[ext]?.mediaType ?? null;
}

export function createMediaStore(settings: Settings, db: Database, log: Logger): MediaStore {
  const mediaDir = join(settings.dataDir, 'media');
  const catalogDir = join(settings.dataDir, 'catalog');
  const tmpDir = join(settings.dataDir, 'tmp');

  const insert = db.prepare(
    `INSERT INTO images (file_name, media_type, bytes, width, height, thumbhash, purpose, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  );
  const selectById = db.prepare('SELECT * FROM images WHERE id = ?');
  const attached = db.prepare(
    `SELECT EXISTS (SELECT 1 FROM recipe_images WHERE image_id = :id)
         OR EXISTS (SELECT 1 FROM ingredients WHERE image_id = :id)
         OR EXISTS (SELECT 1 FROM bottles WHERE image_id = :id)
         OR EXISTS (SELECT 1 FROM members WHERE avatar_image_id = :id) AS used`,
  );
  const deleteById = db.prepare('DELETE FROM images WHERE id = ?');
  const orphans = db.prepare(
    `SELECT id, file_name FROM images
     WHERE file_name LIKE 'u/%' AND created_at < ?
       AND id NOT IN (
         SELECT image_id FROM recipe_images
         UNION SELECT image_id FROM ingredients WHERE image_id IS NOT NULL
         UNION SELECT image_id FROM bottles WHERE image_id IS NOT NULL
         UNION SELECT avatar_image_id FROM members WHERE avatar_image_id IS NOT NULL)
     ORDER BY id LIMIT ${ORPHAN_BATCH}`,
  );

  const write = async (
    bytes: Uint8Array,
    format: ImageFormat,
    meta: {
      readonly purpose: ImagePurpose;
      readonly width: number | null;
      readonly height: number | null;
      readonly thumbhash: string | null;
    },
    by: Id,
  ): Promise<ImageRow> => {
    const fileName = `u/${randomBytes(16).toString('hex')}.${format.ext}`;
    const staged = join(tmpDir, `image-${randomUUID()}`);
    const target = join(mediaDir, fileName);
    try {
      await writeFile(staged, bytes, { flag: 'wx', mode: 0o600 });
      await rename(staged, target);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
    try {
      const row = insert.get(
        fileName,
        format.mediaType,
        bytes.byteLength,
        meta.width,
        meta.height,
        meta.thumbhash,
        meta.purpose,
        by,
        new Date().toISOString(),
      );
      if (row === undefined) {
        throw new Error('images insert returned no row');
      }
      return imageRowOf(row);
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
  };

  return {
    async storeUpload(bytes, declared, by) {
      if (bytes.byteLength > LIMITS.imageUploadBytes) {
        throw payloadTooLarge(LIMITS.imageUploadBytes);
      }
      const format = sniff(bytes);
      if (format === null) {
        throw unsupported();
      }
      if (!aspectMatches(declared.purpose, declared.width, declared.height)) {
        throw problem('validation_failed', {
          fields: [{ path: 'width', code: 'aspect_mismatch', message: ASPECT_MESSAGE }],
        });
      }
      return await write(
        bytes,
        format,
        {
          purpose: declared.purpose,
          width: declared.width,
          height: declared.height,
          thumbhash: declared.thumbhash ?? null,
        },
        by,
      );
    },

    async storeFetched(bytes, purpose, by) {
      if (bytes.byteLength > LIMITS.imageFetchedBytes) {
        throw payloadTooLarge(LIMITS.imageFetchedBytes);
      }
      const format = sniff(bytes);
      if (format === null) {
        throw unsupported();
      }
      return await write(bytes, format, { purpose, width: null, height: null, thumbhash: null }, by);
    },

    async remove(id) {
      const found = selectById.get(id);
      if (found === undefined) {
        throw problem('not_found');
      }
      const row = imageRowOf(found);
      if (attached.get({ id })?.used === 1) {
        throw problem('image_in_use');
      }
      deleteById.run(id);
      if (UPLOAD_NAME.test(row.fileName)) {
        await rm(join(mediaDir, row.fileName), { force: true });
      }
    },

    async sweepOrphans() {
      const started = performance.now();
      const cutoff = new Date(Date.now() - ORPHAN_AGE_MS).toISOString();
      const files = withTransaction(db, () =>
        orphans.all(cutoff).map(({ id, file_name }) => {
          if (typeof id !== 'number' || typeof file_name !== 'string' || !UPLOAD_NAME.test(file_name)) {
            throw new Error('images row has an unexpected shape');
          }
          deleteById.run(id);
          return file_name;
        }),
      );
      await Promise.all(files.map((file) => rm(join(mediaDir, file), { force: true })));
      const deleted = files.length;
      log.info('Orphan sweep', { deleted, durationMs: Math.round(performance.now() - started) });
      return deleted;
    },

    resolveServePath(file) {
      if (UPLOAD_NAME.test(file)) {
        return join(mediaDir, file);
      }
      if (CATALOG_NAME.test(file)) {
        return join(catalogDir, file.slice('catalog/'.length));
      }
      return null;
    },

    imageRef(row, basePath): ImageRef {
      return {
        id: row.id,
        url: `${basePath}${buildPath('getMedia', { file: row.fileName })}`,
        width: row.width,
        height: row.height,
        thumbhash: row.thumbhash,
      };
    },
  };
}
