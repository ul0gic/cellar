import {
  formatMenuTokenForDisplay,
  type ImageRef,
  type IngredientSummary,
  LIMITS,
  type Menu,
  type MenuInput,
  type MenuItem,
  type MenuItemInput,
  type MenuSummary,
  normalizeMenuToken,
  type RecipeSummary,
} from '@cellar/contract';
import { registerFormFieldRenderer } from '@lightstart/light/components/form/field-renderers.js';
import type { FormField, SearchDoc } from '@lightstart/light/components/types.js';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { invalidate } from '../../app/resources.ts';
import { router } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import type { ScreenContext } from '../../app/types.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { illustration } from '../../design-system/illustration.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { actionFailed } from './support.ts';
import './editor.css';

interface Drink {
  readonly kind: 'recipe' | 'ingredient';
  readonly refId: number;
  readonly name: string;
  readonly image: ImageRef | null;
  readonly hostNote: string;
  readonly hideWhenUnavailable: boolean;
  readonly available: boolean;
}

interface SectionDraft {
  readonly name: string;
  readonly items: readonly (Drink | null)[];
}

interface MenuDraft {
  readonly name: string;
  readonly date: string;
  readonly sections: readonly SectionDraft[];
}

type Phase = 'waiting' | 'slow' | 'failed' | 'missing' | 'ready';

// D-1 §9.16 density tiers: grand up to 6 visible drinks, standard up to 9, compact up to 16, then 16 per page.
const GRAND_MAX = 6;
const STANDARD_MAX = 9;
const PAGE_SIZE = 16;
// D-1 §9.15: the host-note counter appears with 20 characters left (at 60 of 80).
const NOTE_COUNTER_FROM = 20;
const PICKER_RECIPES = 6;
const PICKER_NEAT = 4;

const picked = new Map<string, Drink>();
let suggestions: SearchDoc[] = [];

function isDrink(value: unknown): value is Drink {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value.kind === 'recipe' || value.kind === 'ingredient') &&
    'refId' in value &&
    typeof value.refId === 'number'
  );
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readSection(value: unknown): SectionDraft {
  if (typeof value !== 'object' || value === null) {
    return { name: '', items: [] };
  }
  const name = 'name' in value ? stringOf(value.name) : '';
  const items = 'items' in value && Array.isArray(value.items) ? value.items : [];
  return { name, items: items.map((item: unknown) => (isDrink(item) ? item : null)) };
}

function readDraft(data: Readonly<Record<string, unknown>>): MenuDraft {
  const sections = Array.isArray(data.sections) ? data.sections : [];
  return { name: stringOf(data.name), date: stringOf(data.date), sections: sections.map(readSection) };
}

function drinkOf(item: MenuItem): Drink {
  const shared = { hostNote: item.hostNote, hideWhenUnavailable: item.hideWhenUnavailable, available: item.available };
  return item.kind === 'recipe'
    ? { kind: 'recipe', refId: item.recipe.id, name: item.recipe.name, image: item.recipe.image, ...shared }
    : {
        kind: 'ingredient',
        refId: item.ingredient.id,
        name: item.ingredient.name,
        image: item.ingredient.image,
        ...shared,
      };
}

function draftOf(menu: Menu): MenuDraft {
  return {
    name: menu.name,
    date: menu.date,
    sections: menu.sections.map((section) => ({ name: section.name, items: section.items.map(drinkOf) })),
  };
}

function itemInput(drink: Drink): MenuItemInput {
  const shared = { hostNote: drink.hostNote, hideWhenUnavailable: drink.hideWhenUnavailable };
  return drink.kind === 'recipe'
    ? { kind: 'recipe', recipeId: drink.refId, ...shared }
    : { kind: 'ingredient', ingredientId: drink.refId, ...shared };
}

function menuInput(draft: MenuDraft): MenuInput {
  return {
    name: draft.name.trim(),
    date: draft.date,
    sections: draft.sections.map((section) => ({
      name: section.name.trim(),
      items: section.items.filter(isDrink).map(itemInput),
    })),
  };
}

