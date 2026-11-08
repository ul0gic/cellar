import { z } from 'zod';
import type { aiEndpoints } from './ai-endpoints.ts';
import { RecipeDraftSchema } from './import.ts';
import { LIMITS } from './limits.ts';
import { IdSchema, ImageRefSchema, TargetSchema } from './primitives.ts';
import type { RouteSchema } from './routes.ts';

const AI_HISTORY_MAX = 2000;

export const AiRecipeInputSchema = z
  .strictObject({ text: z.string().min(1).max(LIMITS.aiText.max) })
  .meta({ id: 'AiRecipeInput' });
export type AiRecipeInput = z.infer<typeof AiRecipeInputSchema>;

export const AiImageInputSchema = z
  .strictObject({ target: TargetSchema, prompt: z.string().max(LIMITS.aiPrompt.max) })
  .meta({ id: 'AiImageInput' });
export type AiImageInput = z.infer<typeof AiImageInputSchema>;

export const AiHistoryInputSchema = z.strictObject({ recipeId: IdSchema }).meta({ id: 'AiHistoryInput' });
export type AiHistoryInput = z.infer<typeof AiHistoryInputSchema>;

export const AiHistorySchema = z.object({ text: z.string().max(AI_HISTORY_MAX) }).meta({ id: 'AiHistory' });
export type AiHistory = z.infer<typeof AiHistorySchema>;

export const aiRoutes = {
  aiDraftRecipe: {
    body: AiRecipeInputSchema,
    responses: { 200: RecipeDraftSchema },
    errors: ['ai_not_configured', 'ai_provider_error', 'ai_timeout'],
    summary: 'Draft a recipe from text with AI',
    tag: 'ai',
  },
  aiGenerateImage: {
    body: AiImageInputSchema,
    responses: { 201: ImageRefSchema },
    errors: ['not_found', 'ai_not_configured', 'ai_provider_error', 'ai_timeout', 'payload_too_large'],
    summary: 'Generate an unattached image for a recipe or ingredient',
    tag: 'ai',
  },
  aiDrinkHistory: {
    body: AiHistoryInputSchema,
    responses: { 200: AiHistorySchema },
    errors: ['not_found', 'ai_not_configured', 'ai_provider_error', 'ai_timeout'],
    summary: "Write a short history of a recipe's drink with AI",
    tag: 'ai',
  },
} as const satisfies Record<keyof typeof aiEndpoints, RouteSchema>;
