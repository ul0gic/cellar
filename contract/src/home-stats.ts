import { z } from 'zod';
import type { homeStatsEndpoints } from './home-stats-endpoints.ts';
import { NoteSchema } from './notes.ts';
import {
  HouseholdRatingSchema,
  IdSchema,
  IngredientRefSchema,
  IsoDateSchema,
  RecipeRefSchema,
  TargetSchema,
  TaxonRefSchema,
} from './primitives.ts';
import { RecipeSummarySchema } from './recipes.ts';
import type { RouteSchema } from './routes.ts';
import { BuyNextItemSchema } from './shopping.ts';

const HOME_BUY_NEXT_MAX = 3;
const HOME_RECENT_RECIPES_MAX = 8;
const HOME_SHOPPING_PREVIEW_MAX = 5;
const STATS_TOP_MAX = 5;

const countSchema = z.int().min(0);

export const HomeSchema = z
  .object({
    canMake: z.object({ count: countSchema, total: countSchema }),
    buyNext: z.array(BuyNextItemSchema).max(HOME_BUY_NEXT_MAX),
    recentRecipes: z.array(RecipeSummarySchema).max(HOME_RECENT_RECIPES_MAX),
    liveMenu: z.object({ id: IdSchema, name: z.string(), date: IsoDateSchema, itemCount: countSchema }).nullable(),
    shoppingList: z.object({
      count: countSchema,
      preview: z.array(IngredientRefSchema).max(HOME_SHOPPING_PREVIEW_MAX),
    }),
    wishlistCount: countSchema,
  })
  .meta({ id: 'Home' });
export type Home = z.infer<typeof HomeSchema>;

export const CoverageSchema = z.object({ known: countSchema, of: countSchema }).meta({ id: 'Coverage' });
export type Coverage = z.infer<typeof CoverageSchema>;

export const StatsSchema = z
  .object({
    shelf: z.object({
      bottles: countSchema,
      sealed: countSchema,
      open: countSchema,
      byRoot: z.array(z.object({ root: TaxonRefSchema, bottles: countSchema })),
    }),
    recipes: z.object({ canMake: countSchema, total: countSchema, percent: z.number().min(0).max(100) }),
    buyNext: z.array(BuyNextItemSchema).max(STATS_TOP_MAX),
    topRated: z
      .array(z.object({ target: TargetSchema, name: z.string(), rating: HouseholdRatingSchema }))
      .max(STATS_TOP_MAX),
    recentTastings: z.array(z.object({ note: NoteSchema, targetName: z.string() })).max(STATS_TOP_MAX),
    finishedByYear: z.array(z.object({ year: z.int(), bottles: countSchema })),
    mostMade: z.array(z.object({ recipe: RecipeRefSchema, count: countSchema })).max(STATS_TOP_MAX),
    lists: z.object({ wishlistItems: countSchema, shoppingListItems: countSchema }),
    prices: z
      .object({
        barValueMinor: countSchema,
        barValueCoverage: CoverageSchema,
        spendByYear: z.array(z.object({ year: z.int(), spentMinor: countSchema, coverage: CoverageSchema })),
      })
      .optional(),
  })
  .meta({ id: 'Stats' });
export type Stats = z.infer<typeof StatsSchema>;

export const homeStatsRoutes = {
  getHome: {
    responses: { 200: HomeSchema },
    errors: [],
    summary: 'Get the home screen summary',
    tag: 'home-stats',
  },
  getStats: {
    responses: { 200: StatsSchema },
    errors: [],
    summary: 'Get household stats',
    tag: 'home-stats',
  },
} as const satisfies Record<keyof typeof homeStatsEndpoints, RouteSchema>;
