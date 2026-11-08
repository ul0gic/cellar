import { canonicalUnit, type DraftLine, LIMITS, type RecipeDraft } from '@cellar/contract';
import { z } from 'zod';
import type { AppContext } from '../core/context.ts';
import { problem } from '../core/problems.ts';
import { emptyDraftRecipe, ingredientMatcher } from '../import-export/text.ts';
import { respondJson } from './client.ts';

const INSTRUCTIONS =
  'Read the cocktail recipe in the text. Return its name, a short description, the garnish, the method steps as instructions (one step per line), and each ingredient line with its amount as a number (null when none), its unit as written (null when none) and the ingredient name. Use empty strings for missing text. Never invent ingredients.';

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'garnish', 'instructions', 'lines'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    garnish: { type: 'string' },
    instructions: { type: 'string' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['amount', 'unit', 'ingredient'],
        properties: {
          amount: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          ingredient: { type: 'string' },
        },
      },
    },
  },
} as const;

const DraftAnswerSchema = z.object({
  name: z.string(),
  description: z.string(),
  garnish: z.string(),
  instructions: z.string(),
  lines: z.array(z.object({ amount: z.number().nullable(), unit: z.string().nullable(), ingredient: z.string() })),
});

export async function draftWithAi(ctx: AppContext, text: string, sourceUrl: string | null): Promise<RecipeDraft> {
  const answer = DraftAnswerSchema.safeParse(await respondJson(ctx, INSTRUCTIONS, text, 'recipe_draft', DRAFT_SCHEMA));
  if (!answer.success) {
    throw problem('ai_provider_error', {
      detail: 'The AI service said: the answer was not a recipe.',
      providerMessage: 'the answer was not a recipe',
    });
  }
  const matcher = ingredientMatcher(ctx.db);
  const lines: DraftLine[] = answer.data.lines.slice(0, LIMITS.recipeLines.max).map((line) => {
    const ingredientId = matcher.match(line.ingredient);
    const amount = line.amount !== null && line.amount > 0 && line.amount <= LIMITS.amount.max ? line.amount : null;
    return {
      ingredientId,
      ingredientText: [line.amount ?? '', line.unit ?? '', line.ingredient].join(' ').replace(/\s+/g, ' ').trim(),
      matched: ingredientId !== null,
      amount,
      amountMax: null,
      unit: line.unit === null ? null : canonicalUnit(line.unit),
      optional: false,
      specified: false,
      note: '',
      substitutes: [],
    };
  });
  return {
    source: 'ai',
    sourceUrl,
    recipe: {
      ...emptyDraftRecipe(answer.data.name.trim()),
      description: answer.data.description.slice(0, LIMITS.description.max),
      garnish: answer.data.garnish.slice(0, LIMITS.garnish.max),
      instructions: answer.data.instructions.slice(0, LIMITS.instructions.max),
      source: (sourceUrl ?? '').slice(0, LIMITS.source.max),
      lines,
    },
    imageUrl: null,
  };
}
