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
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { eventText } from '../../app/events.ts';
import { onLeave } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { invalidate } from '../../app/resources.ts';
import { href, router } from '../../app/router.ts';
import type { ScreenContext } from '../../app/types.ts';
import type { ImageUpload } from '../../design-system/cl-image-field.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { illustration } from '../../design-system/illustration.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { openActions } from './parts/actions.ts';
import { openPhotoSheet } from './parts/ai-sheets.ts';
import { BLANK_LINE, type LineDraft, registerLineFields, toUnit } from './parts/line-fields.ts';
import { openSheet } from './parts/sheet.ts';
import './form.css';

interface Taxonomy {
  readonly glasses: readonly { value: string; label: string }[];
  readonly methods: readonly { value: string; label: string }[];
  readonly utensils: readonly { value: string; label: string }[];
}

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
    tags: recipe.tags.map((tag) => tag.name),
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

export function screen(ctx: ScreenContext): HTMLElement {
  registerLineFields();
  const element = document.createElement('section');
  element.className = 'cl-recipe-form cl-reading';
  const editId = ctx.params.id === undefined ? null : Number(ctx.params.id);
  const backPath = editId === null ? '/recipes' : `/recipes/${editId}`;
  let values = emptyValues();
  let images: ImageRef[] = [];
  let recipe: Recipe | null = null;
  let taxonomy: Taxonomy | null = null;
  let notice: Notice = null;
  let problems: readonly string[] = [];
  let errors: Record<string, string> = {};
  let dirty = false;
  let saving = false;
  let failed = false;
  let missing = false;

  let unblock: (() => void) | null = null;
  const setDirty = (next: boolean): void => {
    dirty = next;
    if (dirty && unblock === null) {
      unblock = router.block(() =>
        confirm({
          title: text('recipes.leaveTitle'),
          message: recipe === null ? text('recipes.leaveBodyNew') : text('recipes.leaveBody', { name: recipe.name }),
          confirmLabel: text('recipes.discardChanges'),
          cancelLabel: text('recipes.keepEditing'),
          danger: true,
        }),
      );
    } else if (!dirty && unblock !== null) {
      unblock();
      unblock = null;
    }
  };
  onLeave(element, () => setDirty(false));

  const fields = (): FormField[] => [
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
      options: [{ value: '', label: text('recipes.noGlass') }, ...(taxonomy?.glasses ?? [])],
    },
    {
      name: 'methodId',
      type: 'select',
      label: text('recipes.fieldMethod'),
      placeholder: text('recipes.noMethod'),
      options: [{ value: '', label: text('recipes.noMethod') }, ...(taxonomy?.methods ?? [])],
    },
    { name: 'garnish', type: 'text', label: text('recipes.fieldGarnish') },
    { name: 'year', type: 'number', label: text('recipes.fieldYear'), min: 1700, max: 2100, step: 1 },
    { name: 'tags', type: 'tags', label: text('recipes.fieldTags') },
    {
      name: 'utensilIds',
      type: 'multi-select',
      label: text('recipes.fieldUtensils'),
      max: LIMITS.recipeUtensils.max,
      options: [...(taxonomy?.utensils ?? [])],
    },
    { name: 'source', type: 'text', label: text('recipes.fieldSource') },
  ];

  const changed = (patch: Partial<Values>): void => {
    values = { ...values, ...patch };
    setDirty(true);
    draw();
  };

  const tagsHandler = {
    tags: {
      render: (_field: FormField, value: unknown, onChange: (next: unknown) => void): TemplateResult => {
        const tags = Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
        return html`<div class="cl-tags-field">
          <span class="cl-tags-list">
            ${tags.map(
              (tag) => html`<lc-tag
                closable
                aria-label=${text('recipes.removeTag', { name: tag })}
                @close=${() => onChange(tags.filter((item) => item !== tag))}
              >${tag}</lc-tag>`,
            )}
          </span>
          ${
            tags.length < LIMITS.recipeTags.max
              ? html`<lc-input
                  label=${text('recipes.addTag')}
                  maxlength=${LIMITS.tagName.max}
                  @keydown=${(event: KeyboardEvent) => {
                    const target = event.target;
                    if (event.key !== 'Enter' || !(target instanceof HTMLInputElement)) {
                      return;
                    }
                    event.preventDefault();
                    const tag = target.value.trim();
                    if (tag !== '' && !tags.includes(tag)) {
                      onChange([...tags, tag]);
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

  const upload = async (picked: ImageUpload, sheet: { close(): void }): Promise<void> => {
    const form = new FormData();
    form.append('file', picked.file, 'photo.webp');
    form.append('purpose', picked.purpose);
    form.append('width', String(picked.width));
    form.append('height', String(picked.height));
    form.append('thumbhash', picked.thumbhash);
    try {
      const image = await call('uploadImage', { body: form });
      images = [...images, image];
      setDirty(true);
      sheet.close();
      draw();
    } catch (error) {
      actionFailed(error, () => void upload(picked, sheet));
    }
  };

  const addPhoto = (): void => {
    const sheet = openSheet({
      centered: true,
      heading: () => text('recipes.cropHeading'),
      body: () =>
        html`<cl-image-field purpose="recipe" .change=${(picked: ImageUpload) => void upload(picked, sheet)}></cl-image-field>`,
      footer: () => html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>`,
    });
  };

  const movePhoto = (index: number, by: number): void => {
    const to = index + by;
    const next = [...images];
    const moving = next[index];
    const other = next[to];
    if (moving === undefined || other === undefined) {
      return;
    }
    next[index] = other;
    next[to] = moving;
    images = next;
    setDirty(true);
    draw();
  };

  const photoMenu = (trigger: Element, index: number): void => {
    const name = text('recipes.photoNumber', { position: index + 1 });
    openActions(trigger, name, [
      {
        label: text('recipes.photoLeft'),
        icon: 'chevron-left',
        disabled: index === 0,
        onClick: () => movePhoto(index, -1),
      },
      {
        label: text('recipes.photoRight'),
        icon: 'chevron-right',
        disabled: index === images.length - 1,
        onClick: () => movePhoto(index, 1),
      },
      {
        label: text('crop.remove'),
        icon: 'trash-2',
        danger: true,
        onClick: () => {
          images = images.filter((_, position) => position !== index);
          setDirty(true);
          draw();
        },
      },
    ]);
  };

  const applyDraft = (draft: RecipeDraft): void => {
    values = valuesOfDraft(draft);
    notice = draftNotice(draft);
    setDirty(true);
    draw();
  };

  const draftFromText = (): void => {
    let described = '';
    let working = false;
    let message = '';
    const run = async (): Promise<void> => {
      working = true;
      message = '';
      sheet.redraw();
      try {
        const draft = await call('aiDraftRecipe', { body: { text: described } });
        sheet.close();
        applyDraft(draft);
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        working = false;
        message = error.code === 'ai_timeout' ? text('recipes.aiTimeout') : error.detail;
        sheet.redraw();
      }
    };
    const sheet = openSheet({
      centered: true,
      heading: () => text('recipes.describeHeading'),
      body: () => html`
        <lc-textarea
          label=${text('recipes.describeField')}
          rows="6"
          maxlength=${LIMITS.aiText.max}
          value=${described}
          @input=${(event: Event) => {
            described = eventText(event);
            sheet.redraw();
          }}
        ></lc-textarea>
        ${working ? html`<lc-progress-bar indeterminate label=${text('recipes.describeWorking')}></lc-progress-bar>` : nothing}
        ${message === '' ? nothing : html`<lc-alert variant="error" icon="circle-alert" title=${text('recipes.aiFailedTitle')}>${message}</lc-alert>`}
      `,
      footer: () => html`
        <lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" ?disabled=${working || described.trim() === ''} @click=${() => void run()}
          >${text('recipes.describeRun')}</lc-button
        >
      `,
    });
  };

  const save = async (): Promise<void> => {
    const built = build(values, images, recipe?.parent?.id ?? null);
    values = built.values;
    problems = built.problems;
    errors = built.nameError === '' ? {} : { name: built.nameError };
    if (built.input === null) {
      draw();
      element.querySelector<HTMLElement>('.cl-form-problems')?.focus();
      return;
    }
    saving = true;
    draw();
    try {
      const saved =
        editId === null
          ? await call('createRecipe', { body: built.input })
          : await call('replaceRecipe', { params: { id: editId }, body: built.input });
      invalidate('recipes', 'collections', 'menus', 'stats');
      setDirty(false);
      toast({ title: text('recipes.saved') });
      ctx.navigate(`/recipes/${saved.id}`, { replace: editId === null });
    } catch (error) {
      saving = false;
      if (error instanceof ApiError && error.code === 'validation_failed' && error.fields.length > 0) {
        const placed = withServerErrors(values, error.fields);
        values = placed.values;
        errors = placed.errors;
        problems = error.fields.map((field) => field.message);
        draw();
        return;
      }
      draw();
      actionFailed(error, () => void save());
    }
  };

  const remove = async (): Promise<void> => {
    if (recipe === null || editId === null) {
      return;
    }
    const sure = await confirm({
      title: text('recipes.deleteTitle', { name: recipe.name }),
      message: text('recipes.deleteBody'),
      confirmLabel: text('recipes.deleteRecipe'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    try {
      await call('deleteRecipe', { params: { id: editId } });
      invalidate('recipes', 'collections', 'menus', 'stats');
      setDirty(false);
      ctx.navigate('/recipes', { replace: true });
      toast({ title: text('toast.deleted') });
    } catch (error) {
      actionFailed(error, () => void remove());
    }
  };

  const photos = (
    aiEnabled: boolean,
  ): TemplateResult => html`<section class="cl-form-photos" aria-labelledby="cl-form-photos">
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
                photoMenu(event.currentTarget, index);
              }
            }}
          ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon></button>
        </li>`,
      )}
      ${
        images.length < LIMITS.recipeImages.max
          ? html`<li>
              <button type="button" class="cl-form-photo-add" @click=${addPhoto}>
                <lc-icon name="image-plus" aria-hidden="true"></lc-icon>${text('recipes.addPhoto')}
              </button>
            </li>`
          : nothing
      }
    </ul>
    <p class="cl-sheet-hint">${text('recipes.photosHint')}</p>
    ${
      aiEnabled && recipe !== null
        ? html`<lc-button variant="ghost" @click=${() => recipe !== null && openPhotoSheet(recipe)}>
            <lc-icon name="sparkles" aria-hidden="true"></lc-icon>${text('recipes.generatePhoto')}
          </lc-button>`
        : nothing
    }
  </section>`;

  const banners = (): TemplateResult => html`
        ${
          recipe !== null && recipe.provenance === 'catalog' && !recipe.editedFromCatalog
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

  const draw = (): void => {
    const session = ctx.person.current();
    if (missing) {
      render(
        html`<lc-empty-state title=${text('recipes.notFoundTitle')} description=${text('recipes.notFoundBody')}>
          ${illustration('empty-lost')}
          <lc-button variant="primary" href=${href('/recipes')}>${text('recipes.backToRecipes')}</lc-button>
        </lc-empty-state>`,
        element,
      );
      return;
    }
    if (failed) {
      render(
        html`<lc-empty-state
          title=${text('loadFailed.title', { screen: text(editId === null ? 'title.newRecipe' : 'title.editRecipe') })}
          description=${text('loadFailed.body')}
        >
          ${illustration('empty-lost')}
          <lc-button variant="primary" @click=${() => void load()}>${text('loadFailed.retry')}</lc-button>
        </lc-empty-state>`,
        element,
      );
      return;
    }
    if (taxonomy === null || session === null) {
      return;
    }
    const aiEnabled = session.household.aiEnabled;
    element.querySelector('.cl-skeleton')?.remove();
    render(
      html`
        <header class="cl-form-head">
          <a class="cl-form-back" href=${href(backPath)} aria-label=${text('action.back')}
            ><lc-icon name="chevron-left" aria-hidden="true"></lc-icon
          ></a>
          <h1 class="cl-form-title">${text(editId === null ? 'title.newRecipe' : 'title.editRecipe')}</h1>
          ${
            aiEnabled
              ? html`<lc-button variant="ghost" @click=${draftFromText}>
                  <lc-icon name="sparkles" aria-hidden="true"></lc-icon>${text('recipes.describeIt')}
                </lc-button>`
              : nothing
          }
        </header>
        ${banners()}
        ${photos(aiEnabled)}
        <lc-form
          layout="stacked"
          .fields=${fields()}
          .data=${values}
          .errors=${errors}
          .typeHandlers=${tagsHandler}
          @field-change=${(event: Event) => {
            const detail: unknown = event instanceof CustomEvent ? event.detail : null;
            if (typeof detail === 'object' && detail !== null && 'name' in detail && 'value' in detail) {
              const name = detail.name;
              if (typeof name === 'string' && name in values) {
                changed({ [name]: detail.value });
              }
            }
          }}
          @form-submit=${() => void save()}
          @form-invalid=${() => void save()}
        >
          <div class="cl-form-footer">
            ${
              recipe === null
                ? nothing
                : html`<lc-button variant="ghost" class="cl-form-delete" @click=${() => void remove()}>
                    <lc-icon name="trash-2" aria-hidden="true"></lc-icon>${text('recipes.deleteRecipe')}
                  </lc-button>`
            }
            <lc-button variant="quiet" href=${href(backPath)}>${text('action.cancel')}</lc-button>
            <lc-button type="submit" variant="primary" ?disabled=${saving} aria-busy=${saving ? 'true' : nothing}
              >${text('recipes.saveRecipe')}</lc-button
            >
          </div>
        </lc-form>
      `,
      element,
    );
  };

  const load = async (): Promise<void> => {
    failed = false;
    element.replaceChildren(skeleton('lines', text(editId === null ? 'title.newRecipe' : 'title.editRecipe')));
    try {
      const [glasses, methods, utensils, existing] = await Promise.all([
        call('listGlasses', {}),
        call('listMethods', {}),
        call('listUtensils', {}),
        editId === null ? Promise.resolve(null) : call('getRecipe', { params: { id: editId } }),
      ]);
      taxonomy = {
        glasses: glasses.items.map((item) => ({ value: String(item.id), label: item.name })),
        methods: methods.items.map((item) => ({ value: String(item.id), label: item.name })),
        utensils: utensils.items.map((item) => ({ value: String(item.id), label: item.name })),
      };
      recipe = existing;
      const draft = draftFromHistory();
      if (existing !== null) {
        values = valuesOf(existing);
        images = [...existing.images];
      } else if (draft !== null) {
        applyDraft(draft);
      }
      draw();
      if (existing === null && draft === null && describeRequested()) {
        draftFromText();
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      missing = error.code === 'not_found';
      failed = !missing;
      draw();
    }
  };

  if (editId !== null && (!Number.isSafeInteger(editId) || editId < 1)) {
    missing = true;
    draw();
  } else {
    void load();
  }
  return element;
}
