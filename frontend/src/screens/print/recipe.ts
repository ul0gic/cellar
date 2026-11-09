import { formatAbv, formatAmount, type PreferredUnit, type Recipe } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { setScreenTitle } from '../../app/router.ts';
import type { ScreenContext } from '../../app/types.ts';
import { plateForGlass } from '../../design-system/cl-plate.ts';
import { text } from '../../text/index.ts';
import { servingsOf } from '../recipes/parts/servings.ts';
import { printedOn, toolbar } from './parts/frame.ts';

function summary(recipe: Recipe, servings: number): string {
  const parts: string[] = [];
  if (recipe.method !== null && recipe.glass !== null) {
    parts.push(
      `${text('recipes.factMethodGlass', { method: recipe.method.name, glass: recipe.glass.name.toLowerCase() })}.`,
    );
  }
  if (recipe.abv !== null && recipe.volumeMl !== null) {
    parts.push(text('print.abv', { abv: formatAbv(recipe.abv) }));
  }
  parts.push(servings === 1 ? text('print.servingsOne') : text('print.servings', { count: servings }));
  return parts.join(' ');
}

function lines(recipe: Recipe, unit: PreferredUnit, servings: number): TemplateResult {
  return html`<table class="cl-print-table">
    <tbody>
      ${recipe.lines.map((line) => {
        const shown = formatAmount({ amount: line.amount, amountMax: line.amountMax, unit: line.unit }, unit, servings);
        return html`<tr>
          <td class="cl-print-amt">${shown.value}</td>
          <td class="cl-print-unit">${shown.value === '' ? shown.text : shown.unit}</td>
          <td>
            ${line.ingredient.name}${line.note === '' ? nothing : html` <span class="cl-print-muted">${line.note}</span>`}
            ${line.optional ? html` <span class="cl-print-muted">${text('print.optional')}</span>` : nothing}
          </td>
        </tr>`;
      })}
    </tbody>
  </table>`;
}

function details(recipe: Recipe): TemplateResult {
  const rows: [string, string][] = [];
  if (recipe.glass !== null) {
    rows.push([text('recipes.detailGlass'), recipe.glass.name]);
  }
  if (recipe.method !== null) {
    rows.push([text('recipes.detailMethod'), recipe.method.name]);
  }
  if (recipe.garnish !== '') {
    rows.push([text('recipes.detailGarnish'), recipe.garnish]);
  }
  if (recipe.year !== null) {
    rows.push([text('recipes.detailYear'), String(recipe.year)]);
  }
  if (recipe.source !== '') {
    rows.push([text('recipes.detailSource'), recipe.source]);
  }
  return rows.length === 0
    ? html``
    : html`<h2 class="cl-print-heading">${text('print.details')}</h2>
        <dl class="cl-print-details">${rows.map(([term, value]) => html`<dt>${term}</dt><dd>${value}</dd>`)}</dl>`;
}

function page(recipe: Recipe, unit: PreferredUnit, servings: number): TemplateResult {
  const image = recipe.images[0];
  const steps = recipe.instructions
    .split(/\n+/)
    .map((step) => step.trim())
    .filter((step) => step !== '');
  return html`<article class="cl-printed">
    <h1 class="cl-print-title">${recipe.name}</h1>
    <p class="cl-print-sub">${summary(recipe, servings)}</p>
    <div class="cl-print-body">
      <div>
        ${lines(recipe, unit, servings)}
        ${
          steps.length === 0
            ? nothing
            : html`<h2 class="cl-print-heading">${text('print.method')}</h2>
                <ol class="cl-print-steps">${steps.map((step) => html`<li>${step}</li>`)}</ol>`
        }
        ${details(recipe)}
      </div>
      <div class="cl-print-figure">
        ${
          image === undefined
            ? html`<cl-plate kind=${plateForGlass(recipe.glass?.name ?? null)} name=${recipe.name}></cl-plate>`
            : html`<img src=${image.url} alt=${text('photo.of', { name: recipe.name })} />`
        }
      </div>
    </div>
    ${printedOn()}
  </article>`;
}

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('div');
  const id = Number(ctx.params.id);
  const servings = servingsOf(ctx.query.get('servings'));
  const unitParam = ctx.query.get('unit');
  const unit: PreferredUnit =
    unitParam === 'ml' || unitParam === 'oz' ? unitParam : (ctx.person.current()?.person.unit ?? 'oz');
  const back = `/recipes/${ctx.params.id ?? ''}`;
  const show = (body: TemplateResult): void => {
    render(html`${toolbar(back)}${body}`, element);
  };
  call('getRecipe', { params: { id } }).then(
    (recipe) => {
      setScreenTitle(recipe.name);
      show(page(recipe, unit, servings));
    },
    (error: unknown) => {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      show(html`<p class="cl-printed">${error.detail}</p>`);
    },
  );
  return element;
}
