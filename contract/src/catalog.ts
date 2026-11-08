import { z } from 'zod';
import type { catalogEndpoints } from './catalog-endpoints.ts';
import { IsoDateTimeSchema } from './primitives.ts';
import type { RouteSchema } from './routes.ts';
import { CatalogCountsSchema, JobSchema } from './jobs.ts';
import { CatalogScheduleSchema } from './settings.ts';

export const CATALOG_VERSION_PATTERN = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[1-9][0-9]{0,2}$/;

export const CatalogBounds = {
  indexBytes: 1_000_000,
  indexTimeoutMs: 15_000,
  downloadBytes: 256 * 2 ** 20,
  downloadIdleMs: 30_000,
  downloadTotalMs: 300_000,
  zipEntries: 10_000,
  zipExpandedBytes: 512 * 2 ** 20,
  imageEntryBytes: 2_000_000,
  dataFileBytes: 32 * 2 ** 20,
  freeSpaceFactor: 2,
} as const;

const catalogVersionSchema = z.string().regex(CATALOG_VERSION_PATTERN);

export const CatalogVersionSchema = z
  .object({ version: catalogVersionSchema, builtAt: IsoDateTimeSchema, counts: CatalogCountsSchema })
  .meta({ id: 'CatalogVersion' });
export type CatalogVersion = z.infer<typeof CatalogVersionSchema>;

export const CatalogCheckSchema = z
  .object({
    at: IsoDateTimeSchema,
    result: z.enum(['up_to_date', 'available', 'failed']),
    message: z.string().nullable(),
  })
  .meta({ id: 'CatalogCheck' });
export type CatalogCheck = z.infer<typeof CatalogCheckSchema>;

export const CatalogUpdateSchema = z
  .object({ version: catalogVersionSchema, adds: CatalogCountsSchema, notes: z.string() })
  .meta({ id: 'CatalogUpdate' });
export type CatalogUpdate = z.infer<typeof CatalogUpdateSchema>;

export const CatalogStatusSchema = z
  .object({
    shipped: CatalogVersionSchema,
    loaded: CatalogVersionSchema.nullable(),
    schedule: CatalogScheduleSchema,
    lastCheck: CatalogCheckSchema.nullable(),
    available: CatalogUpdateSchema.nullable(),
  })
  .meta({ id: 'CatalogStatus' });
export type CatalogStatus = z.infer<typeof CatalogStatusSchema>;

export const CatalogApplyInputSchema = z
  .strictObject({ version: catalogVersionSchema })
  .meta({ id: 'CatalogApplyInput' });
export type CatalogApplyInput = z.infer<typeof CatalogApplyInputSchema>;

export const catalogRoutes = {
  getCatalogStatus: {
    responses: { 200: CatalogStatusSchema },
    errors: [],
    summary: 'Get the catalog status',
    tag: 'catalog',
  },
  loadCatalog: {
    responses: { 202: JobSchema },
    errors: ['catalog_loaded', 'job_running'],
    summary: 'Load the catalog shipped with this release',
    tag: 'catalog',
  },
  checkCatalog: {
    responses: { 200: CatalogStatusSchema },
    errors: ['catalog_unreachable', 'catalog_invalid'],
    summary: 'Check for a newer catalog',
    tag: 'catalog',
  },
  applyCatalogUpdate: {
    body: CatalogApplyInputSchema,
    responses: { 202: JobSchema },
    errors: ['catalog_update_unavailable', 'job_running'],
    summary: 'Add the new records of a newer catalog',
    tag: 'catalog',
  },
} as const satisfies Record<keyof typeof catalogEndpoints, RouteSchema>;
