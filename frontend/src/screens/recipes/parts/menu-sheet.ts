import { LIMITS, type Menu, type MenuInput, type MenuItem, type MenuItemInput, type Recipe } from '@cellar/contract';
import { html, nothing } from '@lightstart/light/html';
import { call } from '../../../app/api.ts';
import { invalidate } from '../../../app/resources.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';
import { eventChecked, eventText } from './events.ts';
import { actionFailed } from './failures.ts';
import { openSheet } from './sheet.ts';
import { today } from './today.ts';

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

export async function openMenuSheet(recipe: Recipe): Promise<void> {
  const page = await call('listMenus', { query: { pageSize: MENU_PAGE } });
  const menus = page.items;
  let choice = menus[0] === undefined ? NEW_MENU : String(menus[0].id);
  let menu: Menu | null = null;
  let sectionIndex = 0;
  let hostNote = '';
  let hide = false;
  let newName = '';
  let saving = false;
  const missing = recipe.lines.filter((line) => line.status === 'missing' && !line.optional);

  const load = async (): Promise<void> => {
    menu = choice === NEW_MENU ? null : await call('getMenu', { params: { id: Number(choice) } });
    sectionIndex = 0;
    sheet.redraw();
  };

  const target = (): string =>
    choice === NEW_MENU ? newName.trim() : (menus.find((item) => String(item.id) === choice)?.name ?? '');

  const save = async (): Promise<void> => {
    const item: MenuItemInput = { kind: 'recipe', recipeId: recipe.id, hostNote, hideWhenUnavailable: hide };
    saving = true;
    sheet.redraw();
    try {
      if (menu === null) {
        await call('createMenu', {
          body: {
            name: newName.trim(),
            date: today(),
            sections: [{ name: text('recipes.menuSection'), items: [item] }],
          },
        });
      } else {
        const input = menuInput(menu);
        const sections =
          input.sections.length === 0 ? [{ name: text('recipes.menuSection'), items: [] }] : input.sections;
        await call('replaceMenu', {
          params: { id: menu.id },
          body: {
            ...input,
            sections: sections.map((section, index) =>
              index === sectionIndex ? { ...section, items: [...section.items, item] } : section,
            ),
          },
        });
      }
      invalidate('menus');
      const name = target();
      sheet.close();
      toast({ title: text('recipes.addedToMenu', { menu: name }) });
    } catch (error) {
      saving = false;
      sheet.redraw();
      actionFailed(error, () => void save());
    }
  };

  const sheet = openSheet({
    heading: () => text('recipes.menuHeading', { name: recipe.name }),
    body: () => html`
      <lc-select
        label=${text('recipes.menuField')}
        value=${choice}
        .options=${[
          ...menus.map((item) => ({
            value: String(item.id),
            label: item.live ? text('recipes.menuLive', { name: item.name }) : item.name,
          })),
          { value: NEW_MENU, label: text('recipes.newMenu') },
        ]}
        @change=${(event: Event) => {
          choice = eventText(event) || NEW_MENU;
          void load().catch((error: unknown) => actionFailed(error, () => void load()));
        }}
      ></lc-select>
      ${
        choice === NEW_MENU
          ? html`<lc-input
              label=${text('recipes.newMenuName')}
              maxlength=${LIMITS.shortName.max}
              value=${newName}
              @input=${(event: Event) => {
                newName = eventText(event);
                sheet.redraw();
              }}
            ></lc-input>`
          : menu !== null && menu.sections.length > 0
            ? html`<lc-radio-group
                label=${text('recipes.menuSectionField')}
                value=${String(sectionIndex)}
                @change=${(event: Event) => {
                  sectionIndex = Number(eventText(event));
                }}
              >
                ${menu.sections.map(
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
        value=${hostNote}
        @input=${(event: Event) => {
          hostNote = eventText(event);
        }}
      ></lc-input>
      <lc-switch
        label=${text('recipes.hideWhenMissing')}
        hint=${text('recipes.hideWhenMissingHint')}
        ?checked=${hide}
        @change=${(event: Event) => {
          hide = eventChecked(event);
          sheet.redraw();
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
        ?disabled=${saving || target() === ''}
        @click=${() => void save()}
      >${target() === '' ? text('recipes.addToMenu') : text('recipes.addToNamed', { menu: target() })}</lc-button>
    `,
  });
  if (choice !== NEW_MENU) {
    await load();
  }
}
