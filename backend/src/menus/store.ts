import {
  type AddMakeableResult,
  type FieldError,
  type Id,
  LIMITS,
  type Menu,
  type MenuCopyInput,
  type MenuInput,
  type MenuItem,
  type MenuSection,
  type MenuSummary,
  type MenuToken,
  normalizeMenuToken,
  type Page,
  type PreferredUnit,
  UNIT_IDS,
  type UnitId,
} from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import { type Database, withTransaction } from '../core/db.ts';
import { problem } from '../core/problems.ts';
import { IMAGE_COLUMNS, imageRowOrNull, num, numOrNull, type Row, str, strOrNull } from '../search/rows.ts';
import { onHandIngredientIds, recipeOutcomes } from '../shelf/satisfaction.ts';
import type { DisplayRecipe } from './display/recipe-page.ts';
import { generateMenuToken, tokensMatch } from './token.ts';

const MAKEABLE_SECTION_NAME = 'Tonight';

export interface LiveMenu {
  readonly id: Id;
  readonly name: string;
  readonly date: string;
  readonly token: string;
  readonly updatedAt: string;
}

function iso(ctx: AppContext): string {
  return ctx.now().toISOString();
}

function menuExists(db: Database, id: Id): void {
  if (db.prepare('SELECT 1 FROM menus WHERE id = ?').get(id) === undefined) {
    throw problem('not_found');
  }
}

export function menuPath(ctx: AppContext, token: string): string {
  return `${ctx.settings.basePath}/m/${token}`;
}

function itemOf(ctx: AppContext, row: Row, canMake: ReadonlyMap<Id, boolean>, onHand: ReadonlySet<Id>): MenuItem {
  const image = imageRowOrNull(row);
  const imageRef = image === null ? null : ctx.media.imageRef(image, ctx.settings.basePath);
  const base = {
    id: num(row, 'item_id'),
    hostNote: str(row, 'host_note'),
    hideWhenUnavailable: num(row, 'hide_when_unavailable') === 1,
  };
  const kind = str(row, 'kind');
  if (kind === 'recipe') {
    const recipeId = num(row, 'recipe_id');
    return {
      ...base,
      kind,
      recipe: { id: recipeId, name: str(row, 'item_name'), image: imageRef },
      available: canMake.get(recipeId) === true,
    };
  }
  if (kind === 'ingredient') {
    const ingredientId = num(row, 'ingredient_id');
    const available = onHand.has(ingredientId);
    return {
      ...base,
      kind,
      ingredient: { id: ingredientId, name: str(row, 'item_name'), onHand: available, image: imageRef },
      available,
    };
  }
  throw new Error(`menu_items row has kind ${kind}`);
}

export function loadSections(ctx: AppContext, menuId: Id): MenuSection[] {
  const rows = ctx.db
    .prepare(
      `SELECT s.id AS section_id, s.name AS section_name, it.id AS item_id, it.kind, it.recipe_id, it.ingredient_id,
         it.host_note, it.hide_when_unavailable, COALESCE(r.name, g.name) AS item_name, ${IMAGE_COLUMNS}
       FROM menu_sections s
       LEFT JOIN menu_items it ON it.section_id = s.id
       LEFT JOIN recipes r ON r.id = it.recipe_id
       LEFT JOIN ingredients g ON g.id = it.ingredient_id
       LEFT JOIN images i ON i.id = CASE WHEN it.kind = 'recipe'
         THEN (SELECT image_id FROM recipe_images WHERE recipe_id = it.recipe_id ORDER BY position LIMIT 1)
         ELSE g.image_id END
       WHERE s.menu_id = ?
       ORDER BY s.position, s.id, it.position, it.id`,
    )
    .all(menuId);
  const recipeIds = rows.flatMap((row) => (row.recipe_id === null ? [] : [num(row, 'recipe_id')]));
  const hasIngredients = rows.some((row) => row.ingredient_id !== null);
  const canMake = new Map<Id, boolean>();
  if (recipeIds.length > 0) {
    for (const outcome of recipeOutcomes(ctx.db, { recipeIds }).values()) {
      canMake.set(outcome.recipeId, outcome.canMake);
    }
  }
  const onHand: ReadonlySet<Id> = hasIngredients ? onHandIngredientIds(ctx.db) : new Set();
  const sections: { id: Id; name: string; items: MenuItem[] }[] = [];
  for (const row of rows) {
    const sectionId = num(row, 'section_id');
    let section = sections.at(-1);
    if (section?.id !== sectionId) {
      section = { id: sectionId, name: str(row, 'section_name'), items: [] };
      sections.push(section);
    }
    if (row.item_id !== null) {
      section.items.push(itemOf(ctx, row, canMake, onHand));
    }
  }
  return sections;
}

