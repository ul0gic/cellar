import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { type CatalogApplyReport, type CatalogCounts, foldName, type Job } from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import { type Database, withTransaction } from '../core/db.ts';
import type { JobProgress } from '../core/jobs.ts';
import { problem } from '../core/problems.ts';
import {
  builtinDamaged,
  type CatalogReleaseDir,
  shippedRelease,
  checkRelease,
  type ReleaseCounts,
  ReleaseCheckError,
  type ReleaseData,
  type ReleaseImage,
} from './release.ts';

type CatalogTable =
  | 'glasses'
  | 'methods'
  | 'utensils'
  | 'taste_descriptors'
  | 'calculators'
  | 'ingredients'
  | 'recipes';

interface Held {
  readonly id: number;
  readonly edited: boolean;
}

interface Provenance {
  readonly key: string;
  readonly rev: string;
  readonly name: string;
}

export function catalogCounts(counts: ReleaseCounts): CatalogCounts {
  return {
    recipes: counts.recipes,
    ingredients: counts.ingredients,
    images: counts.images,
    glasses: counts.glasses,
    methods: counts.methods,
    utensils: counts.utensils,
    calculators: counts.calculators,
    descriptors: counts.tasteDescriptors,
  };
}

function insertedId(db: Database, sql: string, ...params: (string | number | null)[]): number {
  const result = db.prepare(sql).run(...params);
  return Number(result.lastInsertRowid);
}

class LoadPlan {
  readonly added: CatalogCounts = {
    recipes: 0,
    ingredients: 0,
    images: 0,
    glasses: 0,
    methods: 0,
    utensils: 0,
    calculators: 0,
    descriptors: 0,
  };
  skippedEdited = 0;
  skippedDeleted = 0;
  private readonly db: Database;
  private readonly version: string;
  private readonly now: string;
  private readonly releaseDir: string;
  private readonly staging: string;

  constructor(db: Database, version: string, now: string, releaseDir: string, staging: string) {
    this.db = db;
    this.version = version;
    this.now = now;
    this.releaseDir = releaseDir;
    this.staging = staging;
  }

  deleted(table: CatalogTable): Set<string> {
    const rows = this.db.prepare('SELECT key FROM catalog_deletions WHERE type = ?').all(table);
    return new Set(rows.flatMap((row) => (typeof row.key === 'string' ? [row.key] : [])));
  }

  held(table: CatalogTable): Map<string, Held> {
    const rows = this.db.prepare(`SELECT id, catalog_key, edited_at FROM ${table} WHERE catalog_key IS NOT NULL`).all();
    const held = new Map<string, Held>();
    for (const row of rows) {
      if (typeof row.id === 'number' && typeof row.catalog_key === 'string') {
        held.set(row.catalog_key, { id: row.id, edited: row.edited_at !== null });
      }
    }
    return held;
  }

  householdByName(table: CatalogTable): Map<string, number> {
    const rows = this.db.prepare(`SELECT id, name FROM ${table} WHERE catalog_key IS NULL`).all();
    const byName = new Map<string, number>();
    for (const row of rows) {
      if (typeof row.id === 'number' && typeof row.name === 'string' && !byName.has(foldName(row.name))) {
        byName.set(foldName(row.name), row.id);
      }
    }
    return byName;
  }

  place<R extends Provenance>(
    table: CatalogTable,
    records: readonly R[],
    linkByName: boolean,
    insert: (record: R) => number,
    progress: JobProgress,
    doneBefore: number,
    unusable: (record: R) => boolean = () => false,
  ): Map<string, number> {
    const deleted = this.deleted(table);
    const held = this.held(table);
    const household = linkByName ? this.householdByName(table) : new Map<string, number>();
    const ids = new Map<string, number>();
    let done = doneBefore;
    for (const record of records) {
      done += 1;
      progress.done(done);
      if (deleted.has(record.key)) {
        this.skippedDeleted += 1;
        continue;
      }
      const existing = held.get(record.key);
      if (existing !== undefined) {
        if (existing.edited) {
          this.skippedEdited += 1;
        }
        ids.set(record.key, existing.id);
        continue;
      }
      const match = household.get(foldName(record.name));
      if (match !== undefined) {
        this.db
          .prepare(
            `UPDATE ${table} SET catalog_key = ?, catalog_rev = ?, catalog_version = ?, edited_at = ? WHERE id = ?`,
          )
          .run(record.key, record.rev, this.version, this.now, match);
        household.delete(foldName(record.name));
        this.skippedEdited += 1;
        ids.set(record.key, match);
        continue;
      }
      if (unusable(record)) {
        this.skippedDeleted += 1;
        continue;
      }
      ids.set(record.key, insert(record));
    }
    return ids;
  }

