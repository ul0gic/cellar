import {
  type FieldError,
  type ImageRef,
  LIMITS,
  parseAmount,
  type Recipe,
  type RecipeDraft,
  type RecipeInput,
  type RecipeLineInput,
} from '@cellar/contract';
import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal, untracked } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { eventText } from '../../app/events.ts';
import { type LoadPhase, loadState } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { blockWhile, href, navigate } from '../../app/router.ts';
import type { RouteParams } from '../../app/types.ts';
import type { ImageUpload } from '../../design-system/cl-image-field.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { loadFailed } from '../../design-system/load-view.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { openActions } from './parts/actions.ts';
import { openPhotoSheet } from './parts/ai-sheets.ts';
import { BLANK_LINE, type LineDraft, toUnit } from './parts/line-fields.ts';
import { openSheet } from './parts/sheet.ts';
import { notFound } from './parts/view.ts';
import '../../design-system/cl-image-field.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/form.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/input.ts';
import '../../design-system/lc/progress-bar.ts';
import '../../design-system/lc/tag.ts';
import '../../design-system/lc/textarea.ts';
import './form.css';

export const tag = 'cl-screen-recipes-form';

interface Values {
  name: string;
  description: string;
  lines: LineDraft[];
  instructions: string;
  glassId: string;
  methodId: string;
  garnish: string;
  year: string;
  tags: string[];
  utensilIds: string[];
  source: string;
}

type Notice = { readonly kind: 'draft'; readonly title: string; readonly body: string } | null;

function emptyValues(): Values {
  return {
    name: '',
    description: '',
    lines: [BLANK_LINE],
    instructions: '',
    glassId: '',
    methodId: '',
    garnish: '',
    year: '',
    tags: [],
    utensilIds: [],
    source: '',
  };
}

function amountText(amount: number | null): string {
  return amount === null ? '' : String(amount);
}

function valuesOf(recipe: Recipe): Values {
  return {
    name: recipe.name,
    description: recipe.description,
    lines: recipe.lines.map((line) => ({
      ingredient: { id: line.ingredient.id, name: line.ingredient.name },
      ingredientText: '',
      amount: amountText(line.amount),
      amountMax: amountText(line.amountMax),
      unit: line.unit ?? '',
      optional: line.optional,
      specified: line.specified,
      note: line.note,
      substitutes: line.substitutes.map((substitute) => ({
        ingredient: { id: substitute.ingredient.id, name: substitute.ingredient.name },
        amount: substitute.amount,
        amountMax: substitute.amountMax,
        unit: substitute.unit,
      })),
      error: '',
    })),
    instructions: recipe.instructions,
    glassId: recipe.glass === null ? '' : String(recipe.glass.id),
    methodId: recipe.method === null ? '' : String(recipe.method.id),
    garnish: recipe.garnish,
    year: recipe.year === null ? '' : String(recipe.year),
    tags: recipe.tags.map((entry) => entry.name),
    utensilIds: recipe.utensils.map((utensil) => String(utensil.id)),
    source: recipe.source,
  };
}

function isDraft(value: unknown): value is RecipeDraft {
  return (
    typeof value === 'object' &&
    value !== null &&
    'recipe' in value &&
    typeof value.recipe === 'object' &&
    value.recipe !== null &&
    'lines' in value.recipe &&
    Array.isArray(value.recipe.lines)
  );
}

function draftFromHistory(): RecipeDraft | null {
  const state: unknown = history.state;
  if (typeof state === 'object' && state !== null && 'draft' in state && isDraft(state.draft)) {
    return state.draft;
  }
  return null;
}

function describeRequested(): boolean {
  const state: unknown = history.state;
  return typeof state === 'object' && state !== null && 'describe' in state && state.describe === true;
}

