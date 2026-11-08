import type { Id, ShoppingListChange } from '@cellar/contract';
import type { FastifyInstance } from 'fastify';
import type { Person } from '../core/access.ts';
import type { AppContext } from '../core/context.ts';
import { personOf } from '../core/person.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import { missingIngredientIds } from '../shelf/satisfaction.ts';
import { addToShoppingList } from '../shelf/shopping.ts';
import { registerCollections } from './collections.ts';
import { listRecipes } from './list.ts';
import { registerNotes } from './notes.ts';
import { recipePage } from './page.ts';
import { calculateParty } from './party.ts';
import { registerTaxonomy } from './taxonomy.ts';
import { createRecipe, deleteRecipe, replaceRecipe } from './write.ts';

function addMissing(ctx: AppContext, recipeId: Id, person: Person): ShoppingListChange {
  if (ctx.db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipeId) === undefined) {
    throw problem('not_found');
  }
  return addToShoppingList(
    ctx,
    person,
    missingIngredientIds(ctx.db, recipeId).map((ingredientId) => ({ ingredientId })),
  );
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  route(app, 'listRecipes', async (request) => listRecipes(ctx, request.query, personOf(request).id));
  route(app, 'getRecipe', async (request) => recipePage(ctx, request.params.id, personOf(request).id));
  route(app, 'createRecipe', async (request) =>
    recipePage(ctx, createRecipe(ctx, request.body, personOf(request).id), personOf(request).id),
  );
  route(app, 'replaceRecipe', async (request) =>
    recipePage(ctx, replaceRecipe(ctx, request.params.id, request.body), personOf(request).id),
  );
  route(app, 'deleteRecipe', async (request) => deleteRecipe(ctx, request.params.id));
  route(app, 'addMissingToShoppingList', async (request) => addMissing(ctx, request.params.id, personOf(request)));
  route(app, 'calculateParty', async (request) => calculateParty(ctx, request.body));
  registerNotes(app, ctx);
  registerTaxonomy(app, ctx);
  registerCollections(app, ctx);
}
