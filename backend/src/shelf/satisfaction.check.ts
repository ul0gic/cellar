import { readFileSync } from 'node:fs';
import { stdout } from 'node:process';
// biome-ignore lint/correctness/noUnresolvedImports: Biome 2.6.6's Node built-in module list lacks node:sqlite
import { DatabaseSync } from 'node:sqlite';
import { foldName } from '@cellar/contract';
import { LineStatusSchema, SubstitutionEffectSchema } from '@cellar/contract/schemas';
import { z } from 'zod';
import { SCHEMA_V1_SQL } from '../core/schema.ts';
import {
  buyNext,
  missingIngredientIds,
  onHandIngredientIds,
  recipeLineStatuses,
  recipeOutcomes,
} from './satisfaction.ts';

const FixtureSchema = z.object({
  ingredients: z.array(
    z.object({
      id: z.int(),
      name: z.string(),
      foldedName: z.string(),
      parentId: z.int().nullable(),
      onHand: z.boolean(),
    }),
  ),
  parts: z.array(z.object({ ingredientId: z.int(), position: z.int(), partIngredientId: z.int() })),
  bottles: z.array(z.object({ id: z.int(), ingredientId: z.int(), status: z.enum(['sealed', 'open', 'finished']) })),
  householdSubstitutions: z.array(
    z.object({ id: z.int(), onHandIngredientId: z.int(), forIngredientId: z.int(), effect: SubstitutionEffectSchema }),
  ),
  recipes: z.array(
    z.object({
      id: z.int(),
      name: z.string(),
      expected: z.object({ canMake: z.boolean(), missingCount: z.int() }),
      lines: z.array(
        z.object({
          id: z.int(),
          position: z.int(),
          ingredientId: z.int(),
          optional: z.boolean(),
          specified: z.boolean(),
          substitutes: z.array(z.int()),
          expected: z.object({
            status: LineStatusSchema,
            satisfiedBy: z.int().nullable(),
            substitutionEffect: SubstitutionEffectSchema.nullable(),
          }),
        }),
      ),
    }),
  ),
  expected: z.object({
    onHand: z.array(z.int()),
    buyNext: z.array(z.object({ ingredientId: z.int(), unlocks: z.array(z.int()) })),
  }),
});
type Fixture = z.infer<typeof FixtureSchema>;

const STAMP = '2026-01-01T00:00:00.000Z';

function load(db: DatabaseSync, fixture: Fixture): void {
  db.exec(SCHEMA_V1_SQL);
  db.exec('BEGIN');
  const ingredient = db.prepare(
    'INSERT INTO ingredients (id, name, folded_name, parent_id, on_hand, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
  );
  for (const row of fixture.ingredients) {
    ingredient.run(row.id, row.name, foldName(row.name), row.onHand ? 1 : 0, STAMP, STAMP);
  }
  const parent = db.prepare('UPDATE ingredients SET parent_id = ? WHERE id = ?');
  for (const row of fixture.ingredients) {
    if (row.parentId !== null) {
      parent.run(row.parentId, row.id);
    }
  }
  const part = db.prepare(
    'INSERT INTO ingredient_parts (ingredient_id, position, part_ingredient_id) VALUES (?, ?, ?)',
  );
  for (const row of fixture.parts) {
    part.run(row.ingredientId, row.position, row.partIngredientId);
  }
  const bottle = db.prepare(
    "INSERT INTO bottles (id, name, ingredient_id, labeled_size, status, created_at, updated_at) VALUES (?, ?, ?, '750 ml', ?, ?, ?)",
  );
  for (const row of fixture.bottles) {
    bottle.run(row.id, `Bottle ${row.id}`, row.ingredientId, row.status, STAMP, STAMP);
  }
  const substitution = db.prepare(
    'INSERT INTO household_substitutions (id, on_hand_ingredient_id, for_ingredient_id, effect, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (const row of fixture.householdSubstitutions) {
    substitution.run(row.id, row.onHandIngredientId, row.forIngredientId, row.effect, STAMP);
  }
  const recipe = db.prepare(
    "INSERT INTO recipes (id, name, folded_name, instructions, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)",
  );
  const line = db.prepare(
    "INSERT INTO recipe_lines (id, recipe_id, position, ingredient_id, unit, optional, specified) VALUES (?, ?, ?, ?, 'ml', ?, ?)",
  );
  const substitute = db.prepare(
    'INSERT INTO recipe_line_substitutes (line_id, position, ingredient_id) VALUES (?, ?, ?)',
  );
  for (const row of fixture.recipes) {
    recipe.run(row.id, row.name, foldName(row.name), STAMP, STAMP);
    for (const l of row.lines) {
      line.run(l.id, row.id, l.position, l.ingredientId, l.optional ? 1 : 0, l.specified ? 1 : 0);
      for (const [position, id] of l.substitutes.entries()) {
        substitute.run(l.id, position, id);
      }
    }
  }
  db.exec('COMMIT');
}

function check(fixture: Fixture): string[] {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  load(db, fixture);
  const mismatches: string[] = [];
  const compare = (what: string, actual: unknown, expected: unknown): void => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches.push(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  compare(
    'onHandIngredientIds',
    [...onHandIngredientIds(db)].sort((a, b) => a - b),
    fixture.expected.onHand,
  );
  const outcomes = recipeOutcomes(db);
  const filtered = recipeOutcomes(db, { recipeIds: fixture.recipes.map((recipe) => recipe.id) });
  compare('recipeOutcomes size', outcomes.size, fixture.recipes.length);
  for (const recipe of fixture.recipes) {
    const outcome = outcomes.get(recipe.id);
    compare(
      `recipe ${recipe.id} outcome`,
      outcome && { canMake: outcome.canMake, missingCount: outcome.missingCount },
      recipe.expected,
    );
    compare(`recipe ${recipe.id} filtered outcome`, filtered.get(recipe.id), outcome);
    const statuses = recipeLineStatuses(db, recipe.id);
    compare(
      `recipe ${recipe.id} line order`,
      statuses.map((row) => row.lineId),
      recipe.lines.map((l) => l.id),
    );
    const byLine = new Map(statuses.map((row) => [row.lineId, row]));
    for (const l of recipe.lines) {
      const row = byLine.get(l.id);
      compare(
        `recipe ${recipe.id} line ${l.id}`,
        row && { status: row.status, satisfiedBy: row.satisfiedBy, substitutionEffect: row.substitutionEffect },
        l.expected,
      );
    }
    const missingLines = recipe.lines.filter((l) => !l.optional && l.expected.status === 'missing');
    compare(
      `recipe ${recipe.id} missing lines agree with missingCount`,
      missingLines.length,
      recipe.expected.missingCount,
    );
    compare(`recipe ${recipe.id} missingIngredientIds`, missingIngredientIds(db, recipe.id), [
      ...new Set(missingLines.map((l) => l.ingredientId)),
    ]);
  }
  compare('buyNext(10)', buyNext(db, 10), fixture.expected.buyNext);
  compare('buyNext(2)', buyNext(db, 2), fixture.expected.buyNext.slice(0, 2));
  db.close();
  return mismatches;
}

const loaded = FixtureSchema.parse(
  JSON.parse(readFileSync(new URL('./satisfaction.fixture.json', import.meta.url), 'utf8')),
);
const mismatches = check(loaded);
for (const mismatch of mismatches) {
  stdout.write(`MISMATCH ${mismatch}\n`);
}
stdout.write(`satisfaction: ${loaded.recipes.length} recipes, ${mismatches.length} mismatches\n`);
process.exitCode = mismatches.length === 0 ? 0 : 1;
