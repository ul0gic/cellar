import { z } from 'zod';
import type { collectionsEndpoints } from './collections-endpoints.ts';
import { LIMITS } from './limits.ts';
import {
  IdSchema,
  ImageRefSchema,
  IngredientRefSchema,
  IsoDateTimeSchema,
  MemberRefSchema,
  ProvenanceSchema,
  queryId,
  UnitIdSchema,
  RecipeRefSchema,
  idParams,
} from './primitives.ts';
import { RecipeSummarySchema } from './recipes.ts';
import type { RouteSchema } from './routes.ts';

const COLLECTION_DESCRIPTION_MAX = 1000;
const CALCULATOR_LABEL_MAX = 60;

const collectionNameSchema = z.string().min(1).max(LIMITS.shortName.max);
const collectionDescriptionSchema = z.string().max(COLLECTION_DESCRIPTION_MAX);

const collectionSummaryFields = {
  id: IdSchema,
  name: z.string(),
  description: z.string(),
  recipeCount: z.int().min(0),
  cover: ImageRefSchema.nullable(),
  createdBy: MemberRefSchema.nullable(),
  canEdit: z.boolean(),
  updatedAt: IsoDateTimeSchema,
};

export const CollectionSummarySchema = z.object(collectionSummaryFields).meta({ id: 'CollectionSummary' });
export type CollectionSummary = z.infer<typeof CollectionSummarySchema>;

export const CollectionSchema = z
  .object({ ...collectionSummaryFields, recipes: z.array(RecipeSummarySchema).max(LIMITS.collectionRecipes.max) })
  .meta({ id: 'Collection' });
export type Collection = z.infer<typeof CollectionSchema>;

export const CollectionInputSchema = z
  .strictObject({ name: collectionNameSchema, description: collectionDescriptionSchema })
  .meta({ id: 'CollectionInput' });
export type CollectionInput = z.infer<typeof CollectionInputSchema>;

export const CollectionPatchSchema = z
  .strictObject({
    name: collectionNameSchema.optional(),
    description: collectionDescriptionSchema.optional(),
    recipeIds: z.array(IdSchema).max(LIMITS.collectionRecipes.max).optional(),
  })
  .meta({ id: 'CollectionPatch' });
export type CollectionPatch = z.infer<typeof CollectionPatchSchema>;

export const CollectionAddInputSchema = z.strictObject({ recipeId: IdSchema }).meta({ id: 'CollectionAddInput' });
export type CollectionAddInput = z.infer<typeof CollectionAddInputSchema>;

export const ListCollectionsResponseSchema = z
  .object({ collections: z.array(CollectionSummarySchema) })
  .meta({ id: 'ListCollectionsResponse' });
export type ListCollectionsResponse = z.infer<typeof ListCollectionsResponseSchema>;

export const PartyInputSchema = z
  .strictObject({
    recipes: z
      .array(
        z.strictObject({
          recipeId: IdSchema,
          servings: z.int().min(LIMITS.partyServings.min).max(LIMITS.partyServings.max),
        }),
      )
      .min(1)
      .max(LIMITS.partyRecipes.max),
  })
  .meta({ id: 'PartyInput' });
export type PartyInput = z.infer<typeof PartyInputSchema>;

export const PartyLineSchema = z
  .object({
    ingredient: IngredientRefSchema,
    volumeMl: z.number().min(0).nullable(),
    counts: z.array(z.object({ unit: UnitIdSchema.nullable(), amount: z.number().min(0) })),
    satisfied: z.boolean(),
    optionalOnly: z.boolean(),
    recipeCount: z.int().min(1),
  })
  .meta({ id: 'PartyLine' });
export type PartyLine = z.infer<typeof PartyLineSchema>;

export const PartyResultSchema = z
  .object({
    recipes: z.array(z.object({ recipe: RecipeRefSchema, servings: z.int().min(1) })),
    lines: z.array(PartyLineSchema),
    totalVolumeMl: z.number().min(0),
  })
  .meta({ id: 'PartyResult' });
export type PartyResult = z.infer<typeof PartyResultSchema>;

const calculatorLabelSchema = z.string().min(1).max(CALCULATOR_LABEL_MAX);
const calculatorSuffixSchema = z.string().max(LIMITS.calculatorSuffix.max);

export const CalculatorInputFieldSchema = z
  .strictObject({
    key: z.string(),
    label: calculatorLabelSchema,
    defaultValue: z.number(),
    suffix: calculatorSuffixSchema,
  })
  .meta({ id: 'CalculatorInputField' });
