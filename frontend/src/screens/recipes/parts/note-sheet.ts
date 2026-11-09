import { LIMITS, type Recipe, type Visibility } from '@cellar/contract';
import { html, nothing } from '@lightstart/light/html';
import { call } from '../../../app/api.ts';
import { eventText } from '../../../app/events.ts';
import { actionFailed } from '../../../app/problems.ts';
import { invalidate } from '../../../app/resources.ts';
import { today } from '../../../app/today.ts';
import type { SessionPerson } from '../../../app/types.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';
import { ratingControl } from './rating.ts';
import { openSheet } from './sheet.ts';

export async function openNoteSheet(recipe: Recipe, session: SessionPerson): Promise<void> {
  const { items: descriptors } = await call('listDescriptors', {});
  let note = '';
  let tastedOn = today();
  let chosen = new Set<number>();
  let visibility: Visibility = session.person.defaultVisibility;
  let rating = recipe.mine.rating?.value ?? 0;
  let saving = false;

  const toggle = (id: number): void => {
    const next = new Set(chosen);
    if (next.has(id)) {
      next.delete(id);
    } else if (next.size < LIMITS.noteDescriptors.max) {
      next.add(id);
    }
    chosen = next;
    sheet.redraw();
  };

  const save = async (): Promise<void> => {
    saving = true;
    sheet.redraw();
    try {
      await call('createRecipeNote', {
        params: { id: recipe.id },
        body: { text: note, tastedOn, descriptorIds: [...chosen], verdict: null, visibility },
      });
      invalidate('notes', 'recipes', 'stats');
      sheet.close();
      toast({ title: text('recipes.noteSaved') });
    } catch (error) {
      saving = false;
      sheet.redraw();
      actionFailed(error, () => void save());
    }
  };

  const sheet = openSheet({
    heading: () => text('recipes.noteHeading', { name: recipe.name }),
    body: () => html`
      ${ratingControl({
        value: rating,
        household: recipe.household.rating,
        recipeId: recipe.id,
        onRated: (value) => {
          rating = value;
          sheet.redraw();
        },
        alwaysHint: true,
      })}
      <lc-textarea
        label=${text('recipes.noteText')}
        rows="4"
        maxlength=${LIMITS.noteText.max}
        value=${note}
        @input=${(event: Event) => {
          note = eventText(event);
          sheet.redraw();
        }}
      ></lc-textarea>
      <lc-input
        type="date"
        label=${text('recipes.tastedOn')}
        .value=${tastedOn}
        @input=${(event: Event) => {
          tastedOn = eventText(event);
          sheet.redraw();
        }}
      ></lc-input>
      <fieldset class="cl-sheet-section">
        <legend class="cl-sheet-label">${text('recipes.tastesLike')}</legend>
        <div class="cl-sheet-chips">
          ${descriptors.map(
            (descriptor) => html`<lc-button
              size="sm"
              variant=${chosen.has(descriptor.id) ? 'primary' : 'quiet'}
              aria-pressed=${chosen.has(descriptor.id) ? 'true' : 'false'}
              @click=${() => toggle(descriptor.id)}
            >${descriptor.name}</lc-button>`,
          )}
        </div>
      </fieldset>
      <div class="cl-sheet-section">
        <span class="cl-sheet-label" aria-hidden="true">${text('recipes.whoCanRead')}</span>
        <lc-segmented
          label=${text('recipes.whoCanRead')}
          value=${visibility}
          .options=${[
            { value: 'household', label: text('recipes.visibilityHousehold'), icon: 'users' },
            { value: 'private', label: text('recipes.visibilityPrivate'), icon: 'lock' },
          ]}
          @change=${(event: Event) => {
            visibility = eventText(event) === 'private' ? 'private' : 'household';
          }}
        ></lc-segmented>
        <p class="cl-sheet-hint">
          ${text(
            session.person.defaultVisibility === 'private' ? 'recipes.visibilityHintPrivate' : 'recipes.visibilityHint',
          )}
        </p>
      </div>
    `,
    footer: () => html`
      <lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
      <lc-button
        variant="primary"
        ?disabled=${saving || tastedOn === '' || (note.trim() === '' && chosen.size === 0)}
        aria-busy=${saving ? 'true' : nothing}
        @click=${() => void save()}
      >${text('recipes.saveNote')}</lc-button>
    `,
  });
}
