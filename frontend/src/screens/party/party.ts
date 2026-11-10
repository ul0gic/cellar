import type { PartyLine, PartyResult } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal, untracked } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { route } from '../../app/controllers/route.ts';
import { eventChecked, eventNumber } from '../../app/events.ts';
import { actionFailed } from '../../app/problems.ts';
import { SKELETON_DELAY_MS, dataChanged } from '../../app/resources.ts';
import { href, navigate, setQuery } from '../../app/router.ts';
import '../../design-system/cl-bulb.ts';
import '../../design-system/cl-figure.ts';
import { illustration } from '../../design-system/illustration.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/empty-state.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/number-input.ts';
import '../../design-system/lc/switch.ts';
import { loadFailed } from '../../design-system/load-view.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { toast } from '../../design-system/toast.ts';
import { formatCount } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { openSheet } from '../recipes/parts/sheet.ts';
import { undoAdded } from '../recipes/parts/shopping-undo.ts';
import {
  countsText,
  mlText,
  ozText,
  PARTY_SERVINGS_MAX,
  type PartyPlan,
  readPlan,
  servingsFor,
} from './parts/party-state.ts';
import './party.css';

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly from: string | null; readonly plan: PartyPlan; readonly result: PartyResult };

function lineStatus(line: PartyLine): TemplateResult {
  if (line.satisfied) {
    return html`<span class="cl-party-status">
      <cl-bulb size="mini" status="on" aria-hidden="true"></cl-bulb>${text('party.onHand')}
    </span>`;
  }
  if (line.optionalOnly) {
    return html`<span class="cl-party-status">
      <cl-bulb size="mini" status="optional" aria-hidden="true"></cl-bulb>${text('party.optional')}
    </span>`;
  }
  return html`<span class="cl-party-status is-missing">
    <cl-bulb size="mini" status="off" aria-hidden="true"></cl-bulb>${text('party.missing')}
  </span>`;
}

export const tag = 'cl-screen-party-party';

class Party extends View {
  readonly loaded = signal<Loaded>({ kind: 'loading' });
  readonly slow = signal(false);
  private run = 0;
  private computedFor: string | null = null;

  connected(): void {
    this.classList.add('cl-party', 'cl-reading');
    const timer = setTimeout(() => {
      this.slow.value = true;
    }, SKELETON_DELAY_MS);
    this.$own(() => clearTimeout(timer));
    const follow = effect(() => {
      const query = route.query.value;
      untracked(() => {
        const key = query.toString();
        if (key !== this.computedFor) {
          this.computedFor = key;
          void this.compute(readPlan(query));
        }
      });
    });
    this.$own(() => follow.dispose());
  }

  async recipeIds(plan: PartyPlan): Promise<{ ids: readonly number[]; from: string | null }> {
    if (plan.collectionId !== null) {
      const collection = await call('getCollection', { params: { id: plan.collectionId } });
      return { ids: collection.recipes.map((recipe) => recipe.id), from: collection.name };
    }
    return { ids: plan.recipeIds, from: null };
  }