export type CalculatorInputField = z.infer<typeof CalculatorInputFieldSchema>;

export const CalculatorOutputFieldSchema = z
  .strictObject({
    key: z.string(),
    label: calculatorLabelSchema,
    expression: z.string(),
    decimals: z.int().min(0).max(LIMITS.calculatorDecimals.max),
    suffix: calculatorSuffixSchema,
  })
  .meta({ id: 'CalculatorOutputField' });
export type CalculatorOutputField = z.infer<typeof CalculatorOutputFieldSchema>;

const calculatorInputFields = {
  name: z.string().min(1).max(LIMITS.name.max),
  description: z.string().max(LIMITS.description.max),
  inputs: z.array(CalculatorInputFieldSchema).min(1).max(LIMITS.calculatorInputs.max),
  outputs: z.array(CalculatorOutputFieldSchema).min(1).max(LIMITS.calculatorOutputs.max),
};

export const CalculatorInputSchema = z.strictObject(calculatorInputFields).meta({ id: 'CalculatorInput' });
export type CalculatorInput = z.infer<typeof CalculatorInputSchema>;

export const CalculatorSchema = z
  .object({
    ...calculatorInputFields,
    id: IdSchema,
    provenance: ProvenanceSchema,
    createdBy: MemberRefSchema.nullable(),
    canEdit: z.boolean(),
    updatedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'Calculator' });
export type Calculator = z.infer<typeof CalculatorSchema>;

export const ListCalculatorsResponseSchema = z
  .object({ calculators: z.array(CalculatorSchema) })
  .meta({ id: 'ListCalculatorsResponse' });
export type ListCalculatorsResponse = z.infer<typeof ListCalculatorsResponseSchema>;

export const collectionsRoutes = {
  listCollections: {
    responses: { 200: ListCollectionsResponseSchema },
    errors: [],
    summary: 'List collections',
    tag: 'collections',
  },
  createCollection: {
    body: CollectionInputSchema,
    responses: { 201: CollectionSchema },
    errors: ['duplicate_name'],
    summary: 'Create a collection',
    tag: 'collections',
  },
  getCollection: {
    params: idParams,
    responses: { 200: CollectionSchema },
    errors: ['not_found'],
    summary: 'Get a collection with its recipes',
    tag: 'collections',
  },
  updateCollection: {
    params: idParams,
    body: CollectionPatchSchema,
    responses: { 200: CollectionSchema },
    errors: ['not_found', 'not_owner', 'duplicate_name', 'validation_failed'],
    summary: 'Change a collection or reorder its recipes',
    tag: 'collections',
  },
  deleteCollection: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found', 'not_owner'],
    summary: 'Delete a collection',
    tag: 'collections',
  },
  addRecipeToCollection: {
    params: idParams,
    body: CollectionAddInputSchema,
    responses: { 200: CollectionSchema },
    errors: ['not_found', 'not_owner'],
    summary: 'Add a recipe to a collection',
    tag: 'collections',
  },
  removeRecipeFromCollection: {
    params: idParams.extend({ recipeId: queryId }),
    responses: { 200: CollectionSchema },
    errors: ['not_found', 'not_owner'],
    summary: 'Remove a recipe from a collection',
    tag: 'collections',
  },
  calculateParty: {
    body: PartyInputSchema,
    responses: { 200: PartyResultSchema },
    errors: ['validation_failed'],
    summary: 'Total the ingredients for a party',
    tag: 'collections',
  },
  listCalculators: {
    responses: { 200: ListCalculatorsResponseSchema },
    errors: [],
    summary: 'List calculators',
    tag: 'collections',
  },
  getCalculator: {
    params: idParams,
    responses: { 200: CalculatorSchema },
    errors: ['not_found'],
    summary: 'Get a calculator',
    tag: 'collections',
  },
  createCalculator: {
    body: CalculatorInputSchema,
    responses: { 201: CalculatorSchema },
    errors: ['validation_failed'],
    summary: 'Create a calculator',
    tag: 'collections',
  },
  replaceCalculator: {
    params: idParams,
    body: CalculatorInputSchema,
    responses: { 200: CalculatorSchema },
    errors: ['not_found', 'not_owner', 'validation_failed'],
    summary: 'Replace a calculator',
    tag: 'collections',
  },
  deleteCalculator: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found', 'not_owner'],
    summary: 'Delete a calculator',
    tag: 'collections',
  },
} as const satisfies Record<keyof typeof collectionsEndpoints, RouteSchema>;
