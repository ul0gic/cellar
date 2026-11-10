import {
  formatMenuTokenForDisplay,
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
import { registerFormFieldRenderer } from '@lightstart/components/form/field-renderers.js';
import type { FormField, SearchDoc } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { batch, effect, signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { type Drink, menusEditor } from '../../app/controllers/menus-editor.ts';
import { eventChecked, eventDetail, eventText } from '../../app/events.ts';
import { type LoadPhase, loadState } from '../../app/load.ts';
import { actionFailed, formErrors } from '../../app/problems.ts';
import { apiResource, dataChanged, SKELETON_DELAY_MS } from '../../app/resources.ts';
import { blockWhile, href } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import type { RouteParams } from '../../app/types.ts';
import '../../design-system/cl-live-card.ts';
import '../../design-system/cl-plate.ts';
import '../../design-system/cl-qr.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { illustration } from '../../design-system/illustration.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/clipboard.ts';
import '../../design-system/lc/empty-state.ts';
import '../../design-system/lc/form.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/input.ts';
import '../../design-system/lc/search.ts';
import '../../design-system/lc/switch.ts';
import '../../design-system/lc/tag.ts';
import { loadFailed } from '../../design-system/load-view.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import './editor.css';

interface SectionDraft {
  readonly name: string;
  readonly items: readonly (Drink | null)[];
}

interface MenuDraft {
  readonly name: string;
  readonly date: string;
  readonly sections: readonly SectionDraft[];
}

// D-1 §9.16 density tiers: grand up to 6 visible drinks, standard up to 9, compact up to 16, then 16 per page.
const GRAND_MAX = 6;
const STANDARD_MAX = 9;
const PAGE_SIZE = 16;
// D-1 §9.15: the host-note counter appears with 20 characters left (at 60 of 80).
const NOTE_COUNTER_FROM = 20;
const PICKER_RECIPES = 6;
const PICKER_NEAT = 4;

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

function recipeDoc(recipe: RecipeSummary, group: string): SearchDoc {
  const id = `recipe:${recipe.id}`;
  menusEditor.remember(id, {
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
  menusEditor.remember(id, {
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
  const typed = eventDetail(event);
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
  const doc = eventDetail(event);
  if (typeof doc !== 'object' || doc === null || !('id' in doc) || typeof doc.id !== 'string') {
    return;
  }
  const drink = menusEditor.recall(doc.id);
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
    @input=${(event: Event) => onChange(eventText(event))}
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
      .suggestions=${menusEditor.suggestions.value}
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
        @input=${(event: Event) => onChange({ ...value, hostNote: eventText(event).slice(0, LIMITS.hostNote.max) })}
      ></lc-input>
      <div class="cl-menu-item-options">
        <lc-switch
          label=${text('menus.hide')}
          ?checked=${value.hideWhenUnavailable}
          @change=${(event: Event) => onChange({ ...value, hideWhenUnavailable: eventChecked(event) })}
        ></lc-switch>
        ${hiddenNow ? template`<lc-tag class="cl-menu-item-hidden">${text('menus.hiddenNow')}</lc-tag>` : nothing}
      </div>
    </div>
  </div>`;
});

export const tag = 'cl-screen-menus-editor';

class MenuEditor extends View {
  params: RouteParams = {};

  readonly menu = signal<Menu | null>(null);
  readonly formData = signal<Record<string, unknown>>({});
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly asked = signal(false);
  readonly fresh = signal(false);
  readonly late = signal(false);
  readonly otherLive = signal<MenuSummary | null>(null);

  readonly menuRead = apiResource('getMenu', ['menus']);
  readonly liveRead = apiResource('listMenus', ['menus']);
  readonly canMakeRead = apiResource('listRecipes', ['recipes', 'shelf']);
  readonly state = loadState([this.menuRead, this.liveRead, this.canMakeRead]);

  readonly fields: FormField[] = [
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
      actions: [{ label: text('menus.addAll'), icon: 'plus', onClick: () => void this.run(() => this.addAll()) }],
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

  constructor() {
    super();
    menusEditor.reset();
  }

  get menuId(): number {
    return Number(this.params.id);
  }

  get validId(): boolean {
    return Number.isInteger(this.menuId) && this.menuId >= 1;
  }

  connected(): void {
    setAppBar({ back: '/menus' });
    this.classList.add('cl-menu-editor');
    if (this.validId) {
      this.menuRead.bind(this, { params: { id: this.menuId } });
      if (!this.asked.peek()) {
        this.asked.value = true;
        if (this.menuRead.value.peek() === undefined) {
          this.fresh.value = true;
        } else {
          void this.renew();
        }
      }
      this.liveRead.bind(this, { query: { pageSize: 1 } });
      this.canMakeRead.bind(this, { query: { status: 'can_make', pageSize: PICKER_RECIPES } });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clock = effect(() => {
      const waiting = this.asked.value && !this.fresh.value && this.menuRead.error.value === null;
      clearTimeout(timer);
      timer = undefined;
      if (waiting) {
        timer = setTimeout(() => {
          this.late.value = true;
        }, SKELETON_DELAY_MS);
      } else {
        this.late.value = false;
      }
    });
    this.$own(() => {
      clock.dispose();
      clearTimeout(timer);
    });
    const fill = effect(() => {
      const loaded = this.menuRead.value.value;
      const live = this.liveRead.value.value;
      const canMake = this.canMakeRead.value.value;
      if (
        !this.fresh.value ||
        loaded === undefined ||
        live === undefined ||
        canMake === undefined ||
        this.menu.peek() !== null
      ) {
        return;
      }
      batch(() => {
        const first = live.items[0];
        this.otherLive.value = first?.live && first.id !== this.menuId ? first : null;
        menusEditor.suggestions.value = canMake.items.map((recipe) => recipeDoc(recipe, text('menus.groupCanMake')));
        this.apply(loaded);
      });
    });
    this.$own(() => fill.dispose());
    blockWhile(
      this,
      () => this.dirty.value,
      () => this.askToLeave(),
    );
    this.$own(() => {
      queueMicrotask(() => {
        if (!this.isConnected) {
          void this.discardIfBlank();
        }
      });
    });
  }

  async renew(): Promise<void> {
    await this.menuRead.refresh();
    this.fresh.value = this.menuRead.error.peek() === null;
  }

  retry(): void {
    if (this.fresh.peek()) {
      this.state.retry();
    } else {
      void this.renew();
    }
  }

  phase(): LoadPhase {
    if (this.fresh.value) {
      return this.state.phase.value;
    }
    if (this.menuRead.error.value !== null) {
      return 'failed';
    }
    return this.late.value ? 'slow' : 'loading';
  }

  form(): HTMLElementTagNameMap['lc-form'] | null {
    return this.querySelector('lc-form');
  }

  draft(): MenuDraft {
    return readDraft(this.formData.peek());
  }

  apply(next: Menu): void {
    batch(() => {
      this.menu.value = next;
      this.formData.value = { ...draftOf(next) };
      this.dirty.value = false;
    });
  }

  async discardIfBlank(): Promise<void> {
    const menu = this.menu.peek();
    const blank =
      menu !== null &&
      !menu.live &&
      menu.sections.length === 0 &&
      menu.name === text('menus.newName') &&
      menu.updatedAt === menu.createdAt;
    if (!blank) {
      return;
    }
    try {
      await call('deleteMenu', { params: { id: this.menuId } });
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'not_found')) {
        actionFailed(error, () => void this.discardIfBlank());
        return;
      }
    }
    dataChanged('menus');
  }

  askToLeave(): Promise<boolean> {
    return confirm(this, {
      title: text('menus.unsavedTitle'),
      message: text('menus.unsavedBody', { name: this.draft().name || text('menus.newName') }),
      confirmLabel: text('menus.discard'),
      cancelLabel: text('menus.keepEditing'),
      danger: true,
    });
  }

  async run(work: () => Promise<void>): Promise<void> {
    this.busy.value = true;
    try {
      await work();
    } finally {
      this.busy.value = false;
    }
  }

  showFieldErrors(error: ApiError): boolean {
    if (error.code !== 'validation_failed') {
      return false;
    }
    const { fields, rest } = formErrors(error, ['name', 'date']);
    this.form()?.setErrors(fields);
    toast({
      title: text('menus.checkFields'),
      message: rest.map((field) => field.message).join(' '),
      variant: 'error',
    });
    return true;
  }

  async save(): Promise<boolean> {
    this.form()?.clearErrors();
    try {
      this.apply(await call('replaceMenu', { params: { id: this.menuId }, body: menuInput(this.draft()) }));
      dataChanged('menus');
      return true;
    } catch (error) {
      if (!(error instanceof ApiError && this.showFieldErrors(error))) {
        actionFailed(error, () => void this.run(() => this.saveAndSay()));
      }
      return false;
    }
  }

  async saveAndSay(): Promise<void> {
    if (await this.save()) {
      toast({ title: text('menus.saved') });
    }
  }

  async addAll(): Promise<void> {
    const current = this.draft();
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
      const sure = await confirm(this, {
        title: count === 1 ? text('menus.addOneTitle') : text('menus.addAllTitle', { count }),
        message: text('menus.addAllBody'),
        confirmLabel: count === 1 ? text('menus.addOneConfirm') : text('menus.addAllConfirm', { count }),
      });
      if (!sure) {
        return;
      }
      const sections = [...current.sections, { name: text('menus.everythingElse'), items: [] }];
      this.form()?.clearErrors();
      await call('replaceMenu', { params: { id: this.menuId }, body: menuInput({ ...current, sections }) });
      const result = await call('addMakeableToMenu', {
        params: { id: this.menuId },
        body: { sectionIndex: sections.length - 1 },
      });
      this.apply(result.menu);
      dataChanged('menus');
      const addedDrinks = result.added === 1 ? text('menus.drink') : text('menus.drinks', { count: result.added });
      toast({
        title:
          result.skippedForLimit === 0
            ? text('menus.addAllDone', { drinks: addedDrinks })
            : text('menus.addAllSkipped', { drinks: addedDrinks, skipped: result.skippedForLimit }),
      });
    } catch (error) {
      if (!(error instanceof ApiError && this.showFieldErrors(error))) {
        actionFailed(error, () => void this.run(() => this.addAll()));
      }
    }
  }

  async makeLive(): Promise<void> {
    const other = this.otherLive.peek();
    if (other !== null) {
      const sure = await confirm(this, {
        title: text('menus.makeLiveTitle', { name: this.draft().name }),
        message: text('menus.makeLiveBody', { other: other.name }),
        confirmLabel: text('menus.makeLive'),
      });
      if (!sure) {
        return;
      }
    }
    if (this.dirty.peek() && !(await this.save())) {
      return;
    }
    try {
      this.apply(await call('makeMenuLive', { params: { id: this.menuId } }));
      this.otherLive.value = null;
      dataChanged('menus');
      toast({ title: text('menus.madeLive', { name: this.draft().name }) });
    } catch (error) {
      actionFailed(error, () => void this.run(() => this.makeLive()));
    }
  }

  async endLive(): Promise<void> {
    const name = this.menu.peek()?.name ?? '';
    const sure = await confirm(this, {
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
      this.menu.value = await call('endMenu', { params: { id: this.menuId } });
      dataChanged('menus');
      toast({ title: text('menus.ended', { name }) });
    } catch (error) {
      actionFailed(error, () => void this.run(() => this.endLive()));
    }
  }

  async rotate(): Promise<void> {
    const sure = await confirm(this, {
      title: text('menus.rotateTitle'),
      message: text('menus.rotateBody'),
      confirmLabel: text('menus.rotateConfirm'),
      cancelLabel: text('menus.rotateKeep'),
    });
    if (!sure) {
      return;
    }
    try {
      this.menu.value = await call('rotateMenuLink', { params: { id: this.menuId } });
      dataChanged('menus');
      toast({ title: text('menus.rotated') });
    } catch (error) {
      actionFailed(error, () => void this.run(() => this.rotate()));
    }
  }

  onFieldChange(): void {
    const current = this.form();
    if (current === null) {
      return;
    }
    this.formData.value = current.data;
    this.dirty.value = true;
  }

  linkPanel(live: Menu, onTv: number): TemplateResult {
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
      <p class="cl-menu-panel-text cl-menu-tier" aria-live="polite">${tierText(onTv)}</p>
      <div class="cl-menu-panel-actions">
        <lc-button variant="quiet" @click=${() => window.open(url, '_blank', 'noopener')}>
          <lc-icon name="external-link" aria-hidden="true"></lc-icon>${text('menus.openDisplay')}
        </lc-button>
        <lc-button variant="quiet" ?disabled=${this.busy.value} @click=${() => void this.run(() => this.rotate())}>
          <lc-icon name="refresh-cw" aria-hidden="true"></lc-icon>${text('menus.newLink')}
        </lc-button>
        <lc-button variant="quiet" class="cl-menu-end" ?disabled=${this.busy.value} @click=${() => void this.run(() => this.endLive())}>
          ${text('menus.endMenu')}
        </lc-button>
      </div>
    `;
  }

  draftPanel(onTv: number): TemplateResult {
    const other = this.otherLive.value;
    return html`
      <h2 class="cl-menu-panel-title">${text('menus.draftTitle')}</h2>
      <p class="cl-menu-panel-text">
        ${other === null ? text('menus.draftBody') : text('menus.draftBodyOther', { name: other.name })}
      </p>
      <p class="cl-menu-panel-text cl-menu-tier" aria-live="polite">${tierText(onTv)}</p>
      <lc-button variant="primary" class="cl-menu-make-live" ?disabled=${this.busy.value} @click=${() => void this.run(() => this.makeLive())}>
        <lc-icon name="tv" aria-hidden="true"></lc-icon>${text('menus.makeLive')}
      </lc-button>
    `;
  }

  missingState(): TemplateResult {
    return html`<lc-empty-state title=${text('menus.notFoundTitle')} description=${text('menus.notFoundBody')}>
      ${illustration('empty-menu')}
      <lc-button variant="primary" href=${href('/menus')}>${text('menus.backToMenus')}</lc-button>
    </lc-empty-state>`;
  }

  editor(current: Menu): TemplateResult {
    const onTv = shownOnTv(readDraft(this.formData.value));
    return html`
      <div class="cl-menu-edit">
        <div class="cl-menu-main">
          <h1 class="cl-vh">${current.name}</h1>
          <lc-form .fields=${this.fields} .data=${this.formData.value} @field-change=${() => this.onFieldChange()}></lc-form>
          ${onTv > PAGE_SIZE ? html`<lc-alert variant="info" title=${text('menus.pagedNotice')}></lc-alert>` : nothing}
          <div class="cl-menu-save">
            <lc-button variant="primary" ?disabled=${!this.dirty.value || this.busy.value} @click=${() => void this.run(() => this.saveAndSay())}>
              ${text('menus.save')}
            </lc-button>
          </div>
        </div>
        <aside class="cl-menu-panel" aria-label=${current.live ? text('menus.liveTitle') : text('menus.draftTitle')}>
          ${current.live ? this.linkPanel(current, onTv) : this.draftPanel(onTv)}
        </aside>
      </div>
    `;
  }

  render() {
    if (!this.validId) {
      return this.missingState();
    }
    const current = this.menu.value;
    if (current !== null) {
      return this.editor(current);
    }
    switch (this.phase()) {
      case 'failed':
        return this.menuRead.error.value?.code === 'not_found'
          ? this.missingState()
          : loadFailed(text('title.menu'), () => this.retry(), 'none');
      case 'slow':
        return html`${skeleton('lines', text('title.menu'))}`;
      case 'loading':
      case 'ready':
        return html``;
    }
  }
}

View.register(tag, MenuEditor);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: MenuEditor;
  }
}
