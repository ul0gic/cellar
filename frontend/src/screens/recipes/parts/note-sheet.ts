import { LIMITS, type Recipe, type Visibility } from '@cellar/contract';
import { html, nothing } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { call } from '../../../app/api.ts';
import { eventText } from '../../../app/events.ts';
import { actionFailed } from '../../../app/problems.ts';
import { dataChanged } from '../../../app/resources.ts';
import { today } from '../../../app/today.ts';
import type { OverlayHost, SessionPerson } from '../../../app/types.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';
import { ratingControl } from './rating.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/input.ts';
import '../../../design-system/lc/segmented.ts';
import '../../../design-system/lc/textarea.ts';
import { openSheet } from './sheet.ts';

export async function openNoteSheet(host: OverlayHost, recipe: Recipe, session: SessionPerson): Promise<void> {
  const { items: descriptors } = await call('listDescriptors', {});
  if (!host.isConnected) {
    return;
  }
  const note = signal('');
  const tastedOn = signal(today());
  const chosen = signal<ReadonlySet<number>>(new Set());
  const visibility = signal<Visibility>(session.person.defaultVisibility);
  const rating = signal(recipe.mine.rating?.value ?? 0);
  const saving = signal(false);

  const toggle = (id: number): void => {
    const next = new Set(chosen.peek());
    if (next.has(id)) {
      next.delete(id);
    } else if (next.size < LIMITS.noteDescriptors.max) {
      next.add(id);
    }
    chosen.value = next;
  };

  const save = async (): Promise<void> => {
    saving.value = true;
    try {
      await call('createRecipeNote', {
        params: { id: recipe.id },
        body: {
          text: note.peek(),
          tastedOn: tastedOn.peek(),
          descriptorIds: [...chosen.peek()],
          verdict: null,
          visibility: visibility.peek(),
        },
      });
      dataChanged('notes', 'recipes', 'stats');
      sheet.close();
      toast({ title: text('recipes.noteSaved') });
    } catch (error) {
      saving.value = false;
      actionFailed(error, () => void save());
    }
  };

  const sheet = openSheet(host, {
    heading: () => text('recipes.noteHeading', { name: recipe.name }),
    body: () => html`
      ${ratingControl({
        value: rating.value,
        household: recipe.household.rating,
        recipeId: recipe.id,
        onRated: (value) => {
          rating.value = value;
        },
        alwaysHint: true,
      })}
      <lc-textarea
        label=${text('recipes.noteText')}
        rows="4"
        maxlength=${LIMITS.noteText.max}
        value=${note.value}
        @input=${(event: Event) => {
          note.value = eventText(event);
        }}
      ></lc-textarea>
      <lc-input
        type="date"
        label=${text('recipes.tastedOn')}
        .value=${tastedOn.value}
        @input=${(event: Event) => {
          tastedOn.value = eventText(event);
        }}
      ></lc-input>
      <fieldset class="cl-sheet-section">
        <legend class="cl-sheet-label">${text('recipes.tastesLike')}</legend>
        <div class="cl-sheet-chips">
          ${descriptors.map(
            (descriptor) => html`<lc-button
              size="sm"
              variant=${chosen.value.has(descriptor.id) ? 'primary' : 'quiet'}
              aria-pressed=${chosen.value.has(descriptor.id) ? 'true' : 'false'}
              @click=${() => toggle(descriptor.id)}
            >${descriptor.name}</lc-button>`,
          )}
        </div>
      </fieldset>
      <div class="cl-sheet-section">
        <span class="cl-sheet-label" aria-hidden="true">${text('recipes.whoCanRead')}</span>
        <lc-segmented
          label=${text('recipes.whoCanRead')}
          value=${visibility.value}
          .options=${[
            { value: 'household', label: text('recipes.visibilityHousehold'), icon: 'users' },
            { value: 'private', label: text('recipes.visibilityPrivate'), icon: 'lock' },
          ]}
          @change=${(event: Event) => {
            visibility.value = eventText(event) === 'private' ? 'private' : 'household';
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
        ?disabled=${saving.value || tastedOn.value === '' || (note.value.trim() === '' && chosen.value.size === 0)}
        aria-busy=${saving.value ? 'true' : nothing}
        @click=${() => void save()}
      >${text('recipes.saveNote')}</lc-button>
    `,
  });
}
