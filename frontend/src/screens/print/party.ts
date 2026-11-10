import type { PartyResult } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { route } from '../../app/controllers/route.ts';
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

export const tag = 'cl-screen-print-party';

type Shown =
  | { readonly kind: 'loading' }
  | { readonly kind: 'message'; readonly body: TemplateResult }
  | { readonly kind: 'ready'; readonly title: string; readonly result: PartyResult };

class PrintParty extends View {
  readonly plan = readPlan(route.query.peek());
  readonly shown = signal<Shown>({ kind: 'loading' });
  private started = false;

  connected(): void {
    if (!this.started) {
      this.started = true;
      this.load().catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        this.shown.value = { kind: 'message', body: html`<p class="cl-printed">${error.detail}</p>` };
      });
    }
  }

  async load(): Promise<void> {
    const { plan } = this;
    let ids = plan.recipeIds;
    let title = text('print.party');
    if (plan.collectionId !== null) {
      const collection = await call('getCollection', { params: { id: plan.collectionId } });
      ids = collection.recipes.map((recipe) => recipe.id);
      title = collection.name;
    }
    if (ids.length === 0) {
      this.shown.value = { kind: 'message', body: html`<p class="cl-printed">${text('print.empty')}</p>` };
      return;
    }
    const result = await call('calculateParty', {
      body: { recipes: ids.map((recipeId) => ({ recipeId, servings: servingsFor(plan, recipeId) })) },
    });
    this.shown.value = { kind: 'ready', title, result };
  }

  sheet(title: string, result: PartyResult): TemplateResult {
    return html`<article class="cl-printed">
      <h1 class="cl-print-title">${title}</h1>
      <p class="cl-print-sub">${servingsLine(result, this.plan.same, this.plan.servings)}</p>
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
              <td>${line.satisfied ? text('print.yes') : line.optionalOnly ? text('print.optional') : text('print.no')}</td>
            </tr>`,
          )}
        </tbody>
      </table>
      ${printedOn()}
    </article>`;
  }

  render() {
    const shown = this.shown.value;
    switch (shown.kind) {
      case 'loading':
        return nothing;
      case 'message':
        return html`${toolbar(`/party${location.search}`)}${shown.body}`;
      case 'ready':
        return html`${toolbar(`/party${location.search}`)}${this.sheet(shown.title, shown.result)}`;
    }
  }
}

View.register(tag, PrintParty);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: PrintParty;
  }
}
