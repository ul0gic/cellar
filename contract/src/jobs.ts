import { z } from 'zod';
import { IsoDateTimeSchema } from './primitives.ts';
import { ProblemSchema } from './problem.ts';

export const CatalogCountsSchema = z
  .object({
    recipes: z.int().min(0),
    ingredients: z.int().min(0),
    images: z.int().min(0),
    glasses: z.int().min(0),
    methods: z.int().min(0),
    utensils: z.int().min(0),
    calculators: z.int().min(0),
    descriptors: z.int().min(0),
  })
  .meta({ id: 'CatalogCounts' });
export type CatalogCounts = z.infer<typeof CatalogCountsSchema>;

export const CatalogApplyReportSchema = z
  .object({
    version: z.string(),
    added: CatalogCountsSchema,
    skippedEdited: z.int().min(0),
    skippedDeleted: z.int().min(0),
  })
  .meta({ id: 'CatalogApplyReport' });
export type CatalogApplyReport = z.infer<typeof CatalogApplyReportSchema>;

export const BackupCountsSchema = z
  .object({
    members: z.int().min(0),
    recipes: z.int().min(0),
    ingredients: z.int().min(0),
    bottles: z.int().min(0),
    notes: z.int().min(0),
    ratings: z.int().min(0),
    images: z.int().min(0),
    menus: z.int().min(0),
    collections: z.int().min(0),
    calculators: z.int().min(0),
  })
  .meta({ id: 'BackupCounts' });
export type BackupCounts = z.infer<typeof BackupCountsSchema>;

export const BackupManifestSchema = z
  .object({
    format: z.literal('cellar.backup'),
    formatVersion: z.literal(1),
    appVersion: z.string(),
    schemaVersion: z.int().min(1),
    createdAt: IsoDateTimeSchema,
    catalogVersion: z.string().nullable(),
    counts: BackupCountsSchema,
    files: z.object({
      database: z.literal('cellar.db'),
      media: z.literal('media/'),
      catalog: z.string().nullable(),
    }),
  })
  .meta({ id: 'BackupManifest' });
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export const RestoreReportSchema = z
  .object({ manifest: BackupManifestSchema, durationMs: z.int().min(0) })
  .meta({ id: 'RestoreReport' });
export type RestoreReport = z.infer<typeof RestoreReportSchema>;

export const JobKindSchema = z.enum(['catalog_load', 'catalog_apply', 'restore']).meta({ id: 'JobKind' });
export type JobKind = z.infer<typeof JobKindSchema>;

export const JobSchema = z
  .object({
    id: z.uuid({ version: 'v4' }),
    kind: JobKindSchema,
    state: z.enum(['running', 'succeeded', 'failed']),
    step: z.string(),
    done: z.int().min(0),
    total: z.int().min(0).nullable(),
    startedAt: IsoDateTimeSchema,
    finishedAt: IsoDateTimeSchema.nullable(),
    result: z.union([CatalogApplyReportSchema, RestoreReportSchema]).nullable(),
    error: ProblemSchema.nullable(),
  })
  .meta({ id: 'Job' });
export type Job = z.infer<typeof JobSchema>;