function shownOnTv(draft: MenuDraft): number {
  return draft.sections
    .flatMap((section) => section.items)
    .filter((item) => isDrink(item) && (item.available || !item.hideWhenUnavailable)).length;
}

function tierText(count: number): string {
  if (count === 0) {
    return text('menus.tierNone');
  }
  const drinks = count === 1 ? text('menus.drink') : text('menus.drinks', { count });
  if (count <= GRAND_MAX) {
    return text('menus.tierGrand', { count: drinks });
  }
  if (count <= STANDARD_MAX) {
    return text('menus.tierStandard', { count: drinks });
  }
  if (count <= PAGE_SIZE) {
    return text('menus.tierCompact', { count: drinks });
  }
  return text('menus.tierPaged', { count: drinks, pages: Math.ceil(count / PAGE_SIZE) });
}

function detailValue(event: Event): unknown {
  if (!(event instanceof CustomEvent)) {
    return undefined;
  }
  const detail: unknown = event.detail;
  return detail;
}

function changedText(event: Event): string {
  const detail = detailValue(event);
  if (typeof detail === 'object' && detail !== null && 'value' in detail && typeof detail.value === 'string') {
    return detail.value;
  }
  return event.target instanceof HTMLInputElement ? event.target.value : '';
}

function changedCheck(event: Event): boolean {
  const detail = detailValue(event);
  return typeof detail === 'object' && detail !== null && 'checked' in detail && detail.checked === true;
}

function recipeDoc(recipe: RecipeSummary, group: string): SearchDoc {
  const id = `recipe:${recipe.id}`;
  picked.set(id, {
    kind: 'recipe',
    refId: recipe.id,
    name: recipe.name,
    image: recipe.image,
    hostNote: '',
    hideWhenUnavailable: false,
    available: recipe.canMake,
  });
  return {
    id,
    group,
    title: recipe.name,
    hint: recipe.canMake ? text('menus.hintReady') : text('menus.hintMissing', { count: recipe.missingCount }),
  };
}

function neatDoc(ingredient: IngredientSummary): SearchDoc {
  const id = `ingredient:${ingredient.id}`;
  picked.set(id, {
    kind: 'ingredient',
    refId: ingredient.id,
    name: ingredient.name,
    image: ingredient.image,
    hostNote: '',
    hideWhenUnavailable: false,
    available: ingredient.onHand,
  });
  return {
    id,
    group: text('menus.groupNeat'),
    title: ingredient.name,
    hint:
      ingredient.bottleCount === 1
        ? text('menus.hintBottle')
        : text('menus.hintBottles', { count: ingredient.bottleCount }),
  };
}

async function findDrinks(event: Event): Promise<void> {
  const search = event.currentTarget instanceof Element ? event.currentTarget.closest('lc-search') : null;
  const typed = detailValue(event);
  if (search === null || typeof typed !== 'string') {
    return;
  }
  const q = typed.trim().slice(0, LIMITS.searchQuery.max);
  if (q.length === 0) {
    search.docs = [];
    return;
  }
  const [recipes, neat] = await Promise.all([
    call('listRecipes', { query: { q, pageSize: PICKER_RECIPES } }),
    call('listIngredients', { query: { q, hasBottles: 'true', pageSize: PICKER_NEAT } }),
  ]);
  if (search.query.trim() !== typed.trim()) {
    return;
  }
  search.docs = [
    ...recipes.items.map((recipe) => recipeDoc(recipe, text('menus.groupRecipes'))),
    ...neat.items.map(neatDoc),
  ];
}

function pickDrink(event: Event, onChange: (value: unknown) => void): void {
  const doc = detailValue(event);
  if (typeof doc !== 'object' || doc === null || !('id' in doc) || typeof doc.id !== 'string') {
    return;
  }
  const drink = picked.get(doc.id);
  if (drink !== undefined) {
    onChange(drink);
  }
}

