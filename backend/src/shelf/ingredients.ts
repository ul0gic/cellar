import {
  foldName,
  type Id,
  type Ingredient,
  type IngredientInput,
  type IngredientListQuery,
  type IngredientNode,
  type IngredientPatch,
  type IngredientSummary,
  type IngredientSummaryPage,
  type IngredientTree,
  isVolumeUnit,
  LIMITS,
  type OnHandState,
  toMl,
  UNIT_IDS,
  type UnitId,
} from '@cellar/contract';
import type { Person } from '../core/access.ts';
import type { AppContext } from '../core/context.ts';
import { withTransaction } from '../core/db.ts';
import { problem } from '../core/problems.ts';
import { householdRating } from '../recipes/visibility.ts';
import { BOTTLE_SELECT, bottleSummaryOf, shelfView } from './bottles.ts';
import {
  ancestorsOf,
  descendantsAndSelf,
  imageRef,
  ingredientRef,
  loadTaxonomy,
  RECIPE_REF_SELECT,
  recipeRefOf,
  rootOf,
  type Taxonomy,
  taxonRef,
} from './refs.ts';
import {
  fieldProblem,
  imageColumns,
  imageRowOrNull,
  num,
  numOrNull,
  oneOfOrNull,
  type Row,
  text,
  textOrNull,
} from './rows.ts';
import { type OnHandSet, onHandIngredientIds } from './satisfaction.ts';

const RECIPES_SHOWN = 24;
const CATALOG_TYPE = 'ingredients';

function countsBy(ctx: AppContext, sql: string): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const row of ctx.db.prepare(sql).all()) {
    counts.set(num(row, 'id'), num(row, 'n'));
  }
  return counts;
}

function shelfBottleCounts(ctx: AppContext): Map<Id, number> {
  return countsBy(
    ctx,
    "SELECT ingredient_id AS id, COUNT(*) AS n FROM bottles WHERE status IN ('sealed', 'open') GROUP BY ingredient_id",
  );
}

function recipeCounts(ctx: AppContext): Map<Id, number> {
  return countsBy(
    ctx,
    'SELECT ingredient_id AS id, COUNT(DISTINCT recipe_id) AS n FROM recipe_lines GROUP BY ingredient_id',
  );
}

