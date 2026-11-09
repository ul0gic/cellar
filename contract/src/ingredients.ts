import { z } from 'zod';
import { BottleSummarySchema } from './bottles.ts';
import type { ingredientsEndpoints } from './ingredients-endpoints.ts';
import { LIMITS } from './limits.ts';
import {
  HouseholdRatingSchema,
  IdSchema,
  ImageRefSchema,
  IngredientRefSchema,
  InputUnitSchema,
  IsoDateTimeSchema,
  idParams,
  pageQueryShape,
  pageSchema,
  ProvenanceSchema,
  queryBoolean,
  queryId,
  RatingSchema,
  RecipeRefSchema,
  SortOrderSchema,
  TaxonRefSchema,
  UnitIdSchema,
} from './primitives.ts';
import type { RouteSchema } from './routes.ts';
import { ShoppingListChangeSchema } from './shopping.ts';

const strength = z.number().min(0).max(100);
const amount = z.number().positive().max(LIMITS.amount.max);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const OnHandReasonSchema = z.enum(['marked', 'bottle', 'parts']).meta({ id: 'OnHandReason' });
export type OnHandReason = z.infer<typeof OnHandReasonSchema>;

export const IngredientNodeSchema = z
  .object({
    id: IdSchema,
    parentId: IdSchema.nullable(),
    name: z.string(),
    depth: z.int().min(0),
    onHand: z.boolean(),
    childCount: z.int().min(0),
    bottleCount: z.int().min(0),
    recipeCount: z.int().min(0),
    houseMade: z.boolean(),
  })
  .meta({ id: 'IngredientNode' });
export type IngredientNode = z.infer<typeof IngredientNodeSchema>;

export const IngredientTreeSchema = z.object({ nodes: z.array(IngredientNodeSchema) }).meta({ id: 'IngredientTree' });
export type IngredientTree = z.infer<typeof IngredientTreeSchema>;

export const IngredientSummarySchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    image: ImageRefSchema.nullable(),
    strength,
    parent: TaxonRefSchema.nullable(),
    root: TaxonRefSchema,
    onHand: z.boolean(),
    markedOnHand: z.boolean(),
    bottleCount: z.int().min(0),
    recipeCount: z.int().min(0),
    houseMade: z.boolean(),
  })
  .meta({ id: 'IngredientSummary' });
export type IngredientSummary = z.infer<typeof IngredientSummarySchema>;

export const IngredientSummaryPageSchema = pageSchema(IngredientSummarySchema);
export type IngredientSummaryPage = z.infer<typeof IngredientSummaryPageSchema>;

export const IngredientPartSchema = z
  .object({ ingredient: IngredientRefSchema, amount: amount.nullable(), unit: UnitIdSchema.nullable() })
  .meta({ id: 'IngredientPart' });
export type IngredientPart = z.infer<typeof IngredientPartSchema>;

export const IngredientSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    provenance: ProvenanceSchema,
    editedFromCatalog: z.boolean(),
    parent: IngredientRefSchema.nullable(),
    path: z.array(TaxonRefSchema),
    children: z.array(IngredientRefSchema),
    strength,
    description: z.string(),
    origin: z.string(),
    color: color.nullable(),
    defaultUnit: UnitIdSchema.nullable(),
    image: ImageRefSchema.nullable(),
    parts: z.array(IngredientPartSchema),
    onHand: z.boolean(),
    onHandReason: OnHandReasonSchema.nullable(),
    markedOnHand: z.boolean(),
    usedIn: z.object({ count: z.int().min(0), recipes: z.array(RecipeRefSchema) }),
    substitutesIn: z.object({ count: z.int().min(0), recipes: z.array(RecipeRefSchema) }),
    bottles: z.object({ onShelf: z.array(BottleSummarySchema), finishedCount: z.int().min(0) }),
    mine: z.object({ rating: RatingSchema.nullable() }),
    household: z.object({ rating: HouseholdRatingSchema }),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'Ingredient' });
