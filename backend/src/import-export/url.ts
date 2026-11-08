import { LIMITS, type RecipeDraft } from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import { OutboundError } from '../core/outbound.ts';
import { problem } from '../core/problems.ts';
import { emptyDraftRecipe, type IngredientMatcher, ingredientLine, ingredientMatcher } from './text.ts';

const PAGE_MAX_BYTES = 5 * 2 ** 20;
const PAGE_TIMEOUT_MS = 15_000;

interface SchemaRecipe {
  readonly name: string;
  readonly description: string;
  readonly ingredients: readonly string[];
  readonly instructions: readonly string[];
  readonly image: string | null;
}

export interface FetchedPage {
  readonly url: URL;
  readonly html: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&');
}

function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(value: unknown): string {
  if (typeof value === 'string') {
    return plainText(value);
  }
  if (Array.isArray(value)) {
    return value.map(textOf).join(' ').trim();
  }
  return isRecord(value) && typeof value.text === 'string' ? plainText(value.text) : '';
}

function stepsOf(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map(plainText)
      .filter((step) => step !== '');
  }
  if (Array.isArray(value)) {
    return value.flatMap(stepsOf);
  }
  if (isRecord(value)) {
    if (Array.isArray(value.itemListElement)) {
      return stepsOf(value.itemListElement);
    }
    const text = textOf(value);
    return text === '' ? [] : [text];
  }
  return [];
}

function imageOf(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return imageOf(value[0]);
  }
  return isRecord(value) && typeof value.url === 'string' ? value.url : null;
}

function isRecipeType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some((type) => typeof type === 'string' && /(^|[/:])Recipe$/.test(type));
}

function findRecipe(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipe(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  if (isRecipeType(value['@type'])) {
    return value;
  }
  return findRecipe(value['@graph']);
}

function fromJsonLd(html: string): SchemaRecipe | null {
  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      if (error instanceof SyntaxError) {
        continue;
      }
      throw error;
    }
    const recipe = findRecipe(parsed);
    if (recipe !== null) {
      const ingredients = recipe.recipeIngredient ?? recipe.ingredients;
      return {
        name: textOf(recipe.name),
        description: textOf(recipe.description),
        ingredients: Array.isArray(ingredients) ? ingredients.map(textOf).filter((line) => line !== '') : [],
        instructions: stepsOf(recipe.recipeInstructions),
        image: imageOf(recipe.image),
      };
    }
  }
  return null;
}

function itemprops(scope: string, name: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`<(\\w+)\\b[^>]*\\bitemprop\\s*=\\s*["'][^"']*\\b${name}\\b[^"']*["'][^>]*>`, 'gi');
  for (const match of scope.matchAll(pattern)) {
    const tag = match[0];
    const content = /\b(?:content|src|href)\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (content !== null) {
      values.push(decodeEntities(content[1]).trim());
      continue;
    }
    const start = (match.index ?? 0) + tag.length;
    const end = scope.indexOf(`</${match[1]}`, start);
    values.push(plainText(scope.slice(start, end === -1 ? undefined : end)));
  }
  return values.filter((value) => value !== '');
}

function fromMicrodata(html: string): SchemaRecipe | null {
  const start = html.search(/itemtype\s*=\s*["']https?:\/\/schema\.org\/Recipe["']/i);
  if (start === -1) {
    return null;
  }
  const scope = html.slice(start);
  const ingredients = itemprops(scope, 'recipeIngredient');
  return {
    name: itemprops(scope, 'name')[0] ?? '',
    description: itemprops(scope, 'description')[0] ?? '',
    ingredients: ingredients.length > 0 ? ingredients : itemprops(scope, 'ingredients'),
    instructions: itemprops(scope, 'recipeInstructions'),
    image: itemprops(scope, 'image')[0] ?? null,
  };
}

function withoutUserinfo(url: URL): URL {
  const stripped = new URL(url.href);
  stripped.username = '';
  stripped.password = '';
  return stripped;
}

export async function fetchPage(ctx: AppContext, raw: string): Promise<FetchedPage> {
  const parsed = URL.parse(raw.trim());
  if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw problem('url_not_allowed');
  }
  const url = withoutUserinfo(parsed);
  try {
    const response = await ctx.outbound.fetch(url.href, {
      maxBytes: PAGE_MAX_BYTES,
      timeoutMs: PAGE_TIMEOUT_MS,
      accept: 'text/html,application/xhtml+xml',
    });
    return { url: withoutUserinfo(response.finalUrl), html: Buffer.from(response.body).toString('utf8') };
  } catch (error) {
    if (!(error instanceof OutboundError)) {
      ctx.log.info('URL import fetch failed.', { err: error });
      throw problem('fetch_failed', { detail: "That page couldn't be reached." });
    }
    switch (error.case) {
      case 'scheme_refused':
      case 'address_refused':
        throw problem('url_not_allowed');
      case 'too_large':
        throw problem('page_too_large');
      case 'timed_out':
        throw problem('fetch_timeout');
      case 'upstream_status':
        throw problem('fetch_failed', {
          detail: `That page answered with an error (${error.upstreamStatus}).`,
          ...(error.upstreamStatus === null ? {} : { upstreamStatus: error.upstreamStatus }),
        });
      case 'too_many_redirects':
        throw problem('fetch_failed', { detail: 'That page redirected too many times.' });
    }
  }
}

export function visibleText(html: string): string {
  const body = html.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ');
  return plainText(body).slice(0, LIMITS.aiText.max);
}

function draftOf(matcher: IngredientMatcher, recipe: SchemaRecipe, page: URL): RecipeDraft {
  const image = recipe.image === null ? null : URL.parse(recipe.image, page);
  return {
    source: 'schema_org',
    sourceUrl: page.href,
    recipe: {
      ...emptyDraftRecipe(recipe.name),
      description: recipe.description.slice(0, LIMITS.description.max),
      instructions: recipe.instructions.join('\n').slice(0, LIMITS.instructions.max),
      source: page.href.slice(0, LIMITS.source.max),
      lines: recipe.ingredients.slice(0, LIMITS.recipeLines.max).map((line) => ingredientLine(matcher, line)),
    },
    imageUrl:
      image === null || (image.protocol !== 'http:' && image.protocol !== 'https:')
        ? null
        : withoutUserinfo(image).href,
  };
}

export function schemaOrgDraft(ctx: AppContext, page: FetchedPage): RecipeDraft | null {
  const recipe = fromJsonLd(page.html) ?? fromMicrodata(page.html);
  if (recipe === null || (recipe.name === '' && recipe.ingredients.length === 0)) {
    return null;
  }
  return draftOf(ingredientMatcher(ctx.db), recipe, page.url);
}
