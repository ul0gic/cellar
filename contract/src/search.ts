import { z } from 'zod';
import { BottleStatusSchema } from './bottles.ts';
import { LIMITS } from './limits.ts';
import { IdSchema, ImageRefSchema, queryNumber, TaxonRefSchema } from './primitives.ts';
import type { RouteSchema } from './routes.ts';
import type { searchEndpoints } from './search-endpoints.ts';

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(LIMITS.searchQuery.max),
  limit: queryNumber.int().min(1).max(LIMITS.searchPerGroup.max).optional(),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const RecipeHitSchema = z
  .object({ id: IdSchema, name: z.string(), image: ImageRefSchema.nullable(), canMake: z.boolean() })
  .meta({ id: 'RecipeHit' });
export type RecipeHit = z.infer<typeof RecipeHitSchema>;

export const IngredientHitSchema = z
  .object({ id: IdSchema, name: z.string(), parent: TaxonRefSchema.nullable(), onHand: z.boolean() })
  .meta({ id: 'IngredientHit' });
export type IngredientHit = z.infer<typeof IngredientHitSchema>;

export const BottleHitSchema = z
  .object({ id: IdSchema, name: z.string(), ingredient: TaxonRefSchema, status: BottleStatusSchema })
  .meta({ id: 'BottleHit' });
export type BottleHit = z.infer<typeof BottleHitSchema>;

function searchGroupSchema<T extends z.ZodType>(item: T) {
  return z.object({ total: z.int().min(0), items: z.array(item) });
}
export type SearchGroup<T> = z.infer<ReturnType<typeof searchGroupSchema<z.ZodType<T>>>>;

export const SearchResultSchema = z
  .object({
    query: z.string(),
    correctedQuery: z.string().nullable(),
    recipes: searchGroupSchema(RecipeHitSchema),
    ingredients: searchGroupSchema(IngredientHitSchema),
    bottles: searchGroupSchema(BottleHitSchema),
  })
  .meta({ id: 'SearchResult' });
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const searchRoutes = {
  search: {
    query: SearchQuerySchema,
    responses: { 200: SearchResultSchema },
    errors: [],
    summary: 'Search recipes, ingredients and bottles',
    tag: 'search',
  },
} as const satisfies Record<keyof typeof searchEndpoints, RouteSchema>;
