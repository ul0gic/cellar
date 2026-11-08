import { z } from 'zod';
import { LIMITS } from './limits.ts';
import type { notesEndpoints } from './notes-endpoints.ts';
import {
  HouseholdRatingSchema,
  IdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  idParams,
  MemberRefSchema,
  pageQueryShape,
  pageSchema,
  RatingSchema,
  RatingValueSchema,
  TargetSchema,
  TaxonRefSchema,
  VisibilitySchema,
} from './primitives.ts';
import type { RouteSchema } from './routes.ts';

export const VerdictSchema = z.enum(['avoid', 'decent', 'recommend']).meta({ id: 'Verdict' });
export type Verdict = z.infer<typeof VerdictSchema>;

export const NoteSchema = z
  .object({
    id: IdSchema,
    target: TargetSchema,
    author: MemberRefSchema,
    mine: z.boolean(),
    text: z.string(),
    tastedOn: IsoDateSchema,
    descriptors: z.array(TaxonRefSchema),
    verdict: VerdictSchema.nullable(),
    visibility: VisibilitySchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'Note' });
export type Note = z.infer<typeof NoteSchema>;

export const NotePageSchema = pageSchema(NoteSchema);
export type NotePage = z.infer<typeof NotePageSchema>;

const noteFields = {
  text: z.string().max(LIMITS.noteText.max),
  tastedOn: IsoDateSchema,
  descriptorIds: z.array(IdSchema).max(LIMITS.noteDescriptors.max),
  verdict: VerdictSchema.nullable(),
  visibility: VisibilitySchema.optional(),
};

export const NoteInputSchema = z.strictObject(noteFields).meta({ id: 'NoteInput' });
export type NoteInput = z.infer<typeof NoteInputSchema>;

export const NotePatchSchema = z.strictObject(noteFields).partial().meta({ id: 'NotePatch' });
export type NotePatch = z.infer<typeof NotePatchSchema>;

export const NoteListQuerySchema = z.object(pageQueryShape);
export type NoteListQuery = z.infer<typeof NoteListQuerySchema>;

export const RatingInputSchema = z
  .strictObject({ value: RatingValueSchema, visibility: VisibilitySchema.optional() })
  .meta({ id: 'RatingInput' });
export type RatingInput = z.infer<typeof RatingInputSchema>;

export const RatingStateSchema = z
  .object({ mine: RatingSchema.nullable(), household: HouseholdRatingSchema })
  .meta({ id: 'RatingState' });
export type RatingState = z.infer<typeof RatingStateSchema>;

export const FavoriteStateSchema = z.object({ favorite: z.boolean() }).meta({ id: 'FavoriteState' });
export type FavoriteState = z.infer<typeof FavoriteStateSchema>;

export const MadeItStateSchema = z
  .object({
    entryId: IdSchema.nullable(),
    mine: z.object({ count: z.int().min(0) }),
    household: z.object({ count: z.int().min(0), lastMadeAt: IsoDateTimeSchema.nullable() }),
  })
  .meta({ id: 'MadeItState' });
export type MadeItState = z.infer<typeof MadeItStateSchema>;

export const notesRoutes = {
  listRecipeNotes: {
    params: idParams,
    query: NoteListQuerySchema,
    responses: { 200: NotePageSchema },
    errors: ['not_found'],
    summary: "List a recipe's notes I can see",
    tag: 'notes',
  },
  listIngredientNotes: {
    params: idParams,
    query: NoteListQuerySchema,
    responses: { 200: NotePageSchema },
    errors: ['not_found'],
    summary: "List an ingredient's notes I can see",
    tag: 'notes',
  },
  createRecipeNote: {
    params: idParams,
    body: NoteInputSchema,
    responses: { 201: NoteSchema },
    errors: ['not_found'],
    summary: 'Add a tasting note to a recipe',
    tag: 'notes',
  },
  createIngredientNote: {
    params: idParams,
    body: NoteInputSchema,
    responses: { 201: NoteSchema },
    errors: ['not_found'],
    summary: 'Add a tasting note to an ingredient',
    tag: 'notes',
  },
  updateNote: {
    params: idParams,
    body: NotePatchSchema,
    responses: { 200: NoteSchema },
    errors: ['not_found', 'not_owner'],
    summary: 'Change one of my notes',
    tag: 'notes',
  },
  deleteNote: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found', 'not_owner'],
    summary: 'Delete one of my notes',
    tag: 'notes',
  },
  rateRecipe: {
    params: idParams,
    body: RatingInputSchema,
    responses: { 200: RatingStateSchema },
    errors: ['not_found'],
    summary: 'Rate a recipe',
    tag: 'notes',
  },
  rateIngredient: {
    params: idParams,
    body: RatingInputSchema,
    responses: { 200: RatingStateSchema },
    errors: ['not_found'],
    summary: 'Rate an ingredient',
    tag: 'notes',
  },
  clearRecipeRating: {
    params: idParams,
    responses: { 200: RatingStateSchema },
    errors: ['not_found'],
    summary: 'Clear my rating of a recipe',
    tag: 'notes',
  },
  clearIngredientRating: {
    params: idParams,
    responses: { 200: RatingStateSchema },
    errors: ['not_found'],
    summary: 'Clear my rating of an ingredient',
    tag: 'notes',
  },
  favoriteRecipe: {
    params: idParams,
    responses: { 200: FavoriteStateSchema },
    errors: ['not_found'],
    summary: 'Add a recipe to my favorites',
    tag: 'notes',
  },
  unfavoriteRecipe: {
    params: idParams,
    responses: { 200: FavoriteStateSchema },
    errors: ['not_found'],
    summary: 'Remove a recipe from my favorites',
    tag: 'notes',
  },
  recordMadeIt: {
    params: idParams,
    responses: { 201: MadeItStateSchema },
    errors: ['not_found'],
    summary: 'Record that I made a recipe',
    tag: 'notes',
  },
  undoMadeIt: {
    params: z.object({ entryId: idParams.shape.id }),
    responses: { 200: MadeItStateSchema },
    errors: ['not_found', 'not_owner'],
    summary: 'Undo a made-it entry',
    tag: 'notes',
  },
} as const satisfies Record<keyof typeof notesEndpoints, RouteSchema>;
