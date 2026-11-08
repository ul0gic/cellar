import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { personOf } from '../core/person.ts';
import { route } from '../core/route.ts';
import { BUY_NEXT_DEFAULT, buyNextItems } from './buy-next.ts';
import {
  bottleAction,
  bulkBottles,
  createBottles,
  deleteBottle,
  getBottle,
  listBottles,
  updateBottle,
} from './bottles.ts';
import {
  createIngredient,
  deleteIngredient,
  getIngredient,
  getIngredientTree,
  listIngredients,
  setOnHand,
  updateIngredient,
} from './ingredients.ts';
import {
  addIngredientToShoppingList,
  addToShoppingList,
  checkOffShoppingItem,
  createSubstitution,
  deleteSubstitution,
  getShoppingList,
  listSubstitutions,
  updateShoppingItem,
} from './shopping.ts';

export function register(app: FastifyInstance, ctx: AppContext): void {
  route(app, 'getIngredientTree', async () => getIngredientTree(ctx));
  route(app, 'listIngredients', async (request) => listIngredients(ctx, request.query));
  route(app, 'getIngredient', async (request) => getIngredient(ctx, personOf(request), request.params.id));
  route(app, 'createIngredient', async (request) => createIngredient(ctx, personOf(request), request.body));
  route(app, 'updateIngredient', async (request) =>
    updateIngredient(ctx, personOf(request), request.params.id, request.body),
  );
  route(app, 'deleteIngredient', async (request) => deleteIngredient(ctx, request.params.id));
  route(app, 'setOnHand', async (request) => setOnHand(ctx, personOf(request), request.params.id, request.body.marked));
  route(app, 'addIngredientToShoppingList', async (request) =>
    addIngredientToShoppingList(ctx, personOf(request), request.params.id),
  );

  route(app, 'listBottles', async (request) => listBottles(ctx, personOf(request), request.query));
  route(app, 'getBottle', async (request) => getBottle(ctx, request.params.id));
  route(app, 'createBottles', async (request) => createBottles(ctx, personOf(request), request.body));
  route(app, 'updateBottle', async (request) => updateBottle(ctx, request.params.id, request.body));
  route(app, 'deleteBottle', async (request) => deleteBottle(ctx, request.params.id));
  route(app, 'openBottle', async (request) => bottleAction(ctx, request.params.id, 'open', request.body.on));
  route(app, 'finishBottle', async (request) => bottleAction(ctx, request.params.id, 'finish', request.body.on));
  route(app, 'reopenBottle', async (request) => bottleAction(ctx, request.params.id, 'reopen', null));
  route(app, 'bulkBottles', async (request) => bulkBottles(ctx, request.body));

  route(app, 'getBuyNext', async (request) => ({ items: buyNextItems(ctx, request.query.limit ?? BUY_NEXT_DEFAULT) }));
  route(app, 'getShoppingList', async () => getShoppingList(ctx));
  route(app, 'addToShoppingList', async (request) => addToShoppingList(ctx, personOf(request), request.body.items));
  route(app, 'updateShoppingItem', async (request) => updateShoppingItem(ctx, request.params.id, request.body.count));
  route(app, 'checkOffShoppingItem', async (request) => checkOffShoppingItem(ctx, request.params.id));
  route(app, 'listSubstitutions', async () => listSubstitutions(ctx));
  route(app, 'createSubstitution', async (request) => createSubstitution(ctx, personOf(request), request.body));
  route(app, 'deleteSubstitution', async (request) => deleteSubstitution(ctx, request.params.id));
}
