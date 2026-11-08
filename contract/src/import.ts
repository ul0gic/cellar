import { z } from 'zod';
import type { importEndpoints } from './import-endpoints.ts';
import { LIMITS } from './limits.ts';
import { IdSchema, queryBoolean, queryId } from './primitives.ts';
import { RecipeInputSchema, RecipeLineInputSchema } from './recipes.ts';
import type { RouteSchema } from './routes.ts';

const TEXT_IMPORT_MAX = 10_000;

export const CsvKindSchema = z.enum(['bottles', 'ingredients']).meta({ id: 'CsvKind' });
export type CsvKind = z.infer<typeof CsvKindSchema>;

export const DuplicateRuleSchema = z.enum(['skip', 'update', 'create']).meta({ id: 'DuplicateRule' });
export type DuplicateRule = z.infer<typeof DuplicateRuleSchema>;

export const ImportModeSchema = z.enum(['dry_run', 'commit']).meta({ id: 'ImportMode' });
export type ImportMode = z.infer<typeof ImportModeSchema>;

export const CsvImportPartsSchema = z.object({
  file: z.file().max(LIMITS.csvBytes).mime(['text/csv']),
  kind: CsvKindSchema,
  mode: ImportModeSchema,
  duplicate: DuplicateRuleSchema,
  unmatchedParentId: queryId.optional(),
});
export type CsvImportParts = z.infer<typeof CsvImportPartsSchema>;

export const RowErrorSchema = z
  .object({ row: z.int().min(1), column: z.string().nullable(), reason: z.string() })
  .meta({ id: 'RowError' });
export type RowError = z.infer<typeof RowErrorSchema>;

export const CsvImportReportSchema = z
  .object({
    kind: CsvKindSchema,
    mode: ImportModeSchema,
    committed: z.boolean(),
    rows: z.int().min(0),
    creates: z.int().min(0),
    updates: z.int().min(0),
    skips: z.int().min(0),
    createdIngredients: z.array(z.string()),
    errors: z.array(RowErrorSchema),
  })
  .meta({ id: 'CsvImportReport' });
export type CsvImportReport = z.infer<typeof CsvImportReportSchema>;

export const RecipeImportPartsSchema = z.object({
  file: z.file().mime(['application/json', 'application/zip']),
  mode: ImportModeSchema,
  duplicate: DuplicateRuleSchema,
  unmatchedParentId: queryId,
  fetchRemoteImages: queryBoolean,
});
export type RecipeImportParts = z.infer<typeof RecipeImportPartsSchema>;

export const RecipeImportRowSchema = z
  .object({
    index: z.int().min(0),
    name: z.string(),
    result: z.enum(['create', 'update', 'skip', 'error']),
    recipeId: IdSchema.nullable(),
    createdIngredients: z.array(z.string()),
    unmatchedGlass: z.string().nullable(),
    unmatchedMethod: z.string().nullable(),
    errors: z.array(z.string()),
  })
  .meta({ id: 'RecipeImportRow' });
export type RecipeImportRow = z.infer<typeof RecipeImportRowSchema>;

export const RecipeImportReportSchema = z
  .object({
    mode: ImportModeSchema,
    committed: z.boolean(),
    format: z.literal('cellar'),
    totals: z.object({
      creates: z.int().min(0),
      updates: z.int().min(0),
      skips: z.int().min(0),
      errors: z.int().min(0),
    }),
    recipes: z.array(RecipeImportRowSchema),
  })
  .meta({ id: 'RecipeImportReport' });
export type RecipeImportReport = z.infer<typeof RecipeImportReportSchema>;

export const DraftLineSchema = RecipeLineInputSchema.extend({
  ingredientId: IdSchema.nullable(),
  ingredientText: z.string(),
  matched: z.boolean(),
}).meta({ id: 'DraftLine' });
export type DraftLine = z.infer<typeof DraftLineSchema>;

export const RecipeDraftSchema = z
  .object({
    source: z.enum(['schema_org', 'ai', 'text']),
    sourceUrl: z.string().nullable(),
    recipe: RecipeInputSchema.omit({ lines: true, imageIds: true }).extend({ lines: z.array(DraftLineSchema) }),
    imageUrl: z.string().nullable(),
  })
  .meta({ id: 'RecipeDraft' });
export type RecipeDraft = z.infer<typeof RecipeDraftSchema>;

export const UrlImportInputSchema = z
  .strictObject({ url: z.string().min(1).max(LIMITS.url.max), useAi: z.boolean() })
  .meta({ id: 'UrlImportInput' });
export type UrlImportInput = z.infer<typeof UrlImportInputSchema>;

export const TextImportInputSchema = z
  .strictObject({ text: z.string().min(1).max(TEXT_IMPORT_MAX), useAi: z.boolean() })
  .meta({ id: 'TextImportInput' });
export type TextImportInput = z.infer<typeof TextImportInputSchema>;

export const importRoutes = {
  getCsvTemplate: {
    params: z.object({ kind: z.string() }),
    responses: { 200: 'csv' },
    errors: ['not_found'],
    summary: 'Download a CSV import template',
    tag: 'import',
  },
  importCsv: {
    body: { multipart: CsvImportPartsSchema },
    responses: { 200: CsvImportReportSchema },
    errors: ['payload_too_large', 'unsupported_media_type', 'import_has_errors'],
    summary: 'Check or import bottles or ingredients from CSV',
    tag: 'import',
  },
  importRecipes: {
    body: { multipart: RecipeImportPartsSchema },
    responses: { 200: RecipeImportReportSchema },
    errors: ['payload_too_large', 'unsupported_media_type', 'archive_too_large', 'import_has_errors'],
    summary: 'Check or import a Cellar recipe export',
    tag: 'import',
  },
  importFromUrl: {
    body: UrlImportInputSchema,
    responses: { 200: RecipeDraftSchema },
    errors: [
      'url_not_allowed',
      'fetch_failed',
      'fetch_timeout',
      'page_too_large',
      'no_recipe_data',
      'ai_provider_error',
      'ai_timeout',
    ],
    summary: 'Read a recipe draft from a web page',
    tag: 'import',
  },
  importFromText: {
    body: TextImportInputSchema,
    responses: { 200: RecipeDraftSchema },
    errors: ['ai_provider_error', 'ai_timeout'],
    summary: 'Read a recipe draft from pasted text',
    tag: 'import',
  },
} as const satisfies Record<keyof typeof importEndpoints, RouteSchema>;