function thumb(drink: Drink): TemplateResult {
  if (drink.image === null) {
    return html`<cl-plate class="cl-menu-item-thumb" small kind=${drink.kind === 'recipe' ? 'glass' : 'rocks'} name=${drink.name}></cl-plate>`;
  }
  return html`<lc-image
    class="cl-menu-item-thumb"
    src=${drink.image.url}
    alt=""
    placeholder=${drink.image.thumbhash === null ? nothing : thumbHashDataUrl(drink.image.thumbhash)}
  ></lc-image>`;
}

registerFormFieldRenderer('menu-section', (_field, value, onChange, template) => {
  return template`<input
    class="cl-menu-section-name"
    aria-label=${text('menus.sectionName')}
    maxlength=${LIMITS.sectionName.max}
    required
    .value=${stringOf(value)}
    @input=${(event: Event) => onChange(changedText(event))}
  />`;
});

registerFormFieldRenderer('menu-item', (_field, value, onChange, template) => {
  if (!isDrink(value)) {
    return template`<lc-search
      class="cl-menu-picker"
      remote
      label=${text('menus.findDrink')}
      placeholder=${text('menus.findPlaceholder')}
      limit=${PICKER_RECIPES + PICKER_NEAT}
      .groups=${[text('menus.groupCanMake'), text('menus.groupRecipes'), text('menus.groupNeat')]}
      .suggestions=${suggestions}
      @search-input=${(event: Event) => void findDrinks(event)}
      @search-select=${(event: Event) => pickDrink(event, onChange)}
    ></lc-search>`;
  }
  const left = LIMITS.hostNote.max - value.hostNote.length;
  const hiddenNow = value.hideWhenUnavailable && !value.available;
  return template`<div class=${hiddenNow ? 'cl-menu-item is-hidden' : 'cl-menu-item'}>
    ${thumb(value)}
    <div class="cl-menu-item-body">
      <span class="cl-menu-item-name">${value.name}${
        value.kind === 'ingredient'
          ? template`<span class="cl-menu-item-kind">${text('menus.neatPour')}</span>`
          : nothing
      }</span>
      <lc-input
        class="cl-menu-item-note"
        label=${text('menus.hostNote', { name: value.name })}
        value=${value.hostNote}
        hint=${left <= NOTE_COUNTER_FROM ? text('menus.left', { count: Math.max(left, 0) }) : nothing}
        @input=${(event: Event) => onChange({ ...value, hostNote: changedText(event).slice(0, LIMITS.hostNote.max) })}
      ></lc-input>
      <div class="cl-menu-item-options">
        <lc-switch
          label=${text('menus.hide')}
          ?checked=${value.hideWhenUnavailable}
          @change=${(event: Event) => onChange({ ...value, hideWhenUnavailable: changedCheck(event) })}
        ></lc-switch>
        ${hiddenNow ? template`<lc-tag class="cl-menu-item-hidden">${text('menus.hiddenNow')}</lc-tag>` : nothing}
      </div>
    </div>
  </div>`;
});

