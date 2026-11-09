import type { HouseholdSubstitution, SubstitutionEffect } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { detailText, eventPick } from '../../app/events.ts';
import { watch } from '../../app/load.ts';
import { actionFailed, problemText } from '../../app/problems.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import type { ScreenContext } from '../../app/types.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { text } from '../../text/index.ts';
import { segmentedField } from './parts/fields.ts';
import { settingsPage } from './parts/frame.ts';
import { loadFailed } from './parts/load-failed.ts';

const PICKER_ROWS = 8;

interface Picked {
  readonly id: number;
  readonly title: string;
}

interface Picker {
  picked: Picked | null;
  docs: readonly { readonly id: number; readonly group: string; readonly title: string }[];
  asked: number;
}

function emptyPicker(): Picker {
  return { picked: null, docs: [], asked: 0 };
}

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'substitutions', (main) => {
    const substitutions = resourceFor('listSubstitutions', {}, { tags: ['shelf'] });
    let from = emptyPicker();
    let to = emptyPicker();
    let effect: SubstitutionEffect = 'same_drink';
    let formError = '';
    let busy = false;

    const lookup = async (picker: Picker, query: string): Promise<void> => {
      const asked = picker.asked + 1;
      picker.asked = asked;
      picker.picked = null;
      if (query.trim().length === 0) {
        picker.docs = [];
        redraw();
        return;
      }
      try {
        const page = await call('listIngredients', { query: { q: query.trim(), pageSize: PICKER_ROWS } });
        if (picker.asked === asked) {
          const group = text('settings.subs.ingredients');
          picker.docs = page.items.map((item) => ({ id: item.id, group, title: item.name }));
          redraw();
        }
      } catch (error) {
        actionFailed(error, () => void lookup(picker, query));
      }
    };

    const pickerField = (label: string, state: Picker): TemplateResult => html`<div class="cl-field">
      <lc-search
        remote
        inline
        label=${label}
        placeholder=${text('settings.subs.placeholder')}
        query=${state.picked?.title ?? ''}
        .docs=${state.docs}
        @search-input=${(event: Event) => void lookup(state, detailText(event))}
        @search-select=${(event: Event) => {
          state.picked = eventPick(event);
          formError = '';
          redraw();
        }}
      ></lc-search>
    </div>`;

    const add = async (): Promise<void> => {
      if (from.picked === null || to.picked === null) {
        formError = text('settings.subs.pickBoth');
      } else if (from.picked.id === to.picked.id) {
        formError = text('settings.subs.different');
      } else {
        formError = '';
      }
      if (formError !== '' || from.picked === null || to.picked === null) {
        redraw();
        return;
      }
      busy = true;
      redraw();
      try {
        await call('createSubstitution', {
          body: { fromIngredientId: from.picked.id, toIngredientId: to.picked.id, effect },
        });
        from = emptyPicker();
        to = emptyPicker();
        invalidate('shelf', 'recipes');
      } catch (error) {
        if (error instanceof ApiError && error.code === 'validation_failed') {
          formError = problemText(error);
        } else {
          actionFailed(error, () => void add());
        }
      } finally {
        busy = false;
      }
      redraw();
    };

    const remove = async (substitution: HouseholdSubstitution): Promise<void> => {
      try {
        await call('deleteSubstitution', { params: { id: substitution.id } });
        invalidate('shelf', 'recipes');
      } catch (error) {
        actionFailed(error, () => void remove(substitution));
      }
    };

    const row = (substitution: HouseholdSubstitution) => {
      const pair = text('settings.subs.pair', { have: substitution.to.name, asked: substitution.from.name });
      const effectText =
        substitution.effect === 'same_drink' ? text('settings.subs.same') : text('settings.subs.changes');
      return html`<div class="cl-srow">
        <span class="cl-srow-text"
          ><b>${pair}</b
          ><span
            >${
              substitution.createdBy === null
                ? `${effectText}.`
                : text('settings.subs.addedBy', { effect: effectText, name: substitution.createdBy.name })
            }</span
          ></span
        >
        <lc-button
          variant="ghost"
          icon-only
          aria-label=${text('settings.subs.remove', { pair })}
          @click=${() => void remove(substitution)}
          ><lc-icon name="x" aria-hidden="true"></lc-icon
        ></lc-button>
      </div>`;
    };

    const view = (list: readonly HouseholdSubstitution[]) => html`<section
      class="cl-sgroup"
      aria-labelledby="settings-subs"
    >
      <h2 id="settings-subs">${text('settings.subs.title')}</h2>
      <p>${text('settings.subs.lead')}</p>
      ${
        list.length === 0
          ? html`<p class="cl-muted">${text('settings.subs.none')}</p>`
          : html`<div class="cl-panel">${list.map(row)}</div>`
      }
      <form
        class="cl-panel cl-panel-pad cl-subs-form"
        novalidate
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          if (!busy) {
            void add();
          }
        }}
      >
        <div class="cl-form-grid cl-form-grid-two">
          ${pickerField(text('settings.subs.from'), from)} ${pickerField(text('settings.subs.to'), to)}
        </div>
        ${segmentedField(
          text('settings.subs.effect'),
          [
            { value: 'same_drink', label: text('settings.subs.sameLong') },
            { value: 'changes_drink', label: text('settings.subs.changesLong') },
          ],
          effect,
          (value) => {
            effect = value === 'changes_drink' ? 'changes_drink' : 'same_drink';
          },
        )}
        ${formError === '' ? nothing : html`<p class="cl-field-error" role="alert">${formError}</p>`}
        <div class="cl-actions">
          <lc-button variant="primary" type="submit" ?disabled=${busy}>${text('settings.subs.add')}</lc-button>
        </div>
      </form>
    </section>`;

    const { redraw } = watch(main, [substitutions], ({ phase, retry }) => {
      const list = substitutions.peek();
      if (phase === 'failed') {
        render(loadFailed(text('settings.substitutions'), retry), main);
      } else if (phase === 'slow') {
        render(skeleton('rows', text('settings.substitutions')), main);
      } else if (phase === 'ready' && list !== undefined) {
        render(view(list.substitutions), main);
      }
    });
  });
}
