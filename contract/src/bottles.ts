import { z } from 'zod';
import type { bottlesEndpoints } from './bottles-endpoints.ts';
import { LIMITS } from './limits.ts';
import {
  IdSchema,
  ImageRefSchema,
  IngredientRefSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  idParams,
  pageQueryShape,
  pageSchema,
  queryArray,
  queryId,
  SortOrderSchema,
  TaxonRefSchema,
} from './primitives.ts';
import type { RouteSchema } from './routes.ts';

const priceMinor = z.int().min(0).max(LIMITS.priceMinor.max);
const volumeMl = z.number().positive().max(LIMITS.volumeMl.max);
const abv = z.number().min(0).max(100);

export const BottleStatusSchema = z.enum(['sealed', 'open', 'finished']).meta({ id: 'BottleStatus' });
export type BottleStatus = z.infer<typeof BottleStatusSchema>;

export const BottleSummarySchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    status: BottleStatusSchema,
    ingredient: IngredientRefSchema,
    root: TaxonRefSchema,
    labeledSize: z.string(),
    image: ImageRefSchema.nullable(),
    openedOn: IsoDateSchema.nullable(),
    finishedOn: IsoDateSchema.nullable(),
    pricePaidMinor: priceMinor.nullable().optional(),
  })
  .meta({ id: 'BottleSummary' });
export type BottleSummary = z.infer<typeof BottleSummarySchema>;

export const BottleSchema = BottleSummarySchema.extend({
  volumeMl: volumeMl.nullable(),
  abv: abv.nullable(),
  purchasedOn: IsoDateSchema.nullable(),
  note: z.string(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).meta({ id: 'Bottle' });
export type Bottle = z.infer<typeof BottleSchema>;

const bottleFields = {
  name: z.string().trim().min(1).max(LIMITS.name.max),
  ingredientId: IdSchema,
  labeledSize: z.string().trim().min(1).max(LIMITS.labeledSize.max),
  volumeMl: volumeMl.nullable(),
  abv: abv.nullable(),
  pricePaidMinor: priceMinor.nullable(),
  purchasedOn: IsoDateSchema.nullable(),
  openedOn: IsoDateSchema.nullable(),
  note: z.string().max(LIMITS.bottleNote.max),
  imageId: IdSchema.nullable(),
};

export const BottleInputSchema = z
  .strictObject({
    ...bottleFields,
    status: z.enum(['sealed', 'open']),
    count: z.int().min(LIMITS.bottlesPerAdd.min).max(LIMITS.bottlesPerAdd.max),
  })
  .meta({ id: 'BottleInput' });
export type BottleInput = z.infer<typeof BottleInputSchema>;

export const BottlePatchSchema = z
  .strictObject(bottleFields)
  .partial()
  .extend({ finishedOn: IsoDateSchema.nullable().optional() })
  .meta({ id: 'BottlePatch' });
export type BottlePatch = z.infer<typeof BottlePatchSchema>;

export const CreatedBottlesSchema = z.object({ bottles: z.array(BottleSchema) }).meta({ id: 'CreatedBottles' });
export type CreatedBottles = z.infer<typeof CreatedBottlesSchema>;

export const StatusActionInputSchema = z.strictObject({ on: IsoDateSchema }).meta({ id: 'StatusActionInput' });
export type StatusActionInput = z.infer<typeof StatusActionInputSchema>;

export const BulkBottleInputSchema = z
  .strictObject({
    action: z.enum(['open', 'finish', 'delete']),
    ids: z.array(IdSchema).min(1).max(LIMITS.bulkIds.max),
    on: IsoDateSchema,
  })
  .meta({ id: 'BulkBottleInput' });
export type BulkBottleInput = z.infer<typeof BulkBottleInputSchema>;

export const BulkBottleResultSchema = z
  .object({
    affected: z.int().min(0),
    skipped: z.array(z.object({ id: IdSchema, reason: z.enum(['invalid_transition', 'not_found']) })),
  })
  .meta({ id: 'BulkBottleResult' });
export type BulkBottleResult = z.infer<typeof BulkBottleResultSchema>;

export const BottleListQuerySchema = z.object({
  status: queryArray(BottleStatusSchema).optional(),
  root: queryId.optional(),
  ingredient: queryId.optional(),
  q: z.string().min(1).max(LIMITS.searchQuery.max).optional(),
  sort: z.enum(['name', 'category', 'opened', 'finished', 'price', 'added']).optional(),
  order: SortOrderSchema.optional(),
  ...pageQueryShape,
});
export type BottleListQuery = z.infer<typeof BottleListQuerySchema>;

export const ShelfTotalsSchema = z
  .object({
    count: z.int().min(0),
    sealed: z.int().min(0),
    open: z.int().min(0),
    priced: z.int().min(0),
    valueMinor: z.int().min(0).optional(),
  })
  .meta({ id: 'ShelfTotals' });
export type ShelfTotals = z.infer<typeof ShelfTotalsSchema>;

export const BottlePageSchema = pageSchema(BottleSummarySchema)
  .extend({ totals: ShelfTotalsSchema })
  .meta({ id: 'BottlePage' });
export type BottlePage = z.infer<typeof BottlePageSchema>;

export const bottlesRoutes = {
  listBottles: {
    query: BottleListQuerySchema,
    responses: { 200: BottlePageSchema },
    errors: ['prices_hidden'],
    summary: 'List bottles on the shelf or in history',
    tag: 'bottles',
  },
  getBottle: {
    params: idParams,
    responses: { 200: BottleSchema },
    errors: ['not_found'],
    summary: 'Get a bottle',
    tag: 'bottles',
  },
  createBottles: {
    body: BottleInputSchema,
    responses: { 201: CreatedBottlesSchema },
    errors: ['validation_failed'],
    summary: 'Add one or more identical bottles',
    tag: 'bottles',
  },
  updateBottle: {
    params: idParams,
    body: BottlePatchSchema,
    responses: { 200: BottleSchema },
    errors: ['not_found'],
    summary: 'Change a bottle',
    tag: 'bottles',
  },
  deleteBottle: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found'],
    summary: 'Delete a bottle',
    tag: 'bottles',
  },
  openBottle: {
    params: idParams,
    body: StatusActionInputSchema,
    responses: { 200: BottleSchema },
    errors: ['not_found', 'invalid_transition'],
    summary: 'Open a sealed bottle',
    tag: 'bottles',
  },
  finishBottle: {
    params: idParams,
    body: StatusActionInputSchema,
    responses: { 200: BottleSchema },
    errors: ['not_found', 'invalid_transition'],
    summary: 'Finish a bottle',
    tag: 'bottles',
  },
  reopenBottle: {
    params: idParams,
    responses: { 200: BottleSchema },
    errors: ['not_found', 'invalid_transition'],
    summary: 'Put a finished bottle back on the shelf',
    tag: 'bottles',
  },
  bulkBottles: {
    body: BulkBottleInputSchema,
    responses: { 200: BulkBottleResultSchema },
    errors: [],
    summary: 'Open, finish or delete several bottles',
    tag: 'bottles',
  },
} as const satisfies Record<keyof typeof bottlesEndpoints, RouteSchema>;