export function screen(ctx: ScreenContext): HTMLElement {
  setAppBar({ back: '/menus' });
  const element = document.createElement('section');
  element.className = 'cl-menu-editor';
  const id = Number(ctx.params.id);

  let phase: Phase = 'waiting';
  let menu: Menu | null = null;
  let formData: Record<string, unknown> = {};
  let dirty = false;
  let busy = false;
  let otherLive: MenuSummary | null = null;

  const form = (): HTMLElementTagNameMap['lc-form'] | null => element.querySelector('lc-form');
  const draft = (): MenuDraft => readDraft(formData);

  const apply = (next: Menu): void => {
    menu = next;
    formData = { ...draftOf(next) };
    dirty = false;
    phase = 'ready';
  };

  const release = router.block(async () => {
    if (!element.isConnected || !dirty) {
      release();
      return true;
    }
    const leave = await confirm({
      title: text('menus.unsavedTitle'),
      message: text('menus.unsavedBody', { name: draft().name || text('menus.newName') }),
      confirmLabel: text('menus.discard'),
      cancelLabel: text('menus.keepEditing'),
      danger: true,
    });
    if (leave) {
      release();
    }
    return leave;
  });

  const run = async (work: () => Promise<void>): Promise<void> => {
    busy = true;
    draw();
    try {
      await work();
    } finally {
      busy = false;
      draw();
    }
  };

  const showFieldErrors = (error: ApiError): boolean => {
    if (error.code !== 'validation_failed') {
      return false;
    }
    const top: Record<string, string> = {};
    for (const field of error.fields) {
      if (field.path === 'name' || field.path === 'date') {
        top[field.path] = field.message;
      }
    }
    form()?.setErrors(top);
    const rest = error.fields.filter((field) => !(field.path in top));
    toast({
      title: text('menus.checkFields'),
      message: rest.map((field) => field.message).join(' '),
      variant: 'error',
    });
    return true;
  };

  const save = async (): Promise<boolean> => {
    form()?.clearErrors();
    try {
      apply(await call('replaceMenu', { params: { id }, body: menuInput(draft()) }));
      invalidate('menus');
      return true;
    } catch (error) {
      if (!(error instanceof ApiError && showFieldErrors(error))) {
        actionFailed(error, () => void run(saveAndSay));
      }
      return false;
    }
  };

  const saveAndSay = async (): Promise<void> => {
    if (await save()) {
      toast({ title: text('menus.saved') });
    }
  };

  const addAll = async (): Promise<void> => {
    const current = draft();
    if (current.sections.length >= LIMITS.menuSections.max) {
      toast({ title: text('menus.addAllFull'), variant: 'error' });
      return;
    }
    try {
      const page = await call('listRecipes', { query: { status: 'can_make', pageSize: 1 } });
      const onMenu = new Set(
        current.sections
          .flatMap((section) =>
            section.items.filter((item) => isDrink(item) && item.kind === 'recipe' && item.available),
          )
          .map((item) => item?.refId),
      );
      const count = page.facets.canMake - onMenu.size;
      if (count <= 0) {
        toast({ title: page.facets.canMake === 0 ? text('menus.addAllNone') : text('menus.addAllAlready') });
        return;
      }
      const sure = await confirm({
        title: count === 1 ? text('menus.addOneTitle') : text('menus.addAllTitle', { count }),
        message: text('menus.addAllBody'),
        confirmLabel: count === 1 ? text('menus.addOneConfirm') : text('menus.addAllConfirm', { count }),
      });
      if (!sure) {
        return;
      }
      const sections = [...current.sections, { name: text('menus.everythingElse'), items: [] }];
      form()?.clearErrors();
      await call('replaceMenu', { params: { id }, body: menuInput({ ...current, sections }) });
      const result = await call('addMakeableToMenu', {
        params: { id },
        body: { sectionIndex: sections.length - 1 },
      });
      apply(result.menu);
      invalidate('menus');
      toast({
        title:
          result.skippedForLimit === 0
            ? text('menus.addAllDone', { count: result.added })
            : text('menus.addAllSkipped', { added: result.added, skipped: result.skippedForLimit }),
      });
    } catch (error) {
      if (!(error instanceof ApiError && showFieldErrors(error))) {
        actionFailed(error, () => void run(addAll));
      }
    }
  };

  const makeLive = async (): Promise<void> => {
    if (otherLive !== null) {
      const sure = await confirm({
        title: text('menus.makeLiveTitle', { name: draft().name }),
        message: text('menus.makeLiveBody', { other: otherLive.name }),
        confirmLabel: text('menus.makeLive'),
      });
      if (!sure) {
        return;
      }
    }
    if (dirty && !(await save())) {
      return;
    }
    try {
      apply(await call('makeMenuLive', { params: { id } }));
      otherLive = null;
      invalidate('menus');
      toast({ title: text('menus.madeLive', { name: draft().name }) });
    } catch (error) {
      actionFailed(error, () => void run(makeLive));
    }
  };

  const endLive = async (): Promise<void> => {
    const name = menu?.name ?? '';
    const sure = await confirm({
      title: text('menus.endTitle', { name }),
      message: text('menus.endBody'),
      confirmLabel: text('menus.endMenu'),
      cancelLabel: text('menus.endKeep'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    try {
      const ended = await call('endMenu', { params: { id } });
      menu = ended;
      invalidate('menus');
      toast({ title: text('menus.ended', { name }) });
    } catch (error) {
      actionFailed(error, () => void run(endLive));
    }
  };

  const rotate = async (): Promise<void> => {
    const sure = await confirm({
      title: text('menus.rotateTitle'),
      message: text('menus.rotateBody'),
      confirmLabel: text('menus.rotateConfirm'),
      cancelLabel: text('menus.rotateKeep'),
    });
    if (!sure) {
      return;
    }
    try {
      menu = await call('rotateMenuLink', { params: { id } });
      invalidate('menus');
      toast({ title: text('menus.rotated') });
    } catch (error) {
      actionFailed(error, () => void run(rotate));
    }
  };

  const fields: FormField[] = [
    { name: 'name', type: 'text', label: text('menus.name'), required: true },
    { name: 'date', type: 'date', label: text('menus.date'), required: true },
    {
      name: 'sections',
      type: 'array',
      label: text('menus.sections'),
      class: 'cl-menu-sections',
      max: LIMITS.menuSections.max,
      addLabel: text('menus.addSection'),
      emptyLabel: text('menus.noSections'),
      actions: [{ label: text('menus.addAll'), icon: 'plus', onClick: () => void run(addAll) }],
      itemFields: [
        { name: 'name', type: 'menu-section', defaultValue: text('menus.newSection') },
        {
          name: 'items',
          type: 'array',
          label: text('menus.drinksLabel'),
          addLabel: text('menus.addDrinks'),
          emptyLabel: text('menus.noDrinks'),
          defaultValue: [],
          itemField: { name: 'drink', type: 'menu-item' },
        },
      ],
    },
  ];

  const onFieldChange = (): void => {
    const current = form();
    if (current === null) {
      return;
    }
    formData = current.data;
    dirty = true;
    draw();
  };

  const linkPanel = (live: Menu): TemplateResult => {
    if (live.link === null) {
      return html``;
    }
    const url = `${location.origin}${live.link.path}`;
    const cut = live.link.path.lastIndexOf('/') + 1;
    const token = normalizeMenuToken(live.link.path.slice(cut));
    const shown =
      token === null ? url : `${location.origin}${live.link.path.slice(0, cut)}${formatMenuTokenForDisplay(token)}`;
    return html`
      <h2 class="cl-menu-panel-title">${text('menus.liveTitle')}</h2>
      <p class="cl-menu-panel-text">${text('menus.liveBody')}</p>
      <div class="cl-menu-link">
        <code class="cl-menu-link-code" aria-label=${text('menus.link')}>${shown}</code>
        <lc-clipboard
          text=${url}
          label=${text('menus.copyLink')}
          icon-only
          @copy=${() => toast({ title: text('menus.linkCopied') })}
        ></lc-clipboard>
      </div>
      <div class="cl-menu-qr">
        <cl-qr value=${url}></cl-qr>
        <p class="cl-menu-panel-text">${text('menus.qrHint')}</p>
      </div>
      <p class="cl-menu-panel-text cl-menu-tier" aria-live="polite">${tierText(shownOnTv(draft()))}</p>
      <div class="cl-menu-panel-actions">
        <lc-button variant="quiet" @click=${() => window.open(url, '_blank', 'noopener')}>
          <lc-icon name="external-link" aria-hidden="true"></lc-icon>${text('menus.openDisplay')}
        </lc-button>
        <lc-button variant="quiet" ?disabled=${busy} @click=${() => void run(rotate)}>
          <lc-icon name="refresh-cw" aria-hidden="true"></lc-icon>${text('menus.newLink')}
        </lc-button>
        <lc-button variant="quiet" class="cl-menu-end" ?disabled=${busy} @click=${() => void run(endLive)}>
          ${text('menus.endMenu')}
        </lc-button>
      </div>
    `;
  };

  const draftPanel = (): TemplateResult => html`
    <h2 class="cl-menu-panel-title">${text('menus.draftTitle')}</h2>
    <p class="cl-menu-panel-text">
      ${otherLive === null ? text('menus.draftBody') : text('menus.draftBodyOther', { name: otherLive.name })}
    </p>
    <p class="cl-menu-panel-text cl-menu-tier" aria-live="polite">${tierText(shownOnTv(draft()))}</p>
    <lc-button variant="primary" class="cl-menu-make-live" ?disabled=${busy} @click=${() => void run(makeLive)}>
      <lc-icon name="tv" aria-hidden="true"></lc-icon>${text('menus.makeLive')}
    </lc-button>
  `;

  const failedState = (): TemplateResult => html`<lc-empty-state
    title=${text('loadFailed.title', { screen: text('title.menu') })}
    description=${text('loadFailed.body')}
  >
    ${illustration('empty-lost')}
    <lc-button variant="primary" @click=${() => void load()}>${text('loadFailed.retry')}</lc-button>
  </lc-empty-state>`;

  const missingState = (): TemplateResult => html`<lc-empty-state
    title=${text('menus.notFoundTitle')}
    description=${text('menus.notFoundBody')}
  >
    ${illustration('empty-menu')}
    <lc-button variant="primary" href="/menus">${text('menus.backToMenus')}</lc-button>
  </lc-empty-state>`;

  const editor = (current: Menu): TemplateResult => {
    const onTv = shownOnTv(draft());
    return html`
      <div class="cl-menu-edit">
        <div class="cl-menu-main">
          <h1 class="cl-vh">${current.name}</h1>
          <lc-form .fields=${fields} .data=${formData} @field-change=${onFieldChange}></lc-form>
          ${onTv > PAGE_SIZE ? html`<lc-alert variant="info" title=${text('menus.pagedNotice')}></lc-alert>` : nothing}
          <div class="cl-menu-save">
            <lc-button variant="primary" ?disabled=${!dirty || busy} @click=${() => void run(saveAndSay)}>
              ${text('menus.save')}
            </lc-button>
          </div>
        </div>
        <aside class="cl-menu-panel" aria-label=${current.live ? text('menus.liveTitle') : text('menus.draftTitle')}>
          ${current.live ? linkPanel(current) : draftPanel()}
        </aside>
      </div>
    `;
  };

  function draw(): void {
    let content: TemplateResult | HTMLElement;
    if (phase === 'failed') {
      content = failedState();
    } else if (phase === 'missing') {
      content = missingState();
    } else if (menu === null) {
      content = phase === 'slow' ? skeleton('lines', text('title.menu')) : html``;
    } else {
      content = editor(menu);
    }
    render(html`${content}`, element);
  }

  async function load(): Promise<void> {
    if (!Number.isInteger(id) || id < 1) {
      phase = 'missing';
      draw();
      return;
    }
    phase = 'waiting';
    draw();
    // D-1 §8.26: skeletons appear only when a response takes longer than 300 ms.
    setTimeout(() => {
      if (phase === 'waiting') {
        phase = 'slow';
        draw();
      }
    }, 300);
    try {
      const [loaded, live, can] = await Promise.all([
        call('getMenu', { params: { id } }),
        call('listMenus', { query: { pageSize: 1 } }),
        call('listRecipes', { query: { status: 'can_make', pageSize: PICKER_RECIPES } }),
      ]);
      const first = live.items[0];
      otherLive = first?.live && first.id !== id ? first : null;
      picked.clear();
      suggestions = can.items.map((recipe) => recipeDoc(recipe, text('menus.groupCanMake')));
      apply(loaded);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      phase = error.code === 'not_found' ? 'missing' : 'failed';
    }
    draw();
  }

  void load();
  return element;
}
