import { IMAGE_PURPOSES, type ImagePurpose, type ImageRef, type MemberRef } from '@cellar/contract';
import type { AppContext, ImageRow } from '../core/context.ts';

export type Row = Readonly<Record<string, unknown>>;
export type ToImageRef = (row: ImageRow) => ImageRef;

export function imageRefsOf(ctx: AppContext): ToImageRef {
  return (image) => ctx.media.imageRef(image, ctx.settings.basePath);
}

export function num(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') {
    throw new Error(`column ${key} is not a number`);
  }
  return value;
}

export function numOrNull(row: Row, key: string): number | null {
  return row[key] === null ? null : num(row, key);
}

export function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`column ${key} is not text`);
  }
  return value;
}

export function textOrNull(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

export function oneOf<T extends string>(row: Row, key: string, allowed: readonly T[]): T {
  const value = text(row, key);
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new Error(`column ${key} holds ${value}`);
  }
  return found;
}

export function imageColumns(alias: string, prefix: string): string {
  return [
    'id',
    'file_name',
    'media_type',
    'bytes',
    'width',
    'height',
    'thumbhash',
    'purpose',
    'uploaded_by',
    'created_at',
  ]
    .map((column) => `${alias}.${column} AS ${prefix}_${column}`)
    .join(', ');
}

export function imageRowOrNull(row: Row, prefix: string): ImageRow | null {
  const id = numOrNull(row, `${prefix}_id`);
  if (id === null) {
    return null;
  }
  const purpose: ImagePurpose = oneOf(row, `${prefix}_purpose`, IMAGE_PURPOSES);
  return {
    id,
    fileName: text(row, `${prefix}_file_name`),
    mediaType: text(row, `${prefix}_media_type`),
    bytes: num(row, `${prefix}_bytes`),
    width: numOrNull(row, `${prefix}_width`),
    height: numOrNull(row, `${prefix}_height`),
    thumbhash: textOrNull(row, `${prefix}_thumbhash`),
    purpose,
    uploadedBy: numOrNull(row, `${prefix}_uploaded_by`),
    createdAt: text(row, `${prefix}_created_at`),
  };
}

export function imageRefOrNull(row: Row, prefix: string, toImageRef: ToImageRef): ImageRef | null {
  const image = imageRowOrNull(row, prefix);
  return image === null ? null : toImageRef(image);
}

export function memberColumns(member: string, avatar: string, prefix: string): string {
  return `${member}.id AS ${prefix}_member_id, ${member}.name AS ${prefix}_member_name, ${imageColumns(avatar, `${prefix}_avatar`)}`;
}

export function memberRefOrNull(row: Row, prefix: string, toImageRef: ToImageRef): MemberRef | null {
  const id = numOrNull(row, `${prefix}_member_id`);
  if (id === null) {
    return null;
  }
  return { id, name: text(row, `${prefix}_member_name`), avatar: imageRefOrNull(row, `${prefix}_avatar`, toImageRef) };
}
