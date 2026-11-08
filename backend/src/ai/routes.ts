import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { personOf } from '../core/person.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import { generateImage, requireAiKey, respondText } from './client.ts';
import { draftWithAi } from './draft.ts';

const HISTORY_MAX = 2000;
const HISTORY_INSTRUCTIONS =
  'Write a short, factual history of this cocktail in plain text: where and when it is believed to come from and how it changed. At most 120 words. If its history is unknown, say so briefly.';

interface NamedRecord {
  readonly name: string;
  readonly description: string;
}

function namedRecord(ctx: AppContext, table: 'recipes' | 'ingredients', id: number): NamedRecord {
  const row = ctx.db.prepare(`SELECT name, description FROM ${table} WHERE id = ?`).get(id);
  if (row === undefined || typeof row.name !== 'string') {
    throw problem('not_found');
  }
  return { name: row.name, description: typeof row.description === 'string' ? row.description : '' };
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  route(app, 'aiDraftRecipe', (request) => draftWithAi(ctx, request.body.text, null));

  route(app, 'aiGenerateImage', async (request) => {
    requireAiKey(ctx);
    const { target, prompt } = request.body;
    const record = namedRecord(ctx, target.type === 'recipe' ? 'recipes' : 'ingredients', target.id);
    const subject =
      target.type === 'recipe'
        ? `A photograph of the cocktail "${record.name}" in its glass, on a bar top, soft light.`
        : `A product photograph of "${record.name}" on a plain light background.`;
    const text = prompt.trim() === '' ? `${subject} ${record.description}`.trim() : prompt;
    const bytes = await generateImage(ctx, text, target.type);
    const row = await ctx.media.storeFetched(bytes, target.type, personOf(request).id);
    return ctx.media.imageRef(row, ctx.settings.basePath);
  });

  route(app, 'aiDrinkHistory', async (request) => {
    requireAiKey(ctx);
    const recipe = namedRecord(ctx, 'recipes', request.body.recipeId);
    const text = await respondText(ctx, HISTORY_INSTRUCTIONS, `${recipe.name}\n${recipe.description}`);
    return { text: text.trim().slice(0, HISTORY_MAX) };
  });
}
