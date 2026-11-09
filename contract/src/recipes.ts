import { z } from 'zod';
import { LIMITS } from './limits.ts';
import {
  HouseholdRatingSchema,
  IdSchema,
  ImageRefSchema,
  IngredientRefSchema,
  InputUnitSchema,
  IsoDateTimeSchema,
  idParams,
  MethodRefSchema,
  pageQueryShape,
  pageSchema,
  ProvenanceSchema,
  queryArray,
  queryBoolean,
  queryId,
  queryNumber,
  RatingSchema,
  RatingValueSchema,
  RecipeRefSchema,
  SortOrderSchema,
  TaxonRefSchema,
  UnitIdSchema,
} from './primitives.ts';
import type { recipesEndpoints } from './recipes-endpoints.ts';
import type { RouteSchema } from './routes.ts';
import { ShoppingListChangeSchema, SubstitutionEffectSchema } from './shopping.ts';

const amount = z.number().positive().max(LIMITS.amount.max);
const year = z.int().min(1700).max(2100);
const abvBound = queryNumber.min(0).max(100);

export const LineStatusSchema = z
  .enum(['on_hand', 'via_substitute', 'via_variant', 'via_house_made', 'via_household_substitution', 'missing'])
  .meta({ id: 'LineStatus' });
export type LineStatus = z.infer<typeof LineStatusSchema>;

export const LineCoverageSchema = z.enum(['on_hand', 'covered', 'missing']).meta({ id: 'LineCoverage' });
export type LineCoverage = z.infer<typeof LineCoverageSchema>;

export const LineSubstituteSchema = z
  .object({
    ingredient: IngredientRefSchema,
    amount: amount.nullable(),
    amountMax: amount.nullable(),
    unit: UnitIdSchema.nullable(),
  })
  .meta({ id: 'LineSubstitute' });
export type LineSubstitute = z.infer<typeof LineSubstituteSchema>;

export const RecipeLineSchema = z
  .object({
    id: IdSchema,
    position: z.int().min(0),
    ingredient: IngredientRefSchema,
    amount: amount.nullable(),
    amountMax: amount.nullable(),
    unit: UnitIdSchema.nullable(),
    optional: z.boolean(),
    specified: z.boolean(),
    note: z.string(),
    substitutes: z.array(LineSubstituteSchema),
    status: LineStatusSchema,
    satisfiedBy: IngredientRefSchema.nullable(),
    substitutionEffect: SubstitutionEffectSchema.nullable(),
  })
  .meta({ id: 'RecipeLine' });
export type RecipeLine = z.infer<typeof RecipeLineSchema>;

export const RecipeSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    provenance: ProvenanceSchema,
    editedFromCatalog: z.boolean(),
    description: z.string(),
    instructions: z.string(),
    garnish: z.string(),
    source: z.string(),
    year: year.nullable(),
    images: z.array(ImageRefSchema),
    glass: TaxonRefSchema.nullable(),
    method: MethodRefSchema.nullable(),
    utensils: z.array(TaxonRefSchema),
    tags: z.array(TaxonRefSchema),
    lines: z.array(RecipeLineSchema),
    abv: z.number().nullable(),
    volumeMl: z.number().nullable(),
    parent: RecipeRefSchema.nullable(),
    variants: z.array(RecipeRefSchema),
    canMake: z.boolean(),
    missingCount: z.int().min(0),
    collections: z.array(TaxonRefSchema),
    mine: z.object({ favorite: z.boolean(), rating: RatingSchema.nullable(), madeCount: z.int().min(0) }),
    household: z.object({
      rating: HouseholdRatingSchema,
      madeCount: z.int().min(0),
      lastMadeAt: IsoDateTimeSchema.nullable(),
    }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'Recipe' });
export type Recipe = z.infer<typeof RecipeSchema>;

export const RecipeSummarySchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    image: ImageRefSchema.nullable(),
    provenance: ProvenanceSchema,
    glass: TaxonRefSchema.nullable(),
    tags: z.array(TaxonRefSchema),
    ingredients: z.array(z.string()).max(LIMITS.recipeLines.max),
    abv: z.number().nullable(),
    canMake: z.boolean(),
    missingCount: z.int().min(0),
    coverage: z.array(LineCoverageSchema),
    mine: z.object({ favorite: z.boolean(), rating: RatingSchema.nullable(), madeCount: z.int().min(0) }),
    household: z.object({ rating: HouseholdRatingSchema }),
    createdAt: IsoDateTimeSchema,
  })
  .meta({ id: 'RecipeSummary' });
export type RecipeSummary = z.infer<typeof RecipeSummarySchema>;

