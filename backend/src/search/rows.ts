import { IMAGE_PURPOSES, type ImagePurpose } from '@cellar/contract';
import type { ImageRow } from '../core/context.ts';

export type Row = Readonly<Record<string, unknown>>;

export function num(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') {
    throw new Error(`column ${key} is not a number`);
  }
  return value;
}

export function numOrNull(row: Row, key: string): number | null {
  const value = row[key];
  return value === null ? null : num(row, key);
}

export function str(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`column ${key} is not a string`);
  }
  return value;
}

export function strOrNull(row: Row, key: string): string | null {
  const value = row[key];
  return value === null ? null : str(row, key);
}

const PURPOSES: ReadonlySet<string> = new Set(IMAGE_PURPOSES);

function isImagePurpose(value: string): value is ImagePurpose {
  return PURPOSES.has(value);
}

export const IMAGE_COLUMNS =
  'i.id AS image_id, i.file_name AS image_file_name, i.media_type AS image_media_type, i.bytes AS image_bytes, i.width AS image_width, i.height AS image_height, i.thumbhash AS image_thumbhash, i.purpose AS image_purpose, i.uploaded_by AS image_uploaded_by, i.created_at AS image_created_at';

export function imageRowOrNull(row: Row): ImageRow | null {
  const id = numOrNull(row, 'image_id');
  if (id === null) {
    return null;
  }
  const purpose = str(row, 'image_purpose');
  if (!isImagePurpose(purpose)) {
    throw new Error(`images row ${id} has purpose ${purpose}`);
  }
  return {
    id,
    fileName: str(row, 'image_file_name'),
    mediaType: str(row, 'image_media_type'),
    bytes: num(row, 'image_bytes'),
    width: numOrNull(row, 'image_width'),
    height: numOrNull(row, 'image_height'),
    thumbhash: strOrNull(row, 'image_thumbhash'),
    purpose,
    uploadedBy: numOrNull(row, 'image_uploaded_by'),
    createdAt: str(row, 'image_created_at'),
  };
}