export function loadMenu(ctx: AppContext, id: Id): Menu {
  const row = ctx.db
    .prepare(
      `SELECT mn.id, mn.name, mn.date, mn.is_live, mn.token, mn.live_since, mn.ended_at, mn.created_at, mn.updated_at,
         m.id AS member_id, m.name AS member_name, ${IMAGE_COLUMNS}
       FROM menus mn
       LEFT JOIN members m ON m.id = mn.created_by
       LEFT JOIN images i ON i.id = m.avatar_image_id
       WHERE mn.id = ?`,
    )
    .get(id);
  if (row === undefined) {
    throw problem('not_found');
  }
  const live = num(row, 'is_live') === 1;
  const token = strOrNull(row, 'token');
  const liveSince = strOrNull(row, 'live_since');
  const avatar = imageRowOrNull(row);
  return {
    id,
    name: str(row, 'name'),
    date: str(row, 'date'),
    live,
    link: live && token !== null && liveSince !== null ? { path: menuPath(ctx, token), liveSince } : null,
    endedAt: strOrNull(row, 'ended_at'),
    sections: loadSections(ctx, id),
    createdBy:
      row.member_id === null
        ? null
        : {
            id: num(row, 'member_id'),
            name: str(row, 'member_name'),
            avatar: avatar === null ? null : ctx.media.imageRef(avatar, ctx.settings.basePath),
          },
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}

export function listMenus(ctx: AppContext, page: number, pageSize: number): Page<MenuSummary> {
  const totalRow = ctx.db.prepare('SELECT count(*) AS n FROM menus').get();
  const items = ctx.db
    .prepare(
      `SELECT mn.id, mn.name, mn.date, mn.is_live, mn.ended_at, mn.updated_at,
         (SELECT count(*) FROM menu_items it JOIN menu_sections s ON s.id = it.section_id WHERE s.menu_id = mn.id) AS item_count
       FROM menus mn
       ORDER BY mn.is_live DESC, mn.date DESC, mn.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(pageSize, (page - 1) * pageSize)
    .map((row) => ({
      id: num(row, 'id'),
      name: str(row, 'name'),
      date: str(row, 'date'),
      live: num(row, 'is_live') === 1,
      endedAt: strOrNull(row, 'ended_at'),
      itemCount: num(row, 'item_count'),
      updatedAt: str(row, 'updated_at'),
    }));
  return { items, page, pageSize, total: totalRow === undefined ? 0 : num(totalRow, 'n') };
}

function missingIds(db: Database, table: 'recipes' | 'ingredients', ids: readonly Id[]): ReadonlySet<Id> {
  if (ids.length === 0) {
    return new Set();
  }
  const found = new Set(
    db
      .prepare(`SELECT id FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(ids))
      .map((row) => num(row, 'id')),
  );
  return new Set(ids.filter((id) => !found.has(id)));
}