function valuesOfDraft(draft: RecipeDraft): Values {
  const recipe = draft.recipe;
  return {
    name: recipe.name,
    description: recipe.description,
    lines: recipe.lines.map((line) => ({
      ingredient: line.ingredientId === null ? null : { id: line.ingredientId, name: line.ingredientText },
      ingredientText: line.ingredientText,
      amount: amountText(line.amount),
      amountMax: amountText(line.amountMax),
      unit: line.unit ?? '',
      optional: line.optional,
      specified: line.specified,
      note: line.note,
      substitutes: [],
      error: line.ingredientId === null ? text('recipes.errorIngredient') : '',
    })),
    instructions: recipe.instructions,
    glassId: recipe.glassId === null ? '' : String(recipe.glassId),
    methodId: recipe.methodId === null ? '' : String(recipe.methodId),
    garnish: recipe.garnish,
    year: recipe.year === null ? '' : String(recipe.year),
    tags: [...recipe.tags],
    utensilIds: recipe.utensilIds.map(String),
    source: draft.sourceUrl ?? recipe.source,
  };
}

function draftNotice(draft: RecipeDraft): Notice {
  const total = draft.recipe.lines.length;
  const matched = draft.recipe.lines.filter((line) => line.ingredientId !== null).length;
  const unmatched = draft.recipe.lines.flatMap((line, index) => (line.ingredientId === null ? [index + 1] : []));
  let host = '';
  if (draft.sourceUrl !== null && URL.canParse(draft.sourceUrl)) {
    host = new URL(draft.sourceUrl).hostname;
  }
  return {
    kind: 'draft',
    title: draft.source === 'ai' || host === '' ? text('recipes.draftedTitle') : text('recipes.readFrom', { host }),
    body: [
      text('recipes.draftMatched', { matched, total }),
      unmatched.length === 0
        ? ''
        : text(unmatched.length === 1 ? 'recipes.draftUnmatchedOne' : 'recipes.draftUnmatched', {
            lines: unmatched.join(', '),
          }),
      text('recipes.draftNotSaved'),
    ]
      .filter((part) => part !== '')
      .join(' '),
  };
}

function joinSentence(parts: readonly string[]): string {
  if (parts.length <= 1) {
    return parts.join('');
  }
  return `${parts.slice(0, -1).join(', ')} ${text('recipes.and')} ${parts.at(-1)}`;
}