  provenance(record: Provenance): [string, string, string, string, string] {
    return [record.key, record.rev, this.version, this.now, this.now];
  }

  image(image: ReleaseImage, purpose: 'recipe' | 'ingredient'): number {
    const target = join(this.staging, image.file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(this.releaseDir, image.file), target);
    this.added.images += 1;
    return insertedId(
      this.db,
      `INSERT INTO images (file_name, media_type, bytes, width, height, thumbhash, purpose, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      `catalog/${this.version}/${image.file}`,
      image.mediaType,
      image.bytes,
      image.width,
      image.height,
      image.placeholder,
      purpose,
      this.now,
    );
  }

  tagId(name: string): number {
    const folded = foldName(name);
    const row = this.db.prepare('SELECT id FROM tags WHERE folded_name = ?').get(folded);
    if (row !== undefined && typeof row.id === 'number') {
      return row.id;
    }
    return insertedId(
      this.db,
      'INSERT INTO tags (name, folded_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      name,
      folded,
      this.now,
      this.now,
    );
  }
}

const PROVENANCE_COLUMNS = 'catalog_key, catalog_rev, catalog_version, created_at, updated_at';

function writeTaxonomy(plan: LoadPlan, data: ReleaseData, progress: JobProgress, db: Database) {
  progress.step(
    'Adding glasses, methods and utensils',
    data.glasses.length +
      data.methods.length +
      data.utensils.length +
      data.tasteDescriptors.length +
      data.calculators.length,
  );
  let done = 0;
  const glasses = plan.place(
    'glasses',
    data.glasses,
    true,
    (glass) => {
      plan.added.glasses += 1;
      return insertedId(
        db,
        `INSERT INTO glasses (name, folded_name, description, volume_ml, ${PROVENANCE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        glass.name,
        foldName(glass.name),
        glass.description ?? '',
        glass.capacityMl,
        ...plan.provenance(glass),
      );
    },
    progress,
    done,
  );
  done += data.glasses.length;
  const methods = plan.place(
    'methods',
    data.methods,
    true,
    (method) => {
      plan.added.methods += 1;
      return insertedId(
        db,
        `INSERT INTO methods (name, folded_name, dilution_percent, ${PROVENANCE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        method.name,
        foldName(method.name),
        method.dilutionPercent,
        ...plan.provenance(method),
      );
    },
    progress,
    done,
  );
  done += data.methods.length;
  const utensils = plan.place(
    'utensils',
    data.utensils,
    true,
    (utensil) => {
      plan.added.utensils += 1;
      return insertedId(
        db,
        `INSERT INTO utensils (name, folded_name, description, ${PROVENANCE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        utensil.name,
        foldName(utensil.name),
        utensil.description ?? '',
        ...plan.provenance(utensil),
      );
    },
    progress,
    done,
  );
  done += data.utensils.length;
  plan.place(
    'taste_descriptors',
    data.tasteDescriptors,
    true,
    (descriptor) => {
      plan.added.descriptors += 1;
      return insertedId(
        db,
        `INSERT INTO taste_descriptors (name, folded_name, ${PROVENANCE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        descriptor.name,
        foldName(descriptor.name),
        ...plan.provenance(descriptor),
      );
    },
    progress,
    done,
  );
  done += data.tasteDescriptors.length;
  plan.place(
    'calculators',
    data.calculators,
    true,
    (calculator) => {
      plan.added.calculators += 1;
      return insertedId(
        db,
        `INSERT INTO calculators (name, description, inputs_json, outputs_json, created_by, ${PROVENANCE_COLUMNS}) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        calculator.name,
        calculator.description ?? '',
        JSON.stringify(calculator.inputs),
        JSON.stringify(calculator.outputs),
        ...plan.provenance(calculator),
      );
    },
    progress,
    done,
  );
  return { glasses, methods, utensils };
}

function writeIngredients(plan: LoadPlan, data: ReleaseData, progress: JobProgress, db: Database): Map<string, number> {
  progress.step('Adding ingredients', data.ingredients.length);
  const inserted: (typeof data.ingredients)[number][] = [];
  const ids = plan.place(
    'ingredients',
    data.ingredients,
    true,
    (ingredient) => {
      plan.added.ingredients += 1;
      inserted.push(ingredient);
      const imageId = ingredient.images[0] === undefined ? null : plan.image(ingredient.images[0], 'ingredient');
      return insertedId(
        db,
        `INSERT INTO ingredients (name, folded_name, strength, description, color, origin, default_unit, image_id, ${PROVENANCE_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ingredient.name,
        foldName(ingredient.name),
        ingredient.strength,
        ingredient.description ?? '',
        ingredient.color,
        ingredient.origin,
        ingredient.defaultUnit,
        imageId,
        ...plan.provenance(ingredient),
      );
    },
    progress,
    0,
  );
  const setParent = db.prepare('UPDATE ingredients SET parent_id = ? WHERE id = ?');
  const addPart = db.prepare(
    'INSERT INTO ingredient_parts (ingredient_id, position, part_ingredient_id, amount, unit) VALUES (?, ?, ?, ?, ?)',
  );
  for (const ingredient of inserted) {
    const id = ids.get(ingredient.key);
    if (id === undefined) {
      continue;
    }
    const parentId = ingredient.parent === null ? undefined : ids.get(ingredient.parent);
    if (parentId !== undefined) {
      setParent.run(parentId, id);
    }
    let position = 0;
    for (const part of ingredient.parts) {
      const partId = ids.get(part.ingredient);
      if (partId !== undefined) {
        addPart.run(id, position, partId, part.amount, part.unit);
        position += 1;
      }
    }
  }
  return ids;
}

function writeRecipes(
  plan: LoadPlan,
  data: ReleaseData,
  progress: JobProgress,
  db: Database,
  refs: {
    glasses: Map<string, number>;
    methods: Map<string, number>;
    utensils: Map<string, number>;
    ingredients: Map<string, number>;
  },
): void {
  progress.step('Adding recipes', data.recipes.length);
  const addLine = db.prepare(
    `INSERT INTO recipe_lines (recipe_id, position, ingredient_id, amount, amount_max, unit, optional, specified, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const addSubstitute = db.prepare(
    `INSERT INTO recipe_line_substitutes (line_id, position, ingredient_id, amount, amount_max, unit)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const addImage = db.prepare('INSERT INTO recipe_images (recipe_id, image_id, position) VALUES (?, ?, ?)');
  const addTag = db.prepare('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)');
  const addUtensil = db.prepare('INSERT OR IGNORE INTO recipe_utensils (recipe_id, utensil_id) VALUES (?, ?)');
  const inserted: (typeof data.recipes)[number][] = [];
  const ids = plan.place(
    'recipes',
    data.recipes,
    false,
    (recipe) => {
      const id = insertedId(
        db,
        `INSERT INTO recipes (name, folded_name, description, instructions, garnish, glass_id, method_id, year, source, created_by, ${PROVENANCE_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        recipe.name,
        foldName(recipe.name),
        recipe.description ?? '',
        recipe.instructions,
        recipe.garnish ?? '',
        recipe.glass === null ? null : (refs.glasses.get(recipe.glass) ?? null),
        recipe.method === null ? null : (refs.methods.get(recipe.method) ?? null),
        recipe.year,
        recipe.source ?? '',
        ...plan.provenance(recipe),
      );
      for (const [position, line] of recipe.lines.entries()) {
        const ingredientId = refs.ingredients.get(line.ingredient);
        if (ingredientId === undefined) {
          throw new Error(`${recipe.key}: ingredient ${line.ingredient} has no row`);
        }
        const lineId = Number(
          addLine.run(
            id,
            position,
            ingredientId,
            line.amount,
            line.amountMax,
            line.unit,
            line.optional ? 1 : 0,
            line.specified ? 1 : 0,
            line.note ?? '',
          ).lastInsertRowid,
        );
        let substitutePosition = 0;
        for (const substitute of line.substitutes) {
          const substituteId = refs.ingredients.get(substitute.ingredient);
          if (substituteId !== undefined) {
            addSubstitute.run(
              lineId,
              substitutePosition,
              substituteId,
              substitute.amount,
              substitute.amountMax,
              substitute.unit,
            );
            substitutePosition += 1;
          }
        }
      }
      for (const [position, image] of recipe.images.entries()) {
        addImage.run(id, plan.image(image, 'recipe'), position);
      }
      for (const tag of recipe.tags) {
        addTag.run(id, plan.tagId(tag));
      }
      for (const utensil of recipe.utensils) {
        const utensilId = refs.utensils.get(utensil);
        if (utensilId !== undefined) {
          addUtensil.run(id, utensilId);
        }
      }
      plan.added.recipes += 1;
      inserted.push(recipe);
      return id;
    },
    progress,
    0,
    (recipe) => recipe.lines.some((line) => !refs.ingredients.has(line.ingredient)),
  );
  const setParent = db.prepare('UPDATE recipes SET parent_recipe_id = ? WHERE id = ?');
  for (const recipe of inserted) {
    const id = ids.get(recipe.key);
    const parentId = recipe.parent === null ? undefined : ids.get(recipe.parent);
    if (id !== undefined && parentId !== undefined) {
      setParent.run(parentId, id);
    }
  }
}

export function startCatalogLoad(ctx: AppContext, startedBySessionHash: string | null): Job {
  const release = shippedRelease(ctx.settings);
  return ctx.jobs.start('catalog_load', startedBySessionHash, (progress) => catalogLoadRelease(ctx, release, progress));
}

export async function catalogLoadRelease(
  ctx: AppContext,
  release: CatalogReleaseDir,
  progress: JobProgress,
): Promise<CatalogApplyReport> {
  progress.step('Checking the catalog', null);
  const data = await checkedData(ctx, release);
  await setImmediate();
  return writeRelease(ctx, release, data, progress);
}

async function checkedData(ctx: AppContext, release: CatalogReleaseDir): Promise<ReleaseData> {
  const shipped = release.dir.startsWith(ctx.settings.shippedCatalogDir);
  try {
    return await checkRelease(release, null);
  } catch (error) {
    if (!(error instanceof ReleaseCheckError)) {
      throw error;
    }
    if (shipped) {
      throw builtinDamaged(error.message);
    }
    if (error.failure === 'damaged') {
      throw problem('catalog_damaged');
    }
    throw problem('catalog_invalid', {
      detail: `Catalog ${release.manifest.version} failed its checks, so nothing was changed: ${error.message}.`,
    });
  }
}

function writeRelease(
  ctx: AppContext,
  release: CatalogReleaseDir,
  data: ReleaseData,
  progress: JobProgress,
): CatalogApplyReport {
  const version = data.version;
  const now = ctx.now().toISOString();
  const staging = join(ctx.settings.dataDir, 'tmp', `catalog-stage-${version}`);
  const target = join(ctx.settings.dataDir, 'catalog', version);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    const report = withTransaction(ctx.db, () => {
      const plan = new LoadPlan(ctx.db, version, now, release.dir, staging);
      const taxonomy = writeTaxonomy(plan, data, progress, ctx.db);
      const ingredients = writeIngredients(plan, data, progress, ctx.db);
      writeRecipes(plan, data, progress, ctx.db, { ...taxonomy, ingredients });
      progress.step('Copying images', plan.added.images);
      progress.done(plan.added.images);
      ctx.db
        .prepare('INSERT INTO catalog_loads (version, loaded_at, counts_json) VALUES (?, ?, ?)')
        .run(version, now, JSON.stringify(catalogCounts(release.manifest.counts)));
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      renameSync(staging, target);
      return {
        version,
        added: plan.added,
        skippedEdited: plan.skippedEdited,
        skippedDeleted: plan.skippedDeleted,
      };
    });
    return report;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
