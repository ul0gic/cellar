import type { PartyResult } from '@cellar/contract';
import { html, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import type { ScreenContext } from '../../app/types.ts';
import { text } from '../../text/index.ts';
import { countsText, mlText, ozText, readPlan, servingsFor } from '../party/parts/party-state.ts';
import { printedOn, toolbar } from './parts/frame.ts';

function servingsLine(result: PartyResult, same: boolean, servings: number): string {
  return same
    ? text('print.servingsOfEach', { count: servings })
    : text('print.servingsEach', {
        list: result.recipes.map((item) => `${item.recipe.name} ${item.servings}`).join(', '),
      });
}

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('div');
  const plan = readPlan(ctx.query);
  const show = (body: TemplateResult): void => {
    render(html`${toolbar(`/party${location.search}`)}${body}`, element);
  };
  const load = async (): Promise<void> => {
    let ids = plan.recipeIds;
    let title = text('print.party');
    if (plan.collectionId !== null) {
      const collection = await call('getCollection', { params: { id: plan.collectionId } });
      ids = collection.recipes.map((recipe) => recipe.id);
      title = collection.name;
    }
    if (ids.length === 0) {
      show(html`<p class="cl-printed">${text('print.empty')}</p>`);
      return;
    }
    const result = await call('calculateParty', {
      body: { recipes: ids.map((recipeId) => ({ recipeId, servings: servingsFor(plan, recipeId) })) },
    });
    show(html`<article class="cl-printed">
      <h1 class="cl-print-title">${title}</h1>
      <p class="cl-print-sub">${servingsLine(result, plan.same, plan.servings)}</p>
      <table class="cl-print-table">
        <thead>
          <tr>
            <th scope="col">${text('print.ingredient')}</th>
            <th scope="col" class="cl-print-num">ml</th>
            <th scope="col" class="cl-print-num">oz</th>
            <th scope="col">${text('print.have')}</th>
          </tr>
        </thead>
        <tbody>
          ${result.lines.map(
            (line) => html`<tr>
              <th scope="row">${line.ingredient.name}</th>
              ${
                line.volumeMl === null
                  ? html`<td colspan="2">${countsText(line)}</td>`
                  : html`<td class="cl-print-num">${mlText(line)}</td><td class="cl-print-num">${ozText(line)}</td>`
              }
              <td>${line.satisfied ? text('print.yes') : text('print.no')}</td>
            </tr>`,
          )}
        </tbody>
      </table>
      ${printedOn()}
    </article>`);
  };
  load().catch((error: unknown) => {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    show(html`<p class="cl-printed">${error.detail}</p>`);
  });
  return element;
}