function capitalised(sentence: string): string {
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

interface Built {
  readonly input: RecipeInput | null;
  readonly problems: readonly string[];
  readonly values: Values;
  readonly nameError: string;
}

function lineInput(
  line: LineDraft,
  position: number,
  problems: string[],
): { line: LineDraft; input: RecipeLineInput | null } {
  const amount = line.amount.trim() === '' ? null : parseAmount(line.amount);
  const amountMax = line.amountMax.trim() === '' ? null : parseAmount(line.amountMax);
  let error = '';
  if ((line.amount.trim() !== '' && amount === null) || (line.amountMax.trim() !== '' && amountMax === null)) {
    error = text('recipes.errorAmount');
    problems.push(text('recipes.problemAmount', { position }));
  } else if (amount !== null && amountMax !== null && amountMax <= amount) {
    error = text('recipes.errorMax');
    problems.push(text('recipes.problemMax', { position }));
  } else if (line.ingredient === null) {
    error = text('recipes.errorIngredient');
    problems.push(text('recipes.problemIngredient', { position }));
  }
  if (error !== '' || line.ingredient === null) {
    return { line: { ...line, error }, input: null };
  }
  return {
    line: { ...line, error: '' },
    input: {
      ingredientId: line.ingredient.id,
      amount,
      amountMax,
      unit: toUnit(line.unit),
      optional: line.optional,
      specified: line.specified,
      note: line.note.trim(),
      substitutes: line.substitutes.map((substitute) => ({
        ingredientId: substitute.ingredient.id,
        amount: substitute.amount,
        amountMax: substitute.amountMax,
        unit: substitute.unit,
      })),
    },
  };
}

function build(values: Values, images: readonly ImageRef[], parentId: number | null): Built {
  const problems: string[] = [];
  const nameError = values.name.trim() === '' ? text('recipes.errorName') : '';
  if (nameError !== '') {
    problems.push(text('recipes.problemName'));
  }
  if (values.lines.length === 0) {
    problems.push(text('recipes.problemNoLines'));
  }
  const checked = values.lines.map((line, index) => lineInput(line, index + 1, problems));
  const lines = checked.flatMap((item) => (item.input === null ? [] : [item.input]));
  const year = values.year.trim() === '' ? null : Number(values.year);
  const next = { ...values, lines: checked.map((item) => item.line) };
  if (problems.length > 0 || (year !== null && !Number.isInteger(year))) {
    return { input: null, problems, values: next, nameError };
  }
  return {
    input: {
      name: values.name.trim(),
      description: values.description,
      instructions: values.instructions,
      garnish: values.garnish,
      source: values.source,
      year,
      glassId: values.glassId === '' ? null : Number(values.glassId),
      methodId: values.methodId === '' ? null : Number(values.methodId),
      utensilIds: values.utensilIds.map(Number),
      tags: values.tags,
      imageIds: images.map((image) => image.id),
      parentId,
      lines,
    },
    problems,
    values: next,
    nameError,
  };
}

function withServerErrors(
  values: Values,
  fields: readonly FieldError[],
): { values: Values; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  let lines = values.lines;
  for (const field of fields) {
    const [head, index] = field.path.split('.');
    if (head === 'lines' && index !== undefined && Number.isInteger(Number(index))) {
      const at = Number(index);
      lines = lines.map((line, position) => (position === at ? { ...line, error: field.message } : line));
    } else if (head !== undefined) {
      errors[head] = field.message;
    }
  }
  return { values: { ...values, lines }, errors };
}

const tagsHandler = {
  tags: {
    render: (_field: FormField, value: unknown, onChange: (next: unknown) => void): TemplateResult => {
      const names = Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
      return html`<div class="cl-tags-field">
        <span class="cl-tags-list">
          ${names.map(
            (name) => html`<lc-tag
              closable
              aria-label=${text('recipes.removeTag', { name })}
              @close=${() => onChange(names.filter((item) => item !== name))}
            >${name}</lc-tag>`,
          )}
        </span>
        ${
          names.length < LIMITS.recipeTags.max
            ? html`<lc-input
                label=${text('recipes.addTag')}
                maxlength=${LIMITS.tagName.max}
                @keydown=${(event: KeyboardEvent) => {
                  const target = event.target;
                  if (event.key !== 'Enter' || !(target instanceof HTMLInputElement)) {
                    return;
                  }
                  event.preventDefault();
                  const name = target.value.trim();
                  if (name !== '' && !names.includes(name)) {
                    onChange([...names, name]);
                  }
                  target.value = '';
                }}
              ></lc-input>`
            : nothing
        }
      </div>`;
    },
  },
};

function options(items: readonly { id: number; name: string }[] | undefined): { value: string; label: string }[] {
  return (items ?? []).map((item) => ({ value: String(item.id), label: item.name }));
}

class RecipesForm extends View {
  params: RouteParams = {};
  readonly values = signal<Values | null>(null);
  readonly images = signal<readonly ImageRef[]>([]);
  readonly notice = signal<Notice>(null);
  readonly problems = signal<readonly string[]>([]);
  readonly errors = signal<Record<string, string>>({});
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly asked = signal(false);
  readonly fresh = signal(false);
  readonly glasses = apiResource('listGlasses', []);
  readonly methods = apiResource('listMethods', []);
  readonly utensils = apiResource('listUtensils', []);
  readonly recipe = apiResource('getRecipe', []);
  readonly lists = loadState([this.glasses, this.methods, this.utensils]);
  readonly record = loadState([this.recipe]);

  get editId(): number | null {
    return this.params.id === undefined ? null : Number(this.params.id);
  }

  get valid(): boolean {
    const id = this.editId;
    return id === null || (Number.isSafeInteger(id) && id >= 1);
  }

  get backPath(): string {
    return this.editId === null ? '/recipes' : `/recipes/${this.editId}`;
  }

  get existing(): Recipe | null {
    return this.editId === null ? null : (this.recipe.value.value ?? null);
  }

  recordPhase(): LoadPhase {
    if (this.fresh.value) {
      return this.record.phase.value;
    }
    return this.record.error.value === null ? 'loading' : 'failed';
  }

  async renew(): Promise<void> {
    await this.recipe.refresh();
    if (this.isConnected) {
      this.fresh.value = this.recipe.error.peek() === null;
    }
  }

  status(): LoadPhase {
    const phases = [this.lists.phase.value, ...(this.editId === null ? [] : [this.recordPhase()])];
    if (phases.every((phase) => phase === 'ready')) {
      return 'ready';
    }
    if (phases.includes('failed')) {
      return 'failed';
    }
    return phases.includes('slow') ? 'slow' : 'loading';
  }

  connected(): void {
    this.classList.add('cl-recipe-form', 'cl-reading');
    if (!this.valid) {
      return;
    }
    this.glasses.bind(this, {});
    this.methods.bind(this, {});
    this.utensils.bind(this, {});
    const editId = this.editId;
    if (editId !== null) {
      this.recipe.bind(this, { params: { id: editId } });
      if (!this.asked.peek()) {
        this.asked.value = true;
        if (this.recipe.value.peek() === undefined) {
          this.fresh.value = true;
        } else {
          void this.renew();
        }
      }
    }
    blockWhile(
      this,
      () => this.dirty.value,
      () =>
        confirm(this, {
          title: text('recipes.leaveTitle'),
          message:
            this.existing === null
              ? text('recipes.leaveBodyNew')
              : text('recipes.leaveBody', { name: this.existing.name }),
          confirmLabel: text('recipes.discardChanges'),
          cancelLabel: text('recipes.keepEditing'),
          danger: true,
        }),
    );
    const fill = effect(() => {
      if (this.status() === 'ready' && this.values.peek() === null) {
        untracked(() => this.fill());
      }
    });
    this.$own(() => fill.dispose());
  }

  fill(): void {
    const existing = this.existing;
    const draft = draftFromHistory();
    if (existing !== null) {
      this.values.value = valuesOf(existing);
      this.images.value = [...existing.images];
    } else if (draft !== null) {
      this.applyDraft(draft);
    } else {
      this.values.value = emptyValues();
    }
    if (existing === null && draft === null && describeRequested()) {
      this.draftFromText();
    }
  }

  changed(patch: Partial<Values>): void {
    const values = this.values.peek();
    if (values !== null) {
      this.values.value = { ...values, ...patch };
      this.dirty.value = true;
    }
  }

  applyDraft(draft: RecipeDraft): void {
    this.values.value = valuesOfDraft(draft);
    this.notice.value = draftNotice(draft);
    this.dirty.value = true;
  }

  async upload(picked: ImageUpload, sheet: { close(): void }): Promise<void> {
    const form = new FormData();
    form.append('file', picked.file, 'photo.webp');
    form.append('purpose', picked.purpose);
    form.append('width', String(picked.width));
    form.append('height', String(picked.height));
    form.append('thumbhash', picked.thumbhash);
    try {
      const image = await call('uploadImage', { body: form });
      sheet.close();
      if (this.isConnected) {
        this.images.value = [...this.images.peek(), image];
        this.dirty.value = true;
      }
    } catch (error) {
      actionFailed(error, () => void this.upload(picked, sheet));
    }
  }

  addPhoto(): void {
    const sheet = openSheet(this, {
      centered: true,
      heading: () => text('recipes.cropHeading'),
      body: () =>
        html`<cl-image-field purpose="recipe" .change=${(picked: ImageUpload) => void this.upload(picked, sheet)}></cl-image-field>`,
      footer: () => html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>`,
    });
  }

  movePhoto(index: number, by: number): void {
    const to = index + by;
    const next = [...this.images.peek()];
    const moving = next[index];
    const other = next[to];
    if (moving === undefined || other === undefined) {
      return;
    }
    next[index] = other;
    next[to] = moving;
    this.images.value = next;
    this.dirty.value = true;
  }

  photoMenu(trigger: Element, index: number): void {
    const name = text('recipes.photoNumber', { position: index + 1 });
    openActions(this, trigger, name, [
      {
        label: text('recipes.photoLeft'),
        icon: 'chevron-left',
        disabled: index === 0,
        onClick: () => this.movePhoto(index, -1),
      },
      {
        label: text('recipes.photoRight'),
        icon: 'chevron-right',
        disabled: index === this.images.peek().length - 1,
        onClick: () => this.movePhoto(index, 1),
      },
      {
        label: text('crop.remove'),
        icon: 'trash-2',
        danger: true,
        onClick: () => {
          this.images.value = this.images.peek().filter((_, position) => position !== index);
          this.dirty.value = true;
        },
      },
    ]);
  }

  draftFromText(): void {
    const described = signal('');
    const working = signal(false);
    const message = signal('');
    const run = async (): Promise<void> => {
      working.value = true;
      message.value = '';
      try {
        const draft = await call('aiDraftRecipe', { body: { text: described.peek() } });
        sheet.close();
        if (this.isConnected) {
          this.applyDraft(draft);
        }
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        working.value = false;
        message.value = error.code === 'ai_timeout' ? text('recipes.aiTimeout') : error.detail;
      }
    };
    const sheet = openSheet(this, {
      centered: true,
      heading: () => text('recipes.describeHeading'),
      body: () => html`
        <lc-textarea
          label=${text('recipes.describeField')}
          rows="6"
          maxlength=${LIMITS.aiText.max}
          value=${described.value}
          @input=${(event: Event) => {
            described.value = eventText(event);
          }}
        ></lc-textarea>
        ${working.value ? html`<lc-progress-bar indeterminate label=${text('recipes.describeWorking')}></lc-progress-bar>` : nothing}
        ${message.value === '' ? nothing : html`<lc-alert variant="error" icon="circle-alert" title=${text('recipes.aiFailedTitle')}>${message.value}</lc-alert>`}
      `,
      footer: () => html`
        <lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" ?disabled=${working.value || described.value.trim() === ''} @click=${() => void run()}
          >${text('recipes.describeRun')}</lc-button
        >
      `,
    });
  }

  async save(): Promise<void> {
    const current = this.values.peek();
    if (current === null) {
      return;
    }
    const built = build(current, this.images.peek(), this.existing?.parent?.id ?? null);
    this.values.value = built.values;
    this.problems.value = built.problems;
    this.errors.value = built.nameError === '' ? {} : { name: built.nameError };
    if (built.input === null) {
      await this.$requestUpdate();
      this.querySelector<HTMLElement>('.cl-form-problems')?.focus();
      return;
    }
    this.saving.value = true;
    const editId = this.editId;
    try {
      const saved =
        editId === null
          ? await call('createRecipe', { body: built.input })
          : await call('replaceRecipe', { params: { id: editId }, body: built.input });
      dataChanged('recipes', 'collections', 'menus', 'stats');
      toast({ title: text('recipes.saved') });
      if (this.isConnected) {
        this.dirty.value = false;
        navigate(`/recipes/${saved.id}`, { replace: editId === null });
      }
    } catch (error) {
      if (this.isConnected) {
        this.saving.value = false;
      }
      if (
        this.isConnected &&
        error instanceof ApiError &&
        error.code === 'validation_failed' &&
        error.fields.length > 0
      ) {
        const placed = withServerErrors(this.values.peek() ?? built.values, error.fields);
        this.values.value = placed.values;
        this.errors.value = placed.errors;
        this.problems.value = error.fields.map((field) => field.message);
        return;
      }
      actionFailed(error, () => void this.save());
    }
  }

  async deleteRecipe(): Promise<void> {
    const existing = this.existing;
    const editId = this.editId;
    if (existing === null || editId === null) {
      return;
    }
    const sure = await confirm(this, {
      title: text('recipes.deleteTitle', { name: existing.name }),
      message: text('recipes.deleteBody'),
      confirmLabel: text('recipes.deleteRecipe'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    try {
      await call('deleteRecipe', { params: { id: editId } });
      this.recipe.release();
      dataChanged('recipes', 'collections', 'menus', 'stats');
      if (this.isConnected) {
        this.dirty.value = false;
        navigate('/recipes', { replace: true });
      }
      toast({ title: text('toast.deleted') });
    } catch (error) {
      actionFailed(error, () => void this.deleteRecipe());
    }
  }

  fields(): FormField[] {
    return [
      { name: 'name', type: 'text', label: text('recipes.fieldName'), required: true },
      { name: 'description', type: 'textarea', label: text('recipes.fieldDescription'), rows: 3 },
      {
        name: 'lines',
        type: 'array',
        label: text('recipes.fieldLines'),
        max: LIMITS.recipeLines.max,
        addLabel: text('recipes.addLine'),
        emptyLabel: text('recipes.noLines'),
        itemField: { name: 'line', type: 'recipe-line', defaultValue: BLANK_LINE },
      },
      { name: 'instructions', type: 'textarea', label: text('recipes.fieldInstructions'), rows: 5 },
      {
        name: 'glassId',
        type: 'select',
        label: text('recipes.fieldGlass'),
        searchable: true,
        placeholder: text('recipes.noGlass'),
        options: [{ value: '', label: text('recipes.noGlass') }, ...options(this.glasses.value.value?.items)],
      },
      {
        name: 'methodId',
        type: 'select',
        label: text('recipes.fieldMethod'),
        placeholder: text('recipes.noMethod'),
        options: [{ value: '', label: text('recipes.noMethod') }, ...options(this.methods.value.value?.items)],
      },
      { name: 'garnish', type: 'text', label: text('recipes.fieldGarnish') },
      { name: 'year', type: 'number', label: text('recipes.fieldYear'), min: 1700, max: 2100, step: 1 },
      { name: 'tags', type: 'tags', label: text('recipes.fieldTags') },
      {
        name: 'utensilIds',
        type: 'multi-select',
        label: text('recipes.fieldUtensils'),
        max: LIMITS.recipeUtensils.max,
        options: options(this.utensils.value.value?.items),
      },
      { name: 'source', type: 'text', label: text('recipes.fieldSource') },
    ];
  }

  photos(aiEnabled: boolean): TemplateResult {
    const images = this.images.value;
    const existing = this.existing;
    return html`<section class="cl-form-photos" aria-labelledby="cl-form-photos">
    <h2 id="cl-form-photos" class="cl-form-label">${text('recipes.photos')}</h2>
    <ul class="cl-form-photo-list">
      ${images.map(
        (image, index) => html`<li class="cl-form-photo">
          <lc-image
            src=${image.url}
            alt=${text('recipes.photoNumber', { position: index + 1 })}
            placeholder=${image.thumbhash === null ? nothing : thumbHashDataUrl(image.thumbhash)}
          ></lc-image>
          <button
            type="button"
            class="cl-form-photo-menu"
            aria-haspopup="menu"
            aria-label=${text('recipes.photoActions', { position: index + 1 })}
            @click=${(event: MouseEvent) => {
              if (event.currentTarget instanceof Element) {
                this.photoMenu(event.currentTarget, index);
              }
            }}
          ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon></button>
        </li>`,
      )}
      ${
        images.length < LIMITS.recipeImages.max
          ? html`<li>
              <button type="button" class="cl-form-photo-add" @click=${() => this.addPhoto()}>
                <lc-icon name="image-plus" aria-hidden="true"></lc-icon>${text('recipes.addPhoto')}
              </button>
            </li>`
          : nothing
      }
    </ul>
    <p class="cl-sheet-hint">${text('recipes.photosHint')}</p>
    ${
      aiEnabled && existing !== null
        ? html`<lc-button variant="ghost" @click=${() => openPhotoSheet(this, existing)}>
            <lc-icon name="sparkles" aria-hidden="true"></lc-icon>${text('recipes.generatePhoto')}
          </lc-button>`
        : nothing
    }
  </section>`;
  }

  banners(): TemplateResult {
    const existing = this.existing;
    const notice = this.notice.value;
    const problems = this.problems.value;
    return html`
        ${
          existing !== null && existing.provenance === 'catalog' && !existing.editedFromCatalog
            ? html`<lc-alert variant="info" icon="info" title=${text('recipes.seedNotice')}></lc-alert>`
            : nothing
        }
        ${
          notice === null
            ? nothing
            : html`<lc-alert variant="info" icon="sparkles" title=${notice.title}>${notice.body}</lc-alert>`
        }
        ${
          problems.length === 0
            ? nothing
            : html`<div class="cl-form-problems" tabindex="-1">
                <lc-alert
                  variant="error"
                  icon="circle-alert"
                  title=${problems.length === 1 ? text('recipes.oneProblem') : text('recipes.problems', { count: problems.length })}
                >${capitalised(joinSentence(problems))}</lc-alert>
              </div>`
        }
  `;
  }

  retry(): void {
    this.lists.retry();
    if (this.fresh.peek()) {
      this.record.retry();
    } else {
      void this.renew();
    }
  }

  render() {
    if (!this.valid) {
      return notFound();
    }
    const editId = this.editId;
    const screen = text(editId === null ? 'title.newRecipe' : 'title.editRecipe');
    switch (this.status()) {
      case 'failed':
        return editId !== null && this.record.error.value?.code === 'not_found'
          ? notFound()
          : loadFailed(screen, () => this.retry(), 'none');
      case 'loading':
      case 'slow':
        return skeleton('lines', screen);
      case 'ready':
        break;
    }
    const values = this.values.value;
    const person = session.current.value;
    if (values === null || person === null) {
      return nothing;
    }
    const aiEnabled = person.household.aiEnabled;
    const saving = this.saving.value;
    return html`
        <header class="cl-form-head">
          <a class="cl-form-back" href=${href(this.backPath)} aria-label=${text('action.back')}
            ><lc-icon name="chevron-left" aria-hidden="true"></lc-icon
          ></a>
          <h1 class="cl-form-title">${screen}</h1>
          ${
            aiEnabled
              ? html`<lc-button variant="ghost" @click=${() => this.draftFromText()}>
                  <lc-icon name="sparkles" aria-hidden="true"></lc-icon>${text('recipes.describeIt')}
                </lc-button>`
              : nothing
          }
        </header>
        ${this.banners()}
        ${this.photos(aiEnabled)}
        <lc-form
          layout="stacked"
          .fields=${this.fields()}
          .data=${values}
          .errors=${this.errors.value}
          .typeHandlers=${tagsHandler}
          @field-change=${(event: Event) => {
            const detail: unknown = event instanceof CustomEvent ? event.detail : null;
            if (typeof detail === 'object' && detail !== null && 'name' in detail && 'value' in detail) {
              const name = detail.name;
              if (typeof name === 'string' && name in values) {
                this.changed({ [name]: detail.value });
              }
            }
          }}
          @form-submit=${() => void this.save()}
          @form-invalid=${() => void this.save()}
        >
          <div class="cl-form-footer">
            ${
              this.existing === null
                ? nothing
                : html`<lc-button variant="ghost" class="cl-form-delete" @click=${() => void this.deleteRecipe()}>
                    <lc-icon name="trash-2" aria-hidden="true"></lc-icon>${text('recipes.deleteRecipe')}
                  </lc-button>`
            }
            <lc-button variant="quiet" href=${href(this.backPath)}>${text('action.cancel')}</lc-button>
            <lc-button type="submit" variant="primary" ?disabled=${saving} aria-busy=${saving ? 'true' : nothing}
              >${text('recipes.saveRecipe')}</lc-button
            >
          </div>
        </lc-form>
      `;
  }
}

View.register(tag, RecipesForm);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: RecipesForm;
  }
}