function validateMenu(db: Database, input: MenuInput): void {
  const items = input.sections.flatMap((section) => section.items);
  if (items.length > LIMITS.menuItems.max) {
    throw problem('validation_failed', {
      fields: [{ path: 'sections', code: 'too_many', message: `A menu holds at most ${LIMITS.menuItems.max} items.` }],
    });
  }
  const missingRecipes = missingIds(
    db,
    'recipes',
    items.flatMap((item) => (item.kind === 'recipe' ? [item.recipeId] : [])),
  );
  const missingIngredients = missingIds(
    db,
    'ingredients',
    items.flatMap((item) => (item.kind === 'ingredient' ? [item.ingredientId] : [])),
  );
  const fields: FieldError[] = [];
  for (const [s, section] of input.sections.entries()) {
    for (const [i, item] of section.items.entries()) {
      if (item.kind === 'recipe' && missingRecipes.has(item.recipeId)) {
        fields.push({ path: `sections.${s}.items.${i}.recipeId`, code: 'not_found', message: 'That recipe is gone.' });
      }
      if (item.kind === 'ingredient' && missingIngredients.has(item.ingredientId)) {
        fields.push({
          path: `sections.${s}.items.${i}.ingredientId`,
          code: 'not_found',
          message: 'That ingredient is gone.',
        });
      }
    }
  }
  if (fields.length > 0) {
    throw problem('validation_failed', { fields });
  }
}