  async compute(plan: PartyPlan): Promise<void> {
    const current = ++this.run;
    let next: Loaded;
    try {
      const { ids, from } = await this.recipeIds(plan);
      if (ids.length === 0) {
        next = { kind: 'empty' };
      } else {
        const result = await call('calculateParty', {
          body: { recipes: ids.map((recipeId) => ({ recipeId, servings: servingsFor(plan, recipeId) })) },
        });
        next = { kind: 'ready', from, plan, result };
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      next = error.code === 'not_found' ? { kind: 'empty' } : { kind: 'failed' };
    }
    if (current === this.run) {
      this.loaded.value = next;
    }
  }

  retry(): void {
    void this.compute(readPlan(route.query.peek()));
  }

  setSame(same: boolean, result: PartyResult): void {
    const plan = readPlan(route.query.peek());
    setQuery(
      same
        ? { each: null }
        : { each: result.recipes.map((item) => `${item.recipe.id}:${servingsFor(plan, item.recipe.id)}`).join(',') },
      'replace',
    );
  }

  setServings(recipeId: number | null, servings: number, result: PartyResult): void {
    const plan = readPlan(route.query.peek());
    if (recipeId === null) {
      setQuery({ servings: String(servings) }, 'replace');
      return;
    }
    const each = result.recipes.map(
      (item) => `${item.recipe.id}:${item.recipe.id === recipeId ? servings : servingsFor(plan, item.recipe.id)}`,
    );
    setQuery({ each: each.join(',') }, 'replace');
  }

  async addMissing(result: PartyResult): Promise<void> {
    const missing = result.lines.filter((line) => !line.satisfied && !line.optionalOnly);
    try {
      const before = await call('getShoppingList', {});
      const listed = new Set(before.items.map((item) => item.ingredient.id));
      const change = await call('addToShoppingList', {
        body: { items: missing.map((line) => ({ ingredientId: line.ingredient.id })) },
      });
      dataChanged('shopping');
      const added = change.list.items.filter((item) => !listed.has(item.ingredient.id));
      if (added.length === 0) {
        toast({ title: text('party.alreadyListed') });
        return;
      }
      const names = added.map((item) => item.ingredient.name);
      toast({
        title: text('party.added', {
          names:
            names.length === 1
              ? names.join('')
              : `${names.slice(0, -1).join(', ')} ${text('party.and')} ${names.at(-1)}`,
        }),
        action: { label: text('toast.undo'), run: () => void undoAdded(added.map((item) => item.id)) },
      });
    } catch (error) {
      actionFailed(error, () => void this.addMissing(result));
    }
  }

  async chooseRecipes(): Promise<void> {
    const { collections } = await call('listCollections', {});
    if (!this.isConnected) {
      return;
    }
    const sheet = openSheet(this, {
      heading: () => text('party.chooseHeading'),
      body: () =>
        collections.length === 0
          ? html`<p class="cl-sheet-hint">${text('party.noCollections')}</p>`
          : html`<div class="cl-action-sheet">
              ${collections.map(
                (collection) => html`<button
                  type="button"
                  class="cl-action-sheet-item"
                  @click=${() => {
                    sheet.close();
                    navigate(`/party?collection=${collection.id}`);
                  }}
                >${collection.name}</button>`,
              )}
            </div>`,
    });
  }

  servingsPanel(plan: PartyPlan, result: PartyResult): TemplateResult {
    const names = result.recipes.map((item) => item.recipe.name).join(', ');
    return html`<div class="cl-party-panel">
      <lc-switch
        label=${text('party.same')}
        hint=${text('party.sameHint')}
        ?checked=${plan.same}
        @change=${(event: Event) => this.setSame(eventChecked(event), result)}
      ></lc-switch>
      ${
        plan.same
          ? html`<cl-figure
                .value=${plan.servings}
                label=${text(plan.servings === 1 ? 'party.servingOfEach' : 'party.servingsOfEach', {
                  drinks: formatCount(result.recipes.length, text('party.drinkOne'), text('party.drinkMany')),
                  names,
                })}
              ></cl-figure>
              <lc-number-input
                stepper
                label=${text('party.servings')}
                min="1"
                max=${PARTY_SERVINGS_MAX}
                .value=${plan.servings}
                @change=${(event: Event) => {
                  const next = eventNumber(event);
                  if (next !== null) {
                    this.setServings(null, next, result);
                  }
                }}
              ></lc-number-input>`
          : html`<ul class="cl-party-each">
              ${result.recipes.map(
                (item) => html`<li>
                  <lc-number-input
                    stepper
                    label=${item.recipe.name}
                    min="1"
                    max=${PARTY_SERVINGS_MAX}
                    .value=${item.servings}
                    @change=${(event: Event) => {
                      const next = eventNumber(event);
                      if (next !== null) {
                        this.setServings(item.recipe.id, next, result);
                      }
                    }}
                  ></lc-number-input>
                </li>`,
              )}
            </ul>`
      }
    </div>`;
  }

  totals(result: PartyResult): TemplateResult {
    const missing = result.lines.filter((line) => !line.satisfied && !line.optionalOnly);
    return html`<section class="cl-party-section" aria-labelledby="cl-party-totals">
      <div class="cl-party-section-head">
        <h2 id="cl-party-totals" class="cl-party-heading">${text('party.whatItTakes')}</h2>
        ${missing.length === 0 ? nothing : html`<span class="cl-party-muted">${text('party.notOnHand', { count: missing.length })}</span>`}
      </div>
      <div class="cl-party-table-wrap">
        <table class="cl-party-table">
          <thead>
            <tr>
              <th scope="col">${text('party.ingredient')}</th>
              <th scope="col" class="cl-num">ml</th>
              <th scope="col" class="cl-num">oz</th>
              <th scope="col">${text('party.weHaveIt')}</th>
            </tr>
          </thead>
          <tbody>
            ${result.lines.map(
              (line) => html`<tr>
                <th scope="row">${line.ingredient.name}</th>
                ${
                  line.volumeMl === null
                    ? html`<td colspan="2">${countsText(line)}</td>`
                    : html`<td class="cl-num">${mlText(line)}</td><td class="cl-num">${ozText(line)}</td>`
                }
                <td>${lineStatus(line)}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <div class="cl-party-actions">
        ${
          missing.length === 0
            ? nothing
            : html`<lc-button variant="primary" @click=${() => void this.addMissing(result)}
                >${text(missing.length === 1 ? 'party.addOne' : 'party.addMany', { count: missing.length })}</lc-button
              >`
        }
        <lc-button variant="quiet" href=${href(`/party/print${location.search}`)}>
          <lc-icon name="printer" aria-hidden="true"></lc-icon>${text('party.print')}
        </lc-button>
      </div>
    </section>`;
  }

  render() {
    const head = (from: string | null): TemplateResult => html`<header class="cl-party-head">
      <h1 class="cl-party-title">${text('nav.party')}</h1>
      <p class="cl-party-muted">${from === null ? text('party.subtitle') : text('party.from', { name: from })}</p>
    </header>`;
    const state = this.loaded.value;
    switch (state.kind) {
      case 'loading':
        return this.slow.value ? html`${skeleton('lines', text('nav.party'))}` : nothing;
      case 'failed':
        return loadFailed(text('nav.party'), () => this.retry(), 'none');
      case 'empty':
        return html`${head(null)}
          <lc-empty-state title=${text('party.emptyTitle')} description=${text('party.empty')}>
            ${illustration('empty-glass')}
            <lc-button variant="primary" @click=${() => void this.chooseRecipes().catch((error: unknown) => actionFailed(error, () => undefined))}
              >${text('party.choose')}</lc-button
            >
          </lc-empty-state>`;
      case 'ready':
        return html`${head(state.from)} ${this.servingsPanel(state.plan, state.result)} ${this.totals(state.result)}`;
    }
  }
}

View.register(tag, Party);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: Party;
  }
}