export const RecipeLineInputSchema = z
  .strictObject({
    ingredientId: IdSchema,
    amount: amount.nullable(),
    amountMax: amount.nullable(),
    unit: InputUnitSchema.nullable(),
    optional: z.boolean(),
    specified: z.boolean(),
    note: z.string().max(LIMITS.lineNote.max),
    substitutes: z
      .array(
        z.strictObject({
          ingredientId: IdSchema,
          amount: amount.nullable(),
          amountMax: amount.nullable(),
          unit: InputUnitSchema.nullable(),
        }),
      )
      .max(LIMITS.substitutesPerLine.max),
  })
  .meta({ id: 'RecipeLineInput' });
export type RecipeLineInput = z.infer<typeof RecipeLineInputSchema>;

export const RecipeInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(LIMITS.name.max),
    description: z.string().max(LIMITS.description.max),
    instructions: z.string().max(LIMITS.instructions.max),
    garnish: z.string().max(LIMITS.garnish.max),
    source: z.string().max(LIMITS.source.max),
    year: year.nullable(),
    glassId: IdSchema.nullable(),
    methodId: IdSchema.nullable(),
    utensilIds: z.array(IdSchema).max(LIMITS.recipeUtensils.max),
    tags: z.array(z.string().trim().min(1).max(LIMITS.tagName.max)).max(LIMITS.recipeTags.max),
    imageIds: z.array(IdSchema).max(LIMITS.recipeImages.max),
    parentId: IdSchema.nullable(),
    lines: z.array(RecipeLineInputSchema).min(1).max(LIMITS.recipeLines.max),
  })
  .meta({ id: 'RecipeInput' });
export type RecipeInput = z.infer<typeof RecipeInputSchema>;

export const RecipeListQuerySchema = z.object({
  q: z.string().min(1).max(LIMITS.searchQuery.max).optional(),
  status: z.enum(['can_make', 'missing_1', 'missing_2']).optional(),
  favorites: queryBoolean.optional(),
  madeIt: queryBoolean.optional(),
  tag: queryArray(queryId).optional(),
  glass: queryArray(queryId).optional(),
  method: queryArray(queryId).optional(),
  collection: queryId.optional(),
  ingredient: queryId.optional(),
  abvMin: abvBound.optional(),
  abvMax: abvBound.optional(),
  ratingMin: queryNumber.pipe(RatingValueSchema).optional(),
  provenance: ProvenanceSchema.optional(),
  sort: z.enum(['name', 'rating', 'abv', 'added']).optional(),
  order: SortOrderSchema.optional(),
  ...pageQueryShape,
});
export type RecipeListQuery = z.infer<typeof RecipeListQuerySchema>;

export const RecipeFacetsSchema = z
  .object({
    all: z.int().min(0),
    canMake: z.int().min(0),
    missing1: z.int().min(0),
    missing2: z.int().min(0),
  })
  .meta({ id: 'RecipeFacets' });
export type RecipeFacets = z.infer<typeof RecipeFacetsSchema>;

export const RecipeSummaryPageSchema = pageSchema(RecipeSummarySchema);

export const RecipePageSchema = RecipeSummaryPageSchema.extend({ facets: RecipeFacetsSchema }).meta({
  id: 'RecipePage',
});
export type RecipePage = z.infer<typeof RecipePageSchema>;

export const recipesRoutes = {
  listRecipes: {
    query: RecipeListQuerySchema,
    responses: { 200: RecipePageSchema },
    errors: [],
    summary: 'List recipes with filters and can-make counts',
    tag: 'recipes',
  },
  getRecipe: {
    params: idParams,
    responses: { 200: RecipeSchema },
    errors: ['not_found'],
    summary: 'Get a recipe with its line statuses',
    tag: 'recipes',
  },
  createRecipe: {
    body: RecipeInputSchema,
    responses: { 201: RecipeSchema },
    errors: ['validation_failed'],
    summary: 'Add a recipe',
    tag: 'recipes',
  },
  replaceRecipe: {
    params: idParams,
    body: RecipeInputSchema,
    responses: { 200: RecipeSchema },
    errors: ['not_found', 'validation_failed'],
    summary: 'Replace a recipe',
    tag: 'recipes',
  },
  deleteRecipe: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found'],
    summary: 'Delete a recipe',
    tag: 'recipes',
  },
  addMissingToShoppingList: {
    params: idParams,
    responses: { 200: ShoppingListChangeSchema },
    errors: ['not_found'],
    summary: "Add a recipe's missing ingredients to the shopping list",
    tag: 'recipes',
  },
} as const satisfies Record<keyof typeof recipesEndpoints, RouteSchema>;
