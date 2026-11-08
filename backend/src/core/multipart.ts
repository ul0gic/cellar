import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { LIMITS, type OperationId } from '@cellar/contract';
import type { Schema } from '@cellar/contract/schemas';
import type { FastifyRequest, FastifySchemaValidationError } from 'fastify';
import { z } from 'zod';
import { payloadTooLarge, problem, validationProblem } from './problems.ts';

declare module 'fastify' {
  interface FastifyInstance {
    uploadDir: string;
  }
}

export interface UploadedFile {
  readonly path: string;
  readonly bytes: number;
  readonly filename: string;
  readonly mimetype: string;
}

export type MultipartBody<S> = S extends z.ZodType
  ? { readonly [K in keyof z.output<S>]: z.output<S>[K] extends File ? UploadedFile : z.output<S>[K] }
  : never;

const FILE_LIMITS = {
  uploadImage: LIMITS.imageUploadBytes,
  importCsv: LIMITS.csvBytes,
  importRecipes: LIMITS.recipeJsonBytes,
  uploadRestore: LIMITS.archiveExpandedBytes,
} as const satisfies Partial<Record<OperationId, number>>;

const uploadsByRequest = new WeakMap<FastifyRequest, string[]>();

function fileLimitOf(op: OperationId): number {
  const limits: Partial<Record<OperationId, number>> = FILE_LIMITS;
  const limit = limits[op];
  if (limit === undefined) {
    throw new Error(`${op} has a multipart body but no file size limit`);
  }
  return limit;
}

function issuesOf(error: z.ZodError): FastifySchemaValidationError[] {
  return error.issues.map(({ code, path, message, ...params }) => ({
    keyword: code,
    instancePath: `/${path.map(String).join('/')}`,
    schemaPath: '',
    params,
    message,
  }));
}

function isTooLarge(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE';
}

export function multipartReader(op: OperationId, schema: Schema) {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`${op}'s multipart schema is not an object`);
  }
  const maxFileBytes = fileLimitOf(op);
  const fileKeys = Object.entries(schema.shape).flatMap(([key, field]) => (field instanceof z.ZodFile ? [key] : []));
  const partsSchema = schema.extend(Object.fromEntries(fileKeys.map((key) => [key, z.unknown()])));
  const fieldCount = Object.keys(schema.shape).length - fileKeys.length;

  return async (request: FastifyRequest): Promise<Record<string, unknown>> => {
    const uploads: string[] = [];
    uploadsByRequest.set(request, uploads);
    const fields: Record<string, unknown> = {};
    const files: Record<string, UploadedFile> = {};
    try {
      const parts = request.parts({
        limits: {
          files: fileKeys.length,
          fileSize: maxFileBytes,
          fields: fieldCount,
          parts: fileKeys.length + fieldCount,
        },
      });
      for await (const part of parts) {
        if (part.type === 'file') {
          if (!fileKeys.includes(part.fieldname) || Object.hasOwn(files, part.fieldname)) {
            throw problem('bad_request');
          }
          const path = join(request.server.uploadDir, `upload-${randomUUID()}`);
          uploads.push(path);
          await pipeline(part.file, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
          if (part.file.truncated) {
            throw payloadTooLarge(maxFileBytes);
          }
          files[part.fieldname] = {
            path,
            bytes: (await stat(path)).size,
            filename: part.filename,
            mimetype: part.mimetype,
          };
        } else {
          if (part.valueTruncated || part.fieldnameTruncated) {
            throw problem('bad_request');
          }
          const previous = fields[part.fieldname];
          fields[part.fieldname] =
            previous === undefined ? part.value : [...(Array.isArray(previous) ? previous : [previous]), part.value];
        }
      }
    } catch (error) {
      throw isTooLarge(error) ? payloadTooLarge(maxFileBytes) : error;
    }
    if (fileKeys.some((key) => !Object.hasOwn(files, key))) {
      throw problem('bad_request');
    }
    const parsed = partsSchema.safeParse({ ...fields, ...files });
    if (!parsed.success) {
      throw validationProblem(issuesOf(parsed.error), fields);
    }
    return parsed.data;
  };
}

export async function removeUploads(request: FastifyRequest): Promise<void> {
  const uploads = uploadsByRequest.get(request) ?? [];
  await Promise.all(uploads.map((path) => rm(path, { force: true })));
}