function writeSections(db: Database, menuId: Id, sections: MenuInput['sections']): void {
  db.prepare('DELETE FROM menu_sections WHERE menu_id = ?').run(menuId);
  const insertSection = db.prepare('INSERT INTO menu_sections (menu_id, position, name) VALUES (?, ?, ?)');
  const insertItem = db.prepare(
    `INSERT INTO menu_items (section_id, position, kind, recipe_id, ingredient_id, host_note, hide_when_unavailable)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [position, section] of sections.entries()) {
    const sectionId = Number(insertSection.run(menuId, position, section.name).lastInsertRowid);
    for (const [itemPosition, item] of section.items.entries()) {
      insertItem.run(
        sectionId,
        itemPosition,
        item.kind,
        item.kind === 'recipe' ? item.recipeId : null,
        item.kind === 'ingredient' ? item.ingredientId : null,
        item.hostNote,
        item.hideWhenUnavailable ? 1 : 0,
      );
    }
  }
}

export function createMenu(ctx: AppContext, input: MenuInput, by: Id | null): Id {
  validateMenu(ctx.db, input);
  return withTransaction(ctx.db, () => {
    const now = iso(ctx);
    const id = Number(
      ctx.db
        .prepare('INSERT INTO menus (name, date, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(input.name, input.date, by, now, now).lastInsertRowid,
    );
    writeSections(ctx.db, id, input.sections);
    return id;
  });
}

export function replaceMenu(ctx: AppContext, id: Id, input: MenuInput): void {
  menuExists(ctx.db, id);
  validateMenu(ctx.db, input);
  withTransaction(ctx.db, () => {
    ctx.db
      .prepare('UPDATE menus SET name = ?, date = ?, updated_at = ? WHERE id = ?')
      .run(input.name, input.date, iso(ctx), id);
    writeSections(ctx.db, id, input.sections);
  });
}

export function deleteMenu(ctx: AppContext, id: Id): void {
  menuExists(ctx.db, id);
  ctx.db.prepare('DELETE FROM menus WHERE id = ?').run(id);
}

export function copyMenu(ctx: AppContext, id: Id, input: MenuCopyInput, by: Id | null): Id {
  menuExists(ctx.db, id);
  return withTransaction(ctx.db, () => {
    const now = iso(ctx);
    const copyId = Number(
      ctx.db
        .prepare('INSERT INTO menus (name, date, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(input.name, input.date, by, now, now).lastInsertRowid,
    );
    const sections = ctx.db
      .prepare('SELECT id, position, name FROM menu_sections WHERE menu_id = ? ORDER BY position, id')
      .all(id);
    const insertSection = ctx.db.prepare('INSERT INTO menu_sections (menu_id, position, name) VALUES (?, ?, ?)');
    const copyItems = ctx.db.prepare(
      `INSERT INTO menu_items (section_id, position, kind, recipe_id, ingredient_id, host_note, hide_when_unavailable)
       SELECT ?, position, kind, recipe_id, ingredient_id, host_note, hide_when_unavailable FROM menu_items WHERE section_id = ?`,
    );
    for (const section of sections) {
      const sectionId = Number(
        insertSection.run(copyId, num(section, 'position'), str(section, 'name')).lastInsertRowid,
      );
      copyItems.run(sectionId, num(section, 'id'));
    }
    return copyId;
  });
}

export function makeMenuLive(ctx: AppContext, id: Id): void {
  menuExists(ctx.db, id);
  withTransaction(ctx.db, () => {
    const now = iso(ctx);
    ctx.db
      .prepare(
        'UPDATE menus SET is_live = 0, token = NULL, live_since = NULL, ended_at = ?, updated_at = ? WHERE is_live = 1 AND id <> ?',
      )
      .run(now, now, id);
    ctx.db
      .prepare(
        'UPDATE menus SET is_live = 1, token = ?, live_since = ?, ended_at = NULL, updated_at = ? WHERE id = ? AND is_live = 0',
      )
      .run(generateMenuToken(), now, now, id);
  });
}

export function endMenu(ctx: AppContext, id: Id): void {
  menuExists(ctx.db, id);
  const now = iso(ctx);
  ctx.db
    .prepare(
      'UPDATE menus SET is_live = 0, token = NULL, live_since = NULL, ended_at = ?, updated_at = ? WHERE id = ? AND is_live = 1',
    )
    .run(now, now, id);
}

export function rotateMenuLink(ctx: AppContext, id: Id): void {
  menuExists(ctx.db, id);
  const result = ctx.db
    .prepare('UPDATE menus SET token = ?, updated_at = ? WHERE id = ? AND is_live = 1')
    .run(generateMenuToken(), iso(ctx), id);
  if (result.changes === 0) {
    throw problem('menu_not_live');
  }
}

export function addMakeable(ctx: AppContext, id: Id, sectionIndex: number): Omit<AddMakeableResult, 'menu'> {
  menuExists(ctx.db, id);
  return withTransaction(ctx.db, () => {
    const { db } = ctx;
    const sections = db.prepare('SELECT id FROM menu_sections WHERE menu_id = ? ORDER BY position, id').all(id);
    let sectionId: Id;
    if (sections.length === 0) {
      sectionId = Number(
        db
          .prepare('INSERT INTO menu_sections (menu_id, position, name) VALUES (?, 0, ?)')
          .run(id, MAKEABLE_SECTION_NAME).lastInsertRowid,
      );
    } else {
      const section = sections[sectionIndex];
      if (section === undefined) {
        throw problem('validation_failed', {
          fields: [{ path: 'sectionIndex', code: 'out_of_range', message: 'Pick one of the menu sections.' }],
        });
      }
      sectionId = num(section, 'id');
    }
    const onMenu = db
      .prepare(
        `SELECT it.recipe_id FROM menu_items it JOIN menu_sections s ON s.id = it.section_id
         WHERE s.menu_id = ? AND it.recipe_id IS NOT NULL`,
      )
      .all(id)
      .map((row) => num(row, 'recipe_id'));
    const itemCountRow = db
      .prepare(
        'SELECT count(*) AS n FROM menu_items it JOIN menu_sections s ON s.id = it.section_id WHERE s.menu_id = ?',
      )
      .get(id);
    const itemCount = itemCountRow === undefined ? 0 : num(itemCountRow, 'n');
    const present = new Set(onMenu);
    const makeable = [...recipeOutcomes(db).values()]
      .filter((outcome) => outcome.canMake && !present.has(outcome.recipeId))
      .map((outcome) => outcome.recipeId);
    const ordered =
      makeable.length === 0
        ? []
        : db
            .prepare('SELECT id FROM recipes WHERE id IN (SELECT value FROM json_each(?)) ORDER BY folded_name, id')
            .all(JSON.stringify(makeable))
            .map((row) => num(row, 'id'));
    const room = Math.max(0, LIMITS.menuItems.max - itemCount);
    const adding = ordered.slice(0, room);
    const lastRow = db.prepare('SELECT max(position) AS p FROM menu_items WHERE section_id = ?').get(sectionId);
    const last = lastRow?.p === null || lastRow === undefined ? -1 : num(lastRow, 'p');
    const insert = db.prepare(
      `INSERT INTO menu_items (section_id, position, kind, recipe_id, ingredient_id, host_note, hide_when_unavailable)
       VALUES (?, ?, 'recipe', ?, NULL, '', 0)`,
    );
    for (const [offset, recipeId] of adding.entries()) {
      insert.run(sectionId, last + 1 + offset, recipeId);
    }
    if (adding.length > 0 || sections.length === 0) {
      db.prepare('UPDATE menus SET updated_at = ? WHERE id = ?').run(iso(ctx), id);
    }
    return { added: adding.length, skippedForLimit: ordered.length - adding.length };
  });
}

export function liveMenuFor(db: Database, presented: string): LiveMenu | null {
  const token: MenuToken | null = normalizeMenuToken(presented);
  if (token === null) {
    return null;
  }
  const row = db
    .prepare('SELECT id, name, date, token, updated_at FROM menus WHERE is_live = 1 AND token IS NOT NULL')
    .get();
  if (row === undefined) {
    return null;
  }
  const stored = str(row, 'token');
  if (!tokensMatch(token, stored)) {
    return null;
  }
  return {
    id: num(row, 'id'),
    name: str(row, 'name'),
    date: str(row, 'date'),
    token: stored,
    updatedAt: str(row, 'updated_at'),
  };
}

function unitOf(value: string): UnitId {
  const unit = UNIT_IDS.find((id) => id === value);
  if (unit === undefined) {
    throw new Error(`recipe_lines row has unit ${value}`);
  }
  return unit;
}

export function displayUnit(db: Database): PreferredUnit {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'display_unit'").get();
  return row?.value === 'ml' ? 'ml' : 'oz';
}

export function displayRecipe(ctx: AppContext, recipeId: Id): DisplayRecipe | null {
  const { db } = ctx;
  const row = db
    .prepare(
      `SELECT r.name, r.instructions, r.garnish, gl.name AS glass_name, ${IMAGE_COLUMNS}
       FROM recipes r
       LEFT JOIN glasses gl ON gl.id = r.glass_id
       LEFT JOIN images i ON i.id = (SELECT image_id FROM recipe_images WHERE recipe_id = r.id ORDER BY position LIMIT 1)
       WHERE r.id = ?`,
    )
    .get(recipeId);
  if (row === undefined) {
    return null;
  }
  const image = imageRowOrNull(row);
  const ref = image === null ? null : ctx.media.imageRef(image, ctx.settings.basePath);
  const lines = db
    .prepare(
      `SELECT l.amount, l.amount_max, l.unit, l.optional, g.name AS ingredient_name
       FROM recipe_lines l JOIN ingredients g ON g.id = l.ingredient_id
       WHERE l.recipe_id = ? ORDER BY l.position, l.id`,
    )
    .all(recipeId)
    .map((line) => ({
      amount: numOrNull(line, 'amount'),
      amountMax: numOrNull(line, 'amount_max'),
      unit: unitOf(str(line, 'unit')),
      optional: num(line, 'optional') === 1,
      ingredientName: str(line, 'ingredient_name'),
    }));
  return {
    name: str(row, 'name'),
    image: ref === null ? null : { url: ref.url, width: ref.width, height: ref.height },
    lines,
    instructions: str(row, 'instructions'),
    garnish: str(row, 'garnish'),
    glass: strOrNull(row, 'glass_name'),
  };
}
