import { LIMITS, type Menu, type MenuInput, type MenuItem, type MenuItemInput, type Recipe } from '@cellar/contract';
import { html, nothing } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { call } from '../../../app/api.ts';
import { eventChecked, eventText } from '../../../app/events.ts';
import { actionFailed } from '../../../app/problems.ts';
import { dataChanged } from '../../../app/resources.ts';
import { today } from '../../../app/today.ts';
import type { OverlayHost } from '../../../app/types.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';
import '../../../design-system/lc/alert.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/input.ts';
import '../../../design-system/lc/radio.ts';
import '../../../design-system/lc/radio-group.ts';
import '../../../design-system/lc/select.ts';
import '../../../design-system/lc/switch.ts';
import { openSheet } from './sheet.ts';

const NEW_MENU = 'new';
const MENU_PAGE = 100;

function itemInput(item: MenuItem): MenuItemInput {
  return item.kind === 'recipe'
    ? {
        kind: 'recipe',
        recipeId: item.recipe.id,
        hostNote: item.hostNote,
        hideWhenUnavailable: item.hideWhenUnavailable,
      }
    : {
        kind: 'ingredient',
        ingredientId: item.ingredient.id,
        hostNote: item.hostNote,
        hideWhenUnavailable: item.hideWhenUnavailable,
      };
}

function menuInput(menu: Menu): MenuInput {
  return {
    name: menu.name,
    date: menu.date,
    sections: menu.sections.map((section) => ({ name: section.name, items: section.items.map(itemInput) })),
  };
}

export async function openMenuSheet(host: OverlayHost, recipe: Recipe): Promise<void> {
  const page = await call('listMenus', { query: { pageSize: MENU_PAGE } });
  if (!host.isConnected) {
    return;
  }
  const menus = page.items;
  const choice = signal(menus[0] === undefined ? NEW_MENU : String(menus[0].id));
  const menu = signal<Menu | null>(null);
  const sectionIndex = signal(0);
  const hostNote = signal('');
  const hide = signal(false);
  const newName = signal('');
  const saving = signal(false);
  const missing = recipe.lines.filter((line) => line.status === 'missing' && !line.optional);

  const load = async (): Promise<void> => {
    menu.value = choice.peek() === NEW_MENU ? null : await call('getMenu', { params: { id: Number(choice.peek()) } });
    sectionIndex.value = 0;
  };

  const target = (): string =>
    choice.value === NEW_MENU
      ? newName.value.trim()
      : (menus.find((item) => String(item.id) === choice.value)?.name ?? '');

  const save = async (): Promise<void> => {
    const item: MenuItemInput = {
      kind: 'recipe',
      recipeId: recipe.id,
      hostNote: hostNote.peek(),
      hideWhenUnavailable: hide.peek(),
    };
    const chosen = menu.peek();
    saving.value = true;
    try {
      if (chosen === null) {
        await call('createMenu', {
          body: {
            name: newName.peek().trim(),
            date: today(),
            sections: [{ name: text('recipes.menuSection'), items: [item] }],
          },
        });
      } else {
        const input = menuInput(chosen);
        const sections =
          input.sections.length === 0 ? [{ name: text('recipes.menuSection'), items: [] }] : input.sections;
        await call('replaceMenu', {
          params: { id: chosen.id },
          body: {
            ...input,
            sections: sections.map((section, index) =>
              index === sectionIndex.peek() ? { ...section, items: [...section.items, item] } : section,
            ),
          },
        });
      }
      dataChanged('menus');
      const name = target();
      sheet.close();
      toast({ title: text('recipes.addedToMenu', { menu: name }) });
    } catch (error) {
      saving.value = false;
      actionFailed(error, () => void save());
    }
  };

  const sheet = openSheet(host, {
    heading: () => text('recipes.menuHeading', { name: recipe.name }),
    body: () => html`
      <lc-select
        label=${text('recipes.menuField')}
        value=${choice.value}
        .options=${[
          ...menus.map((item) => ({
            value: String(item.id),
            label: item.live ? text('recipes.menuLive', { name: item.name }) : item.name,
          })),
          { value: NEW_MENU, label: text('recipes.newMenu') },
        ]}
        @change=${(event: Event) => {
          choice.value = eventText(event) || NEW_MENU;
          void load().catch((error: unknown) => actionFailed(error, () => void load()));
        }}
      ></lc-select>
      ${
        choice.value === NEW_MENU
          ? html`<lc-input
              label=${text('recipes.newMenuName')}
              maxlength=${LIMITS.shortName.max}
              value=${newName.value}
              @input=${(event: Event) => {
                newName.value = eventText(event);
              }}
            ></lc-input>`
          : menu.value !== null && menu.value.sections.length > 0
            ? html`<lc-radio-group
                label=${text('recipes.menuSectionField')}
                value=${String(sectionIndex.value)}
                @change=${(event: Event) => {
                  sectionIndex.value = Number(eventText(event));
                }}
              >
                ${menu.value.sections.map(
                  (section, index) => html`<lc-radio
                    value=${String(index)}
                    label=${text('recipes.menuSectionCount', { name: section.name, count: section.items.length })}
                  ></lc-radio>`,
                )}
              </lc-radio-group>`
            : nothing
      }
      <lc-input
        label=${text('recipes.hostNote')}
        hint=${text('recipes.hostNoteHint')}
        maxlength=${LIMITS.hostNote.max}
        value=${hostNote.value}
        @input=${(event: Event) => {
          hostNote.value = eventText(event);
        }}
      ></lc-input>
      <lc-switch
        label=${text('recipes.hideWhenMissing')}
        hint=${text('recipes.hideWhenMissingHint')}
        ?checked=${hide.value}
        @change=${(event: Event) => {
          hide.value = eventChecked(event);
        }}
      ></lc-switch>
      ${
        missing.length > 0
          ? html`<lc-alert variant="warning" icon="triangle-alert" title=${text('recipes.menuMissingTitle', { count: missing.length })}>
              ${text('recipes.menuMissingBody', { names: missing.map((line) => line.ingredient.name).join(', ') })}
            </lc-alert>`
          : nothing
      }
    `,
    footer: () => html`
      <lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
      <lc-button
        variant="primary"
        ?disabled=${saving.value || target() === ''}
        @click=${() => void save()}
      >${target() === '' ? text('recipes.addToMenu') : text('recipes.addToNamed', { menu: target() })}</lc-button>
    `,
  });
  if (choice.peek() !== NEW_MENU) {
    await load();
  }
}
