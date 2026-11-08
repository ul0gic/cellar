import { z } from 'zod';
import {
  IdSchema,
  IngredientRefSchema,
  IsoDateTimeSchema,
  idParams,
  MemberRefSchema,
  queryNumber,
  RecipeRefSchema,
} from './primitives.ts';
import { LIMITS } from './limits.ts';
import type { RouteSchema } from './routes.ts';
import type { shoppingEndpoints } from './shopping-endpoints.ts';

const SHOPPING_ADD_ITEMS_MAX = 200;
const BUY_NEXT_RECIPES_MAX = 20;
const BUY_NEXT_LIMIT_MAX = 10;

export const SubstitutionEffectSchema = z.enum(['same_drink', 'changes_drink']).meta({ id: 'SubstitutionEffect' });
export type SubstitutionEffect = z.infer<typeof SubstitutionEffectSchema>;

export const HouseholdSubstitutionSchema = z
  .object({
    id: IdSchema,
    from: IngredientRefSchema,
    to: IngredientRefSchema,
    effect: SubstitutionEffectSchema,
    createdBy: MemberRefSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .meta({ id: 'HouseholdSubstitution' });
export type HouseholdSubstitution = z.infer<typeof HouseholdSubstitutionSchema>;

export const SubstitutionInputSchema = z
  .strictObject({ fromIngredientId: IdSchema, toIngredientId: IdSchema, effect: SubstitutionEffectSchema })
  .meta({ id: 'SubstitutionInput' });
export type SubstitutionInput = z.infer<typeof SubstitutionInputSchema>;

export const ListSubstitutionsResponseSchema = z
  .object({ substitutions: z.array(HouseholdSubstitutionSchema) })
  .meta({ id: 'ListSubstitutionsResponse' });
export type ListSubstitutionsResponse = z.infer<typeof ListSubstitutionsResponseSchema>;

export const BuyNextItemSchema = z
  .object({
    ingredient: IngredientRefSchema,
    unlocks: z.int().min(1),
    recipes: z.array(RecipeRefSchema).max(BUY_NEXT_RECIPES_MAX),
  })
  .meta({ id: 'BuyNextItem' });
export type BuyNextItem = z.infer<typeof BuyNextItemSchema>;

export const BuyNextQuerySchema = z.object({
  limit: queryNumber.int().min(1).max(BUY_NEXT_LIMIT_MAX).optional(),
});
export type BuyNextQuery = z.infer<typeof BuyNextQuerySchema>;

export const GetBuyNextResponseSchema = z
  .object({ items: z.array(BuyNextItemSchema) })
  .meta({ id: 'GetBuyNextResponse' });
export type GetBuyNextResponse = z.infer<typeof GetBuyNextResponseSchema>;

const ShoppingCountSchema = z.int().min(LIMITS.shoppingCount.min).max(LIMITS.shoppingCount.max);

export const ShoppingListItemSchema = z
  .object({
    id: IdSchema,
    ingredient: IngredientRefSchema,
    count: ShoppingCountSchema,
    addedBy: MemberRefSchema.nullable(),
    addedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'ShoppingListItem' });
export type ShoppingListItem = z.infer<typeof ShoppingListItemSchema>;

export const ShoppingListSchema = z
  .object({ items: z.array(ShoppingListItemSchema), updatedAt: IsoDateTimeSchema.nullable() })
  .meta({ id: 'ShoppingList' });
export type ShoppingList = z.infer<typeof ShoppingListSchema>;

export const ShoppingListAddInputSchema = z
  .strictObject({
    items: z
      .array(z.strictObject({ ingredientId: IdSchema, count: ShoppingCountSchema.optional() }))
      .min(1)
      .max(SHOPPING_ADD_ITEMS_MAX),
  })
  .meta({ id: 'ShoppingListAddInput' });
export type ShoppingListAddInput = z.infer<typeof ShoppingListAddInputSchema>;

export const ShoppingListChangeSchema = z
  .object({ added: z.int().min(0), alreadyListed: z.int().min(0), list: ShoppingListSchema })
  .meta({ id: 'ShoppingListChange' });
export type ShoppingListChange = z.infer<typeof ShoppingListChangeSchema>;

export const ShoppingItemPatchSchema = z.strictObject({ count: ShoppingCountSchema }).meta({ id: 'ShoppingItemPatch' });
export type ShoppingItemPatch = z.infer<typeof ShoppingItemPatchSchema>;

export const shoppingRoutes = {
  listSubstitutions: {
    responses: { 200: ListSubstitutionsResponseSchema },
    errors: [],
    summary: 'List household substitutions',
    tag: 'shopping',
  },
  createSubstitution: {
    body: SubstitutionInputSchema,
    responses: { 201: HouseholdSubstitutionSchema },
    errors: ['duplicate_name', 'validation_failed'],
    summary: 'Treat one ingredient as another',
    tag: 'shopping',
  },
  deleteSubstitution: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found'],
    summary: 'Delete a household substitution',
    tag: 'shopping',
  },
  getBuyNext: {
    query: BuyNextQuerySchema,
    responses: { 200: GetBuyNextResponseSchema },
    errors: [],
    summary: 'List the ingredients that unlock the most recipes',
    tag: 'shopping',
  },
  getShoppingList: {
    responses: { 200: ShoppingListSchema },
    errors: [],
    summary: 'Get the shopping list',
    tag: 'shopping',
  },
  addToShoppingList: {
    body: ShoppingListAddInputSchema,
    responses: { 200: ShoppingListChangeSchema },
    errors: ['validation_failed'],
    summary: 'Add ingredients to the shopping list',
    tag: 'shopping',
  },
  updateShoppingItem: {
    params: idParams,
    body: ShoppingItemPatchSchema,
    responses: { 200: ShoppingListSchema },
    errors: ['not_found'],
    summary: 'Change how many of an item to buy',
    tag: 'shopping',
  },
  checkOffShoppingItem: {
    params: idParams,
    responses: { 200: ShoppingListSchema },
    errors: ['not_found'],
    summary: 'Check an item off the shopping list',
    tag: 'shopping',
  },
} as const satisfies Record<keyof typeof shoppingEndpoints, RouteSchema>;
