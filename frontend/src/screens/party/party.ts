import type { PartyResult } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { invalidate } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import type { ScreenContext } from '../../app/types.ts';
import { illustration } from '../../design-system/illustration.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { eventChecked, eventNumber } from '../recipes/parts/events.ts';
import { actionFailed } from '../recipes/parts/failures.ts';
import { openSheet } from '../recipes/parts/sheet.ts';
import { undoAdded } from '../recipes/parts/shopping-undo.ts';
import { onLeave, slowFlag } from '../recipes/parts/view.ts';
import { countsText, mlText, ozText, PARTY_SERVINGS_MAX, readPlan, servingsFor } from './parts/party-state.ts';
import './party.css';

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly from: string | null; readonly result: PartyResult };

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-party cl-reading';
  let state: Loaded = { kind: 'loading' };
  let run = 0;

  const recipeIds = async (): Promise<{ ids: readonly number[]; from: string | null }> => {
    const plan = readPlan(ctx.query);
    if (plan.collectionId !== null) {
      const collection = await call('getCollection', { params: { id: plan.collectionId } });
      return { ids: collection.recipes.map((recipe) => recipe.id), from: collection.name };
    }
    return { ids: plan.recipeIds, from: null };
  };

  const compute = async (): Promise<void> => {
    const current = ++run;
    try {
      const { ids, from } = await recipeIds();
      if (ids.length === 0) {
        state = { kind: 'empty' };
      } else {
        const plan = readPlan(ctx.query);
        const result = await call('calculateParty', {
          body: { recipes: ids.map((recipeId) => ({ recipeId, servings: servingsFor(plan, recipeId) })) },
        });
        state = { kind: 'ready', from, result };
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      state = error.code === 'not_found' ? { kind: 'empty' } : { kind: 'failed' };
    }
    if (current === run) {
      draw();
    }
  };

  const setSame = (same: boolean, result: PartyResult): void => {
    const plan = readPlan(ctx.query);
    ctx.query.set(
      same
        ? { each: null }
        : { each: result.recipes.map((item) => `${item.recipe.id}:${servingsFor(plan, item.recipe.id)}`).join(',') },
      'replace',
    );
  };

  const setServings = (recipeId: number | null, servings: number, result: PartyResult): void => {
    const plan = readPlan(ctx.query);
    if (recipeId === null) {
      ctx.query.set({ servings: String(servings) }, 'replace');
      return;
    }
    const each = result.recipes.map(
      (item) => `${item.recipe.id}:${item.recipe.id === recipeId ? servings : servingsFor(plan, item.recipe.id)}`,
    );
    ctx.query.set({ each: each.join(',') }, 'replace');
  };

  const addMissing = async (result: PartyResult): Promise<void> => {
    const missing = result.lines.filter((line) => !line.satisfied && !line.optionalOnly);
    try {
      const before = await call('getShoppingList', {});
      const listed = new Set(before.items.map((item) => item.ingredient.id));
      const change = await call('addToShoppingList', {
        body: { items: missing.map((line) => ({ ingredientId: line.ingredient.id })) },
      });
      invalidate('shopping');
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
      actionFailed(error, () => void addMissing(result));
    }
  };

  const chooseRecipes = async (): Promise<void> => {
    const { collections } = await call('listCollections', {});
    const sheet = openSheet({
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
                    ctx.navigate(`/party?collection=${collection.id}`);
                  }}
                >${collection.name}</button>`,
              )}
            </div>`,
    });
  };

  const servingsPanel = (result: PartyResult): TemplateResult => {
    const plan = readPlan(ctx.query);
    const names = result.recipes.map((item) => item.recipe.name).join(', ');
    return html`<div class="cl-party-panel">
      <lc-switch
        label=${text('party.same')}
        hint=${text('party.sameHint')}
        ?checked=${plan.same}
        @change=${(event: Event) => setSame(eventChecked(event), result)}
      ></lc-switch>
      ${
        plan.same
          ? html`<cl-figure
                .value=${plan.servings}
                label=${text('party.servingsOfEach', { count: result.recipes.length, names })}
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
                    setServings(null, next, result);
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
                        setServings(item.recipe.id, next, result);
                      }
                    }}
                  ></lc-number-input>
                </li>`,
              )}
            </ul>`
      }
    </div>`;
  };

  const totals = (result: PartyResult): TemplateResult => {
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
                <td>
                  <span class=${line.satisfied ? 'cl-party-status' : 'cl-party-status is-missing'}>
                    <cl-bulb size="mini" status=${line.satisfied ? 'on' : 'off'} aria-hidden="true"></cl-bulb>
                    ${line.satisfied ? text('party.onHand') : text('party.missing')}
                  </span>
                </td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <div class="cl-party-actions">
        ${
          missing.length === 0
            ? nothing
            : html`<lc-button variant="primary" @click=${() => void addMissing(result)}
                >${text(missing.length === 1 ? 'party.addOne' : 'party.addMany', { count: missing.length })}</lc-button
              >`
        }
        <lc-button variant="quiet" href=${href(`/party/print${location.search}`)}>
          <lc-icon name="printer" aria-hidden="true"></lc-icon>${text('party.print')}
        </lc-button>
      </div>
    </section>`;
  };

  const draw = (): void => {
    const head = (from: string | null): TemplateResult => html`<header class="cl-party-head">
      <h1 class="cl-party-title">${text('nav.party')}</h1>
      <p class="cl-party-muted">${from === null ? text('party.subtitle') : text('party.from', { name: from })}</p>
    </header>`;
    switch (state.kind) {
      case 'loading':
        if (slow.slow() && element.querySelector('.cl-skeleton') === null) {
          element.replaceChildren(skeleton('lines', text('nav.party')));
        }
        return;
      case 'failed':
        render(
          html`<lc-empty-state title=${text('loadFailed.title', { screen: text('nav.party') })} description=${text('loadFailed.body')}>
            ${illustration('empty-lost')}
            <lc-button variant="primary" @click=${() => void compute()}>${text('loadFailed.retry')}</lc-button>
          </lc-empty-state>`,
          element,
        );
        return;
      case 'empty':
        element.querySelector('.cl-skeleton')?.remove();
        render(
          html`${head(null)}
            <lc-empty-state title=${text('party.emptyTitle')} description=${text('party.empty')}>
              ${illustration('empty-glass')}
              <lc-button variant="primary" @click=${() => void chooseRecipes().catch((error: unknown) => actionFailed(error, () => undefined))}
                >${text('party.choose')}</lc-button
              >
            </lc-empty-state>`,
          element,
        );
        return;
      case 'ready':
        element.querySelector('.cl-skeleton')?.remove();
        render(html`${head(state.from)} ${servingsPanel(state.result)} ${totals(state.result)}`, element);
    }
  };

  const slow = slowFlag(() => draw());
  void compute();
  const stop = ctx.query.subscribe(() => void compute());
  onLeave(element, () => {
    slow.cancel();
    stop();
  });
  return element;
}
