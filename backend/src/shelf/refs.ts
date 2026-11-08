import type { Id, ImageRef, IngredientRef, RecipeRef, TaxonRef } from '@cellar/contract';
import type { AppContext, ImageRow } from '../core/context.ts';
import { imageColumns, imageRowOrNull, num, numOrNull, text } from './rows.ts';
import type { OnHandSet } from './satisfaction.ts';

export interface TaxonNode {
  readonly id: Id;
  readonly parentId: Id | null;
  readonly name: string;
  readonly foldedName: string;
}

export interface Taxonomy {
  readonly nodes: ReadonlyMap<Id, TaxonNode>;
  readonly children: ReadonlyMap<Id | null, readonly TaxonNode[]>;
}

export function byName(a: { foldedName: string; id: Id }, b: { foldedName: string; id: Id }): number {
  if (a.foldedName !== b.foldedName) {
    return a.foldedName < b.foldedName ? -1 : 1;
  }
  return a.id - b.id;
}

export function loadTaxonomy(ctx: AppContext): Taxonomy {
  const nodes = new Map<Id, TaxonNode>();
  const children = new Map<Id | null, TaxonNode[]>();
  for (const row of ctx.db.prepare('SELECT id, parent_id, name, folded_name FROM ingredients').all()) {
    const node: TaxonNode = {
      id: num(row, 'id'),
      parentId: numOrNull(row, 'parent_id'),
      name: text(row, 'name'),
      foldedName: text(row, 'folded_name'),
    };
    nodes.set(node.id, node);
  }
  for (const node of nodes.values()) {
    const key = node.parentId !== null && nodes.has(node.parentId) ? node.parentId : null;
    const siblings = children.get(key);
    if (siblings === undefined) {
      children.set(key, [node]);
    } else {
      siblings.push(node);
    }
  }
  for (const siblings of children.values()) {
    siblings.sort(byName);
  }
  return { nodes, children };
}

export function ancestorsOf(taxonomy: Taxonomy, id: Id): TaxonNode[] {
  const path: TaxonNode[] = [];
  let parentId = taxonomy.nodes.get(id)?.parentId ?? null;
  while (parentId !== null) {
    const parent = taxonomy.nodes.get(parentId);
    if (parent === undefined) {
      break;
    }
    path.unshift(parent);
    parentId = parent.parentId;
  }
  return path;
}

export function descendantsAndSelf(taxonomy: Taxonomy, id: Id): Set<Id> {
  const found = new Set<Id>([id]);
  const pending = [id];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const child of taxonomy.children.get(next) ?? []) {
      if (!found.has(child.id)) {
        found.add(child.id);
        pending.push(child.id);
      }
    }
  }
  return found;
}

export function taxonRef(node: TaxonNode): TaxonRef {
  return { id: node.id, name: node.name };
}

export function rootOf(taxonomy: Taxonomy, node: TaxonNode): TaxonRef {
  return taxonRef(ancestorsOf(taxonomy, node.id)[0] ?? node);
}

export function ingredientRef(id: Id, name: string, onHand: OnHandSet): IngredientRef {
  return { id, name, onHand: onHand.has(id) };
}

export function toImageRef(ctx: AppContext): (row: ImageRow) => ImageRef {
  return (row) => ctx.media.imageRef(row, ctx.settings.basePath);
}

export function imageRef(ctx: AppContext, row: ImageRow | null): ImageRef | null {
  return row === null ? null : ctx.media.imageRef(row, ctx.settings.basePath);
}

export const RECIPE_REF_SELECT = `SELECT r.id, r.name, ${imageColumns('im', 'image')}
FROM recipes r
LEFT JOIN recipe_images ri ON ri.recipe_id = r.id
  AND ri.position = (SELECT MIN(position) FROM recipe_images WHERE recipe_id = r.id)
LEFT JOIN images im ON im.id = ri.image_id`;

export function recipeRefOf(ctx: AppContext, row: Readonly<Record<string, unknown>>): RecipeRef {
  return { id: num(row, 'id'), name: text(row, 'name'), image: imageRef(ctx, imageRowOrNull(row, 'image')) };
}

export function recipeRefs(ctx: AppContext, ids: readonly Id[]): Map<Id, RecipeRef> {
  const refs = new Map<Id, RecipeRef>();
  if (ids.length === 0) {
    return refs;
  }
  const rows = ctx.db
    .prepare(`${RECIPE_REF_SELECT} WHERE r.id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify(ids));
  for (const row of rows) {
    const ref = recipeRefOf(ctx, row);
    refs.set(ref.id, ref);
  }
  return refs;
}
