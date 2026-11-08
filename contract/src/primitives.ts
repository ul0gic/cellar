import { z } from 'zod';
import { LIMITS } from './limits.ts';
import { INPUT_VOLUME_UNITS, UNIT_IDS } from './units.ts';

export const IdSchema = z.int().min(1).max(Number.MAX_SAFE_INTEGER).meta({ id: 'Id' });
export type Id = z.infer<typeof IdSchema>;

export const IsoDateTimeSchema = z.iso.datetime({ precision: 3 }).meta({ id: 'IsoDateTime' });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const IsoDateSchema = z.iso.date().meta({ id: 'IsoDate' });
export type IsoDate = z.infer<typeof IsoDateSchema>;

export const VisibilitySchema = z.enum(['household', 'private']).meta({ id: 'Visibility' });
export type Visibility = z.infer<typeof VisibilitySchema>;

export const RoleSchema = z.enum(['owner', 'member']).meta({ id: 'Role' });
export type Role = z.infer<typeof RoleSchema>;

export const ProvenanceSchema = z.enum(['catalog', 'household']).meta({ id: 'Provenance' });
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const PreferredUnitSchema = z.enum(['oz', 'ml']).meta({ id: 'PreferredUnit' });
export type PreferredUnit = z.infer<typeof PreferredUnitSchema>;

export const ThemeChoiceSchema = z.enum(['system', 'light', 'dark']).meta({ id: 'ThemeChoice' });
export type ThemeChoice = z.infer<typeof ThemeChoiceSchema>;

export const SortOrderSchema = z.enum(['asc', 'desc']).meta({ id: 'SortOrder' });
export type SortOrder = z.infer<typeof SortOrderSchema>;

export const TargetTypeSchema = z.enum(['recipe', 'ingredient']).meta({ id: 'TargetType' });
export type TargetType = z.infer<typeof TargetTypeSchema>;

export const TargetSchema = z.object({ type: TargetTypeSchema, id: IdSchema }).meta({ id: 'Target' });
export type Target = z.infer<typeof TargetSchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
  const itemId = z.globalRegistry.get(item)?.id;
  if (itemId === undefined) {
    throw new Error('pageSchema needs an item schema registered with an id');
  }
  return z
    .object({
      items: z.array(item),
      page: z.int().min(1),
      pageSize: z.int().min(1).max(LIMITS.pageSize.max),
      total: z.int().min(0),
    })
    .meta({ id: `Page_${itemId}` });
}
export type Page<T> = z.infer<ReturnType<typeof pageSchema<z.ZodType<T>>>>;

export const ImageRefSchema = z
  .object({
    id: IdSchema,
    url: z.string(),
    width: z.int().min(1).nullable(),
    height: z.int().min(1).nullable(),
    thumbhash: z.string().max(48).nullable(),
  })
  .meta({ id: 'ImageRef' });
export type ImageRef = z.infer<typeof ImageRefSchema>;

export const MemberRefSchema = z
  .object({ id: IdSchema, name: z.string(), avatar: ImageRefSchema.nullable() })
  .meta({ id: 'MemberRef' });
export type MemberRef = z.infer<typeof MemberRefSchema>;

export const RecipeRefSchema = z
  .object({ id: IdSchema, name: z.string(), image: ImageRefSchema.nullable() })
  .meta({ id: 'RecipeRef' });
export type RecipeRef = z.infer<typeof RecipeRefSchema>;

export const IngredientRefSchema = z
  .object({ id: IdSchema, name: z.string(), onHand: z.boolean() })
  .meta({ id: 'IngredientRef' });
export type IngredientRef = z.infer<typeof IngredientRefSchema>;

export const TaxonRefSchema = z.object({ id: IdSchema, name: z.string() }).meta({ id: 'TaxonRef' });
export type TaxonRef = z.infer<typeof TaxonRefSchema>;

export const MethodRefSchema = z
  .object({ id: IdSchema, name: z.string(), dilutionPercent: z.number() })
  .meta({ id: 'MethodRef' });
export type MethodRef = z.infer<typeof MethodRefSchema>;

export const RatingValueSchema = z.literal([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]).meta({ id: 'RatingValue' });
export type RatingValue = z.infer<typeof RatingValueSchema>;

export const RatingSchema = z.object({ value: RatingValueSchema, visibility: VisibilitySchema }).meta({ id: 'Rating' });
export type Rating = z.infer<typeof RatingSchema>;

export const HouseholdRatingSchema = z
  .object({ average: z.number().min(1).max(5).nullable(), count: z.int().min(0) })
  .meta({ id: 'HouseholdRating' });
export type HouseholdRating = z.infer<typeof HouseholdRatingSchema>;

export const queryNumber = z.coerce.number();
export const queryId = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const queryBoolean = z.stringbool({ truthy: ['true'], falsy: ['false'] });
export function queryArray<T extends z.ZodType>(item: T) {
  return z.preprocess((value) => (Array.isArray(value) ? value : [value]), z.array(item));
}
export const pageQueryShape = {
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSize.max).optional(),
};
export const idParams = z.object({ id: queryId });

export const UnitIdSchema = z.enum(UNIT_IDS).meta({ id: 'UnitId' });
export const InputUnitSchema = z.enum([...UNIT_IDS, ...INPUT_VOLUME_UNITS]).meta({ id: 'InputUnit' });
