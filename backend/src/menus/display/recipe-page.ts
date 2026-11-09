import { type AmountInput, formatAmount, type PreferredUnit } from '@cellar/contract';
import { escapeHtml, renderDocument } from './html.ts';

export interface DisplayRecipeLine extends AmountInput {
  readonly ingredientName: string;
  readonly optional: boolean;
}

export interface DisplayRecipe {
  readonly name: string;
  readonly image: { readonly url: string; readonly width: number | null; readonly height: number | null } | null;
  readonly lines: readonly DisplayRecipeLine[];
  readonly instructions: string;
  readonly garnish: string;
  readonly glass: string | null;
}

export interface RecipePageContext {
  readonly assetBase: string;
  readonly assetVersion: string;
  readonly menuPath: string;
  readonly displayUnit: PreferredUnit;
}

function renderLine(line: DisplayRecipeLine, unit: PreferredUnit): string {
  const amount = formatAmount(line, unit).text;
  const label = `${escapeHtml(line.ingredientName)}${line.optional ? ' (optional)' : ''}`;
  return amount === '' ? `<li>${label}</li>` : `<li><span class="amt">${escapeHtml(amount)}</span> ${label}</li>`;
}

function renderMeta(recipe: DisplayRecipe): string {
  const sentences = [
    recipe.garnish === '' ? null : `Garnish: ${recipe.garnish.replace(/\.+$/, '')}.`,
    recipe.glass === null ? null : `Glass: ${recipe.glass}.`,
  ].filter((sentence) => sentence !== null);
  return sentences.length === 0 ? '' : `<p class="meta">${escapeHtml(sentences.join(' '))}</p>`;
}

function renderHero(recipe: DisplayRecipe): string {
  if (recipe.image === null) {
    return '';
  }
  const size =
    recipe.image.width === null || recipe.image.height === null
      ? ''
      : ` width="${recipe.image.width}" height="${recipe.image.height}"`;
  return `<img class="hero" src="${escapeHtml(recipe.image.url)}"${size} alt="${escapeHtml(recipe.name)}">`;
}

export function renderRecipePage(recipe: DisplayRecipe, context: RecipePageContext): string {
  const steps = recipe.instructions
    .split(/\r?\n/)
    .map((step) => step.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((step) => step !== '')
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join('');
  const hero = renderHero(recipe);
  const text = [
    `<ul class="lines">${recipe.lines.map((line) => renderLine(line, context.displayUnit)).join('')}</ul>`,
    steps === '' ? '' : `<ol class="steps">${steps}</ol>`,
    renderMeta(recipe),
  ].join('');
  const main = [
    `<a class="back" href="${context.menuPath}">Back to the menu</a>`,
    `<h1>${escapeHtml(recipe.name)}</h1>`,
    `<div class="recipe-body">${hero === '' ? '' : `<div class="recipe-photo">${hero}</div>`}<div class="recipe-text">${text}</div></div>`,
  ].join('');
  return renderDocument({
    title: recipe.name,
    assetBase: context.assetBase,
    version: context.assetVersion,
    refresh: false,
    bodyAttributes: ' class="recipe"',
    main,
    script: false,
  });
}
