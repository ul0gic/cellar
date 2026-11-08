import { z } from 'zod';
import { LIMITS } from './limits.ts';
import { IdSchema, IngredientRefSchema, IsoDateTimeSchema, idParams, MemberRefSchema } from './primitives.ts';
import type { RouteSchema } from './routes.ts';
import type { wishlistsEndpoints } from './wishlists-endpoints.ts';

const wishlistUrlSchema = z.url({ protocol: /^https?$/ }).max(LIMITS.url.max);

export const WishlistItemSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    ingredient: IngredientRefSchema.nullable(),
    note: z.string(),
    url: z.string().nullable(),
    position: z.int().min(0),
    createdAt: IsoDateTimeSchema,
  })
  .meta({ id: 'WishlistItem' });
export type WishlistItem = z.infer<typeof WishlistItemSchema>;

export const WishlistSchema = z
  .object({ person: MemberRefSchema, mine: z.boolean(), items: z.array(WishlistItemSchema) })
  .meta({ id: 'Wishlist' });
export type Wishlist = z.infer<typeof WishlistSchema>;

const wishlistItemFields = {
  name: z.string().min(1).max(LIMITS.name.max),
  ingredientId: IdSchema.nullable(),
  note: z.string().max(LIMITS.wishlistNote.max),
  url: wishlistUrlSchema.nullable(),
};

export const WishlistItemInputSchema = z.strictObject(wishlistItemFields).meta({ id: 'WishlistItemInput' });
export type WishlistItemInput = z.infer<typeof WishlistItemInputSchema>;

export const WishlistItemPatchSchema = z.strictObject(wishlistItemFields).partial().meta({ id: 'WishlistItemPatch' });
export type WishlistItemPatch = z.infer<typeof WishlistItemPatchSchema>;

export const WishlistOrderInputSchema = z
  .strictObject({ ids: z.array(IdSchema).max(LIMITS.wishlistItems.max) })
  .meta({ id: 'WishlistOrderInput' });
export type WishlistOrderInput = z.infer<typeof WishlistOrderInputSchema>;

export const GotItResultSchema = z
  .object({ bottleDraft: z.object({ name: z.string(), ingredientId: IdSchema.nullable() }) })
  .meta({ id: 'GotItResult' });
export type GotItResult = z.infer<typeof GotItResultSchema>;

export const ListWishlistsResponseSchema = z
  .object({ lists: z.array(WishlistSchema) })
  .meta({ id: 'ListWishlistsResponse' });
export type ListWishlistsResponse = z.infer<typeof ListWishlistsResponseSchema>;

export const wishlistsRoutes = {
  listWishlists: {
    responses: { 200: ListWishlistsResponseSchema },
    errors: [],
    summary: "List every person's wishlist, the caller's first",
    tag: 'wishlists',
  },
  addWishlistItem: {
    body: WishlistItemInputSchema,
    responses: { 201: WishlistItemSchema },
    errors: ['validation_failed'],
    summary: "Add an item to the caller's wishlist",
    tag: 'wishlists',
  },
  updateWishlistItem: {
    params: idParams,
    body: WishlistItemPatchSchema,
    responses: { 200: WishlistItemSchema },
    errors: ['not_found', 'not_owner'],
    summary: 'Change a wishlist item',
    tag: 'wishlists',
  },
  removeWishlistItem: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found', 'not_owner'],
    summary: 'Remove a wishlist item',
    tag: 'wishlists',
  },
  reorderWishlist: {
    body: WishlistOrderInputSchema,
    responses: { 200: WishlistSchema },
    errors: ['validation_failed'],
    summary: "Reorder the caller's wishlist",
    tag: 'wishlists',
  },
  gotWishlistItem: {
    params: idParams,
    responses: { 200: GotItResultSchema },
    errors: ['not_found', 'not_owner'],
    summary: 'Mark a wishlist item as bought',
    tag: 'wishlists',
  },
} as const satisfies Record<keyof typeof wishlistsEndpoints, RouteSchema>;
