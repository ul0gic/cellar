import { type FieldErrorCode, IMAGE_PURPOSES, type ImagePurpose } from '@cellar/contract';
import type { ImageRow } from '../core/context.ts';
import { type ProblemError, problem } from '../core/problems.ts';

export type Row = Readonly<Record<string, unknown>>;

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

export function oneOfOrNull<T extends string>(row: Row, key: string, allowed: readonly T[]): T | null {
  return row[key] === null ? null : oneOf(row, key, allowed);
}

const IMAGE_FIELDS = [
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
];

export function imageColumns(alias: string, prefix: string): string {
  return IMAGE_FIELDS.map((column) => `${alias}.${column} AS ${prefix}_${column}`).join(', ');
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

export function fieldProblem(path: string, code: FieldErrorCode, message: string): ProblemError {
  return problem('validation_failed', { fields: [{ path, code, message }] });
}
