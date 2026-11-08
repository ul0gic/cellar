import { z } from 'zod';
import { BottleStatusSchema } from './bottles.ts';
import type { exportEndpoints } from './export-endpoints.ts';
import { LIMITS } from './limits.ts';
import { IsoDateTimeSchema, ProvenanceSchema, queryArray, queryId, UnitIdSchema } from './primitives.ts';
import type { RouteSchema } from './routes.ts';

export const BOTTLE_CSV_COLUMNS = [
  'id',
  'name',
  'ingredient',
  'labeled_size',
  'volume_ml',
  'abv',
  'price_paid',
  'purchased_on',
  'opened_on',
  'finished_on',
  'status',
  'note',
] as const;
export type BottleCsvColumn = (typeof BOTTLE_CSV_COLUMNS)[number];
export const BOTTLE_CSV_REQUIRED: readonly BottleCsvColumn[] = ['name', 'ingredient'];

export const INGREDIENT_CSV_COLUMNS = [
  'id',
  'name',
  'parent',
  'strength',
  'description',
  'origin',
  'color',
  'default_unit',
] as const;
export type IngredientCsvColumn = (typeof INGREDIENT_CSV_COLUMNS)[number];
export const INGREDIENT_CSV_REQUIRED: readonly IngredientCsvColumn[] = ['name'];

export const CELLAR_RECIPE_FORMAT = 'cellar.recipes';
export const CELLAR_RECIPE_FORMAT_VERSION = 1;

const amountSchema = z.number().min(0).max(LIMITS.amount.max).nullable();

export const CellarRecipeRecordSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1).max(LIMITS.name.max),
    description: z.string().max(LIMITS.description.max),
    instructions: z.string().max(LIMITS.instructions.max),
    garnish: z.string().max(LIMITS.garnish.max),
    source: z.string().max(LIMITS.source.max),
    year: z.int().nullable(),
    glass: z.string().nullable(),
    method: z.string().nullable(),
    utensils: z.array(z.string()).max(LIMITS.recipeUtensils.max),
    tags: z.array(z.string()).max(LIMITS.recipeTags.max),
    parent: z.string().nullable(),
    images: z
      .array(
        z.object({
          file: z.string(),
          thumbhash: z.string().nullable(),
          width: z.int().min(1).nullable(),
          height: z.int().min(1).nullable(),
        }),
      )
      .max(LIMITS.recipeImages.max),
    lines: z
      .array(
        z.object({
          ingredient: z.string().min(1),
          ingredientPath: z.array(z.string()).min(1),
          amount: amountSchema,
          amountMax: amountSchema,
          unit: UnitIdSchema.nullable(),
          optional: z.boolean(),
          specified: z.boolean(),
          note: z.string().max(LIMITS.lineNote.max),
          substitutes: z
            .array(
              z.object({
                ingredient: z.string().min(1),
                ingredientPath: z.array(z.string()).min(1),
                amount: amountSchema,
                amountMax: amountSchema,
                unit: UnitIdSchema.nullable(),
              }),
            )
            .max(LIMITS.substitutesPerLine.max),
        }),
      )
      .max(LIMITS.recipeLines.max),
  })
  .meta({ id: 'CellarRecipeRecord' });
export type CellarRecipeRecord = z.infer<typeof CellarRecipeRecordSchema>;

export const CellarRecipeFileSchema = z
  .object({
    format: z.literal(CELLAR_RECIPE_FORMAT),
    formatVersion: z.literal(CELLAR_RECIPE_FORMAT_VERSION),
    exportedAt: IsoDateTimeSchema,
    appVersion: z.string(),
    recipes: z.array(CellarRecipeRecordSchema),
  })
  .meta({ id: 'CellarRecipeFile' });
export type CellarRecipeFile = z.infer<typeof CellarRecipeFileSchema>;

export const BottleExportQuerySchema = z.object({ status: queryArray(BottleStatusSchema).optional() });
export type BottleExportQuery = z.infer<typeof BottleExportQuerySchema>;

export const IngredientExportQuerySchema = z.object({ provenance: ProvenanceSchema.optional() });
export type IngredientExportQuery = z.infer<typeof IngredientExportQuerySchema>;

export const RecipeExportQuerySchema = z.object({
  provenance: ProvenanceSchema.optional(),
  id: queryArray(queryId).optional(),
});
export type RecipeExportQuery = z.infer<typeof RecipeExportQuerySchema>;

export const exportRoutes = {
  exportBottles: {
    query: BottleExportQuerySchema,
    responses: { 200: 'csv' },
    errors: [],
    summary: 'Export bottles as CSV',
    tag: 'export',
  },
  exportIngredients: {
    query: IngredientExportQuerySchema,
    responses: { 200: 'csv' },
    errors: [],
    summary: 'Export ingredients as CSV',
    tag: 'export',
  },
  exportRecipes: {
    query: RecipeExportQuerySchema,
    responses: { 200: 'zip' },
    errors: ['not_found'],
    summary: 'Export recipes as a Cellar recipe zip',
    tag: 'export',
  },
} as const satisfies Record<keyof typeof exportEndpoints, RouteSchema>;
