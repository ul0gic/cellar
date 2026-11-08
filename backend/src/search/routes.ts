import { LIMITS, type SearchResult } from '@cellar/contract';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { route } from '../core/route.ts';
import { onHandIngredientIds, recipeOutcomes } from '../shelf/satisfaction.ts';
import { searchAll } from './engine.ts';

export function register(app: FastifyInstance, ctx: AppContext): void {
  const search = (q: string, limit: number): SearchResult => {
    const matches = searchAll(ctx.db, q, limit);
    const recipeIds = matches.recipes.items.map((hit) => hit.id);
    const outcomes = recipeIds.length === 0 ? null : recipeOutcomes(ctx.db, { recipeIds });
    const onHand = matches.ingredients.items.length === 0 ? null : onHandIngredientIds(ctx.db);
    return {
      ...matches,
      recipes: {
        total: matches.recipes.total,
        items: matches.recipes.items.map((hit) => ({
          id: hit.id,
          name: hit.name,
          image: hit.image === null ? null : ctx.media.imageRef(hit.image, ctx.settings.basePath),
          canMake: outcomes?.get(hit.id)?.canMake === true,
        })),
      },
      ingredients: {
        total: matches.ingredients.total,
        items: matches.ingredients.items.map((hit) => ({ ...hit, onHand: onHand?.has(hit.id) === true })),
      },
    };
  };

  route(app, 'search', async (request) =>
    search(request.query.q, request.query.limit ?? LIMITS.searchPerGroup.default),
  );
}