export function getIngredientTree(ctx: AppContext): IngredientTree {
  const taxonomy = loadTaxonomy(ctx);
  const onHand = onHandIngredientIds(ctx.db);
  const bottles = shelfBottleCounts(ctx);
  const nodes: IngredientNode[] = [];
  const visit = (parentId: Id | null, depth: number): void => {
    for (const node of taxonomy.children.get(parentId) ?? []) {
      nodes.push({
        id: node.id,
        parentId: node.parentId,
        name: node.name,
        depth,
        onHand: onHand.has(node.id),
        childCount: taxonomy.children.get(node.id)?.length ?? 0,
        bottleCount: bottles.get(node.id) ?? 0,
      });
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return { nodes };
}

export function listIngredients(ctx: AppContext, query: IngredientListQuery): IngredientSummaryPage {
  const taxonomy = loadTaxonomy(ctx);
  const onHand = onHandIngredientIds(ctx.db);
  const bottles = shelfBottleCounts(ctx);
  const recipes = recipeCounts(ctx);
  const underRoot = query.root === undefined ? null : descendantsAndSelf(taxonomy, query.root);
  const needle = query.q === undefined ? null : foldName(query.q);
  const matches = [...taxonomy.nodes.values()].filter(
    (node) =>
      (needle === null || node.foldedName.includes(needle)) &&
      (query.onHand === undefined || onHand.has(node.id) === query.onHand) &&
      (underRoot === null || underRoot.has(node.id)) &&
      (query.parent === undefined || node.parentId === query.parent) &&
      (query.hasBottles === undefined || (bottles.get(node.id) ?? 0) > 0 === query.hasBottles),
  );
  const sort = query.sort ?? 'name';
  const direction = (query.order ?? (sort === 'name' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  matches.sort((a, b) => {
    if (sort === 'recipes') {
      const byCount = (recipes.get(a.id) ?? 0) - (recipes.get(b.id) ?? 0);
      if (byCount !== 0) {
        return byCount * direction;
      }
    }
    if (a.foldedName !== b.foldedName) {
      return (a.foldedName < b.foldedName ? -1 : 1) * (sort === 'name' ? direction : 1);
    }
    return a.id - b.id;
  });
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? LIMITS.pageSize.default;
  const shown = matches.slice((page - 1) * pageSize, page * pageSize);
  const details = new Map<Id, Row>();
  for (const row of ctx.db
    .prepare(
      `SELECT i.id, i.strength, i.on_hand, ${imageColumns('im', 'image')}
       FROM ingredients i LEFT JOIN images im ON im.id = i.image_id
       WHERE i.id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(shown.map((node) => node.id)))) {
    details.set(num(row, 'id'), row);
  }
  const items = shown.flatMap((node): IngredientSummary[] => {
    const row = details.get(node.id);
    if (row === undefined) {
      return [];
    }
    const parent = node.parentId === null ? undefined : taxonomy.nodes.get(node.parentId);
    return [
      {
        id: node.id,
        name: node.name,
        image: imageRef(ctx, imageRowOrNull(row, 'image')),
        strength: num(row, 'strength'),
        parent: parent === undefined ? null : taxonRef(parent),
        root: rootOf(taxonomy, node),
        onHand: onHand.has(node.id),
        markedOnHand: num(row, 'on_hand') === 1,
        bottleCount: bottles.get(node.id) ?? 0,
        recipeCount: recipes.get(node.id) ?? 0,
      },
    ];
  });
  return { items, page, pageSize, total: matches.length };
}

function reasonOf(marked: boolean, shelfBottles: number, onHand: boolean): OnHandState['onHandReason'] {
  if (marked) {
    return 'marked';
  }
  if (shelfBottles > 0) {
    return 'bottle';
  }
  return onHand ? 'parts' : null;
}

function shelfBottleCount(ctx: AppContext, id: Id): number {
  const row = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM bottles WHERE ingredient_id = ? AND status IN ('sealed', 'open')")
    .get(id);
  return row === undefined ? 0 : num(row, 'n');
}

function recipeRefsWhere(ctx: AppContext, recipeIdsSql: string, id: Id): Ingredient['usedIn'] {
  const countRow = ctx.db.prepare(`SELECT COUNT(*) AS n FROM (${recipeIdsSql})`).get(id);
  const recipes = ctx.db
    .prepare(`${RECIPE_REF_SELECT} WHERE r.id IN (${recipeIdsSql}) ORDER BY r.folded_name, r.id LIMIT ?`)
    .all(id, RECIPES_SHOWN)
    .map((row) => recipeRefOf(ctx, row));
  return { count: countRow === undefined ? 0 : num(countRow, 'n'), recipes };
}

function ingredientRow(ctx: AppContext, id: Id): Row {
  const row = ctx.db
    .prepare(
      `SELECT i.*, ${imageColumns('im', 'image')} FROM ingredients i LEFT JOIN images im ON im.id = i.image_id WHERE i.id = ?`,
    )
    .get(id);
  if (row === undefined) {
    throw problem('not_found');
  }
  return row;
}

export function getIngredient(ctx: AppContext, person: Person, id: Id): Ingredient {
  const row = ingredientRow(ctx, id);
  const view = shelfView(ctx);
  const { taxonomy, onHand } = view;
  const refOf = (refId: Id): Ingredient['children'][number] => {
    const node = taxonomy.nodes.get(refId);
    if (node === undefined) {
      throw new Error(`ingredient ${refId} is referenced but missing`);
    }
    return ingredientRef(refId, node.name, onHand);
  };
  const parentId = numOrNull(row, 'parent_id');
  const parts = ctx.db
    .prepare(
      `SELECT p.part_ingredient_id, p.amount, p.unit FROM ingredient_parts p
       WHERE p.ingredient_id = ? ORDER BY p.position`,
    )
    .all(id)
    .map((part) => ({
      ingredient: refOf(num(part, 'part_ingredient_id')),
      amount: numOrNull(part, 'amount'),
      unit: oneOfOrNull(part, 'unit', UNIT_IDS),
    }));
  const onShelf = ctx.db
    .prepare(`${BOTTLE_SELECT} WHERE b.ingredient_id = ? AND b.status IN ('sealed', 'open') ORDER BY b.name, b.id`)
    .all(id)
    .map((bottle) => bottleSummaryOf(ctx, view, bottle));
  const finished = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM bottles WHERE ingredient_id = ? AND status = 'finished'")
    .get(id);
  const marked = num(row, 'on_hand') === 1;
  const isOnHand = onHand.has(id);
  const rating = householdRating(ctx.db, { type: 'ingredient', id }, person.id);
  return {
    id,
    name: text(row, 'name'),
    provenance: row.catalog_key === null ? 'household' : 'catalog',
    editedFromCatalog: row.edited_at !== null,
    parent: parentId === null ? null : refOf(parentId),
    path: ancestorsOf(taxonomy, id).map(taxonRef),
    children: (taxonomy.children.get(id) ?? []).map((child) => refOf(child.id)),
    strength: num(row, 'strength'),
    description: text(row, 'description'),
    origin: textOrNull(row, 'origin') ?? '',
    color: textOrNull(row, 'color'),
    defaultUnit: oneOfOrNull(row, 'default_unit', UNIT_IDS),
    image: imageRef(ctx, imageRowOrNull(row, 'image')),
    parts,
    onHand: isOnHand,
    onHandReason: reasonOf(marked, onShelf.length, isOnHand),
    markedOnHand: marked,
    usedIn: recipeRefsWhere(ctx, 'SELECT DISTINCT recipe_id FROM recipe_lines WHERE ingredient_id = ?', id),
    substitutesIn: recipeRefsWhere(
      ctx,
      `SELECT DISTINCT l.recipe_id FROM recipe_line_substitutes s JOIN recipe_lines l ON l.id = s.line_id
       WHERE s.ingredient_id = ?`,
      id,
    ),
    bottles: { onShelf, finishedCount: finished === undefined ? 0 : num(finished, 'n') },
    mine: { rating: rating.mine },
    household: { rating: rating.household },
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

const TOO_DEEP = 'That would put this more than 10 levels deep.';

function heightBelow(taxonomy: Taxonomy, id: Id): number {
  let height = 0;
  for (const child of taxonomy.children.get(id) ?? []) {
    height = Math.max(height, heightBelow(taxonomy, child.id) + 1);
  }
  return height;
}

function checkParent(taxonomy: Taxonomy, id: Id | null, parentId: Id): void {
  if (!taxonomy.nodes.has(parentId)) {
    throw fieldProblem('parentId', 'not_found', 'That ingredient no longer exists.');
  }
  if (id !== null && descendantsAndSelf(taxonomy, id).has(parentId)) {
    throw fieldProblem('parentId', 'tree_cycle', "An ingredient can't sit under itself or one of its own children.");
  }
  const depth = ancestorsOf(taxonomy, parentId).length + 1 + (id === null ? 0 : heightBelow(taxonomy, id));
  if (depth > LIMITS.ingredientDepth.max) {
    throw fieldProblem('parentId', 'tree_too_deep', TOO_DEEP);
  }
}

function checkName(ctx: AppContext, id: Id | null, name: string, parentId: Id | null): void {
  const clash = ctx.db
    .prepare('SELECT 1 FROM ingredients WHERE folded_name = ? AND parent_id IS ? AND id IS NOT ?')
    .get(foldName(name), parentId, id);
  if (clash !== undefined) {
    throw problem('duplicate_name', { detail: `There is already an ingredient called “${name.trim()}”.` });
  }
}

function checkImage(ctx: AppContext, imageId: Id | null): void {
  if (imageId !== null && ctx.db.prepare('SELECT 1 FROM images WHERE id = ?').get(imageId) === undefined) {
    throw fieldProblem('imageId', 'not_found', 'That image no longer exists.');
  }
}

const MADE_FROM = `WITH RECURSIVE made(id) AS (
  SELECT ? UNION SELECT p.part_ingredient_id FROM ingredient_parts p JOIN made ON p.ingredient_id = made.id
) SELECT 1 FROM made WHERE id = ?`;

function checkParts(ctx: AppContext, taxonomy: Taxonomy, id: Id | null, parts: IngredientInput['parts']): void {
  for (const [index, part] of parts.entries()) {
    const path = `parts.${index}.ingredientId`;
    if (!taxonomy.nodes.has(part.ingredientId)) {
      throw fieldProblem(path, 'not_found', 'That ingredient no longer exists.');
    }
    if (id !== null && ctx.db.prepare(MADE_FROM).get(part.ingredientId, id) !== undefined) {
      throw fieldProblem(path, 'parts_cycle', "An ingredient can't be made from itself.");
    }
  }
}

function storedUnit(unit: IngredientInput['defaultUnit']): UnitId | null {
  if (unit === null) {
    return null;
  }
  return isVolumeUnit(unit) ? 'ml' : unit;
}

function writeParts(ctx: AppContext, id: Id, parts: IngredientInput['parts']): void {
  ctx.db.prepare('DELETE FROM ingredient_parts WHERE ingredient_id = ?').run(id);
  const insert = ctx.db.prepare(
    'INSERT INTO ingredient_parts (ingredient_id, position, part_ingredient_id, amount, unit) VALUES (?, ?, ?, ?, ?)',
  );
  for (const [position, part] of parts.entries()) {
    const amount =
      part.amount !== null && part.unit !== null && isVolumeUnit(part.unit)
        ? toMl(part.amount, part.unit)
        : part.amount;
    insert.run(id, position, part.ingredientId, amount, storedUnit(part.unit));
  }
}

export function createIngredient(ctx: AppContext, person: Person, input: IngredientInput): Ingredient {
  const id = withTransaction(ctx.db, () => {
    const taxonomy = loadTaxonomy(ctx);
    if (input.parentId !== null) {
      checkParent(taxonomy, null, input.parentId);
    }
    checkName(ctx, null, input.name, input.parentId);
    checkImage(ctx, input.imageId);
    checkParts(ctx, taxonomy, null, input.parts);
    const stamp = ctx.now().toISOString();
    const result = ctx.db
      .prepare(
        `INSERT INTO ingredients (name, folded_name, parent_id, strength, description, color, origin, default_unit,
           image_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        foldName(input.name),
        input.parentId,
        input.strength,
        input.description,
        input.color,
        input.origin,
        storedUnit(input.defaultUnit),
        input.imageId,
        person.id,
        stamp,
        stamp,
      );
    const created = Number(result.lastInsertRowid);
    writeParts(ctx, created, input.parts);
    return created;
  });
  return getIngredient(ctx, person, id);
}

export function updateIngredient(ctx: AppContext, person: Person, id: Id, patch: IngredientPatch): Ingredient {
  withTransaction(ctx.db, () => {
    const row = ingredientRow(ctx, id);
    const taxonomy = loadTaxonomy(ctx);
    const parentId = patch.parentId === undefined ? numOrNull(row, 'parent_id') : patch.parentId;
    if (patch.parentId !== undefined && patch.parentId !== null) {
      checkParent(taxonomy, id, patch.parentId);
    }
    if (patch.name !== undefined || patch.parentId !== undefined) {
      checkName(ctx, id, patch.name ?? text(row, 'name'), parentId);
    }
    if (patch.imageId !== undefined) {
      checkImage(ctx, patch.imageId);
    }
    if (patch.parts !== undefined) {
      checkParts(ctx, taxonomy, id, patch.parts);
    }
    const assignments: [string, string | number | null | undefined][] = [
      ['name', patch.name],
      ['folded_name', patch.name === undefined ? undefined : foldName(patch.name)],
      ['parent_id', patch.parentId],
      ['strength', patch.strength],
      ['description', patch.description],
      ['origin', patch.origin],
      ['color', patch.color],
      ['default_unit', patch.defaultUnit === undefined ? undefined : storedUnit(patch.defaultUnit)],
      ['image_id', patch.imageId],
    ];
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [column, value] of assignments) {
      if (value !== undefined) {
        sets.push(`${column} = ?`);
        values.push(value);
      }
    }
    if (patch.parts !== undefined) {
      writeParts(ctx, id, patch.parts);
    }
    if (sets.length === 0 && patch.parts === undefined) {
      return;
    }
    const stamp = ctx.now().toISOString();
    const editedAt = row.catalog_key === null ? 'edited_at' : 'COALESCE(edited_at, ?)';
    ctx.db
      .prepare(
        `UPDATE ingredients SET ${[...sets, 'updated_at = ?', `edited_at = ${editedAt}`].join(', ')} WHERE id = ?`,
      )
      .run(...values, stamp, ...(row.catalog_key === null ? [] : [stamp]), id);
  });
  return getIngredient(ctx, person, id);
}

function countOf(ctx: AppContext, sql: string, id: Id): number {
  const row = ctx.db.prepare(sql).get(id);
  return row === undefined ? 0 : num(row, 'n');
}

export function deleteIngredient(ctx: AppContext, id: Id): undefined {
  withTransaction(ctx.db, () => {
    const row = ingredientRow(ctx, id);
    const name = text(row, 'name');
    const usage = {
      recipes: countOf(
        ctx,
        `SELECT COUNT(*) AS n FROM (SELECT recipe_id FROM recipe_lines WHERE ingredient_id = ?1
           UNION SELECT l.recipe_id FROM recipe_line_substitutes s JOIN recipe_lines l ON l.id = s.line_id
           WHERE s.ingredient_id = ?1)`,
        id,
      ),
      bottles: countOf(ctx, 'SELECT COUNT(*) AS n FROM bottles WHERE ingredient_id = ?', id),
      children: countOf(ctx, 'SELECT COUNT(*) AS n FROM ingredients WHERE parent_id = ?', id),
      menus: countOf(
        ctx,
        `SELECT COUNT(DISTINCT s.menu_id) AS n FROM menu_items m JOIN menu_sections s ON s.id = m.section_id
         WHERE m.ingredient_id = ?`,
        id,
      ),
    };
    const uses = [
      [usage.recipes, 'recipes'],
      [usage.bottles, 'bottles'],
      [usage.menus, 'menus'],
      [usage.children, 'child ingredients'],
    ]
      .filter(([count]) => count !== 0)
      .map(([count, what]) => `${count} ${what}`);
    if (uses.length > 0) {
      throw problem('in_use', {
        detail: `${name} is used in ${uses.join(' and ')}. Remove it from them first.`,
        usage,
      });
    }
    const madeInto = countOf(
      ctx,
      'SELECT COUNT(DISTINCT ingredient_id) AS n FROM ingredient_parts WHERE part_ingredient_id = ?',
      id,
    );
    if (madeInto > 0) {
      throw problem('in_use', {
        detail: `${name} is a part of ${madeInto} house-made ingredients. Remove it from them first.`,
        usage,
      });
    }
    ctx.db.prepare("DELETE FROM notes WHERE target_type = 'ingredient' AND target_id = ?").run(id);
    ctx.db.prepare("DELETE FROM ratings WHERE target_type = 'ingredient' AND target_id = ?").run(id);
    ctx.db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
    const key = textOrNull(row, 'catalog_key');
    if (key !== null) {
      ctx.db
        .prepare('INSERT OR IGNORE INTO catalog_deletions (type, key, deleted_at) VALUES (?, ?, ?)')
        .run(CATALOG_TYPE, key, ctx.now().toISOString());
    }
  });
}

export function setOnHand(ctx: AppContext, person: Person, id: Id, marked: boolean): OnHandState {
  const result = ctx.db
    .prepare('UPDATE ingredients SET on_hand = ?, on_hand_set_by = ?, on_hand_set_at = ? WHERE id = ?')
    .run(marked ? 1 : 0, person.id, ctx.now().toISOString(), id);
  if (result.changes === 0) {
    throw problem('not_found');
  }
  const onHand: OnHandSet = onHandIngredientIds(ctx.db);
  return {
    id,
    onHand: onHand.has(id),
    markedOnHand: marked,
    onHandReason: reasonOf(marked, shelfBottleCount(ctx, id), onHand.has(id)),
  };
}
