import { readFile } from 'node:fs/promises';
import { CsvKindSchema } from '@cellar/contract/schemas';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { draftWithAi } from '../ai/draft.ts';
import type { AppContext } from '../core/context.ts';
import { personOf } from '../core/person.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import { readSettings } from '../household/settings.ts';
import { csvTemplate, importCsvText } from './csv.ts';
import { exportBottles, exportFileDate, exportIngredients, exportRecipes, selectRecipeIds } from './exports.ts';
import { importRecipes } from './recipes-json.ts';
import { draftFromText, ingredientMatcher } from './text.ts';
import { fetchPage, schemaOrgDraft, visibleText } from './url.ts';

function attachment(reply: FastifyReply, name: string): void {
  reply.header('Content-Disposition', `attachment; filename="${name}"`);
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) {
      throw problem('unsupported_media_type', { detail: 'Upload a .csv file.' });
    }
    throw error;
  }
}

function aiAvailable(ctx: AppContext, wanted: boolean): boolean {
  return wanted && readSettings(ctx.db).aiKey !== null;
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  route(app, 'getCsvTemplate', (request, reply) => {
    const kind = CsvKindSchema.safeParse(request.params.kind);
    if (!kind.success) {
      throw problem('not_found');
    }
    attachment(reply, `cellar-${kind.data}-template.csv`);
    return Promise.resolve(csvTemplate(kind.data));
  });

  route(app, 'importCsv', async (request) => {
    const { file, kind, mode, duplicate, unmatchedParentId } = request.body;
    const text = decodeUtf8(await readFile(file.path));
    return importCsvText(ctx.db, {
      text,
      kind,
      mode,
      duplicate,
      unmatchedParentId: unmatchedParentId ?? null,
      memberId: personOf(request).id,
      currency: readSettings(ctx.db).currency,
      now: ctx.now().toISOString(),
    });
  });

  route(app, 'importRecipes', (request) => {
    const { file, mode, duplicate, unmatchedParentId, fetchRemoteImages } = request.body;
    return importRecipes(ctx, {
      file,
      mode,
      duplicate,
      unmatchedParentId,
      fetchRemoteImages,
      memberId: personOf(request).id,
    });
  });

  route(app, 'importFromUrl', async (request) => {
    const page = await fetchPage(ctx, request.body.url);
    const draft = schemaOrgDraft(ctx, page);
    if (draft !== null) {
      return draft;
    }
    if (aiAvailable(ctx, request.body.useAi)) {
      return draftWithAi(ctx, visibleText(page.html), page.url.href);
    }
    throw problem('no_recipe_data');
  });

  route(app, 'importFromText', (request) => {
    if (aiAvailable(ctx, request.body.useAi)) {
      return draftWithAi(ctx, request.body.text, null);
    }
    return Promise.resolve(draftFromText(ingredientMatcher(ctx.db), request.body.text));
  });

  route(app, 'exportBottles', (request, reply) => {
    attachment(reply, `cellar-bottles-${exportFileDate(ctx.now())}.csv`);
    return Promise.resolve(exportBottles(ctx, request.query.status));
  });

  route(app, 'exportIngredients', (request, reply) => {
    attachment(reply, `cellar-ingredients-${exportFileDate(ctx.now())}.csv`);
    return Promise.resolve(exportIngredients(ctx, request.query.provenance));
  });

  route(app, 'exportRecipes', (request, reply) => {
    const ids = selectRecipeIds(ctx.db, request.query.provenance, request.query.id);
    attachment(reply, `cellar-recipes-${exportFileDate(ctx.now())}.zip`);
    return Promise.resolve(exportRecipes(ctx, ids));
  });
}