export type Ingredient = z.infer<typeof IngredientSchema>;

const ingredientFields = {
  name: z.string().trim().min(1).max(LIMITS.name.max),
  parentId: IdSchema.nullable(),
  strength,
  description: z.string().max(LIMITS.description.max),
  origin: z.string().max(LIMITS.name.max),
  color: color.nullable(),
  defaultUnit: InputUnitSchema.nullable(),
  imageId: IdSchema.nullable(),
  parts: z
    .array(z.strictObject({ ingredientId: IdSchema, amount: amount.nullable(), unit: InputUnitSchema.nullable() }))
    .max(LIMITS.ingredientParts.max),
};

export const IngredientInputSchema = z.strictObject(ingredientFields).meta({ id: 'IngredientInput' });
export type IngredientInput = z.infer<typeof IngredientInputSchema>;

export const IngredientPatchSchema = z.strictObject(ingredientFields).partial().meta({ id: 'IngredientPatch' });
export type IngredientPatch = z.infer<typeof IngredientPatchSchema>;

export const IngredientListQuerySchema = z.object({
  q: z.string().min(1).max(LIMITS.searchQuery.max).optional(),
  onHand: queryBoolean.optional(),
  root: queryId.optional(),
  parent: queryId.optional(),
  hasBottles: queryBoolean.optional(),
  houseMade: queryBoolean.optional(),
  sort: z.enum(['name', 'recipes']).optional(),
  order: SortOrderSchema.optional(),
  ...pageQueryShape,
});
export type IngredientListQuery = z.infer<typeof IngredientListQuerySchema>;

export const OnHandInputSchema = z.strictObject({ marked: z.boolean() }).meta({ id: 'OnHandInput' });
export type OnHandInput = z.infer<typeof OnHandInputSchema>;

export const OnHandStateSchema = z
  .object({
    id: IdSchema,
    onHand: z.boolean(),
    markedOnHand: z.boolean(),
    onHandReason: OnHandReasonSchema.nullable(),
  })
  .meta({ id: 'OnHandState' });
export type OnHandState = z.infer<typeof OnHandStateSchema>;

export const ingredientsRoutes = {
  getIngredientTree: {
    responses: { 200: IngredientTreeSchema },
    errors: [],
    summary: 'Get the whole ingredient tree, flat and depth-first',
    tag: 'ingredients',
  },
  listIngredients: {
    query: IngredientListQuerySchema,
    responses: { 200: IngredientSummaryPageSchema },
    errors: [],
    summary: 'List ingredients',
    tag: 'ingredients',
  },
  getIngredient: {
    params: idParams,
    responses: { 200: IngredientSchema },
    errors: ['not_found'],
    summary: 'Get an ingredient',
    tag: 'ingredients',
  },
  createIngredient: {
    body: IngredientInputSchema,
    responses: { 201: IngredientSchema },
    errors: ['duplicate_name', 'validation_failed'],
    summary: 'Add an ingredient',
    tag: 'ingredients',
  },
  updateIngredient: {
    params: idParams,
    body: IngredientPatchSchema,
    responses: { 200: IngredientSchema },
    errors: ['not_found', 'duplicate_name', 'validation_failed'],
    summary: 'Change an ingredient',
    tag: 'ingredients',
  },
  deleteIngredient: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found', 'in_use'],
    summary: 'Delete an ingredient nothing uses',
    tag: 'ingredients',
  },
  setOnHand: {
    params: idParams,
    body: OnHandInputSchema,
    responses: { 200: OnHandStateSchema },
    errors: ['not_found'],
    summary: 'Mark an ingredient on hand or not',
    tag: 'ingredients',
  },
  addIngredientToShoppingList: {
    params: idParams,
    responses: { 200: ShoppingListChangeSchema },
    errors: ['not_found'],
    summary: 'Add an ingredient to the shopping list',
    tag: 'ingredients',
  },
} as const satisfies Record<keyof typeof ingredientsEndpoints, RouteSchema>;
