import type { Id, LineCoverage, LineStatus, SubstitutionEffect } from '@cellar/contract';
import { LineCoverageSchema, LineStatusSchema, SubstitutionEffectSchema } from '@cellar/contract/schemas';
// biome-ignore lint/correctness/noUnresolvedImports: Biome 2.6.6's Node built-in module list lacks node:sqlite
import type { StatementSync } from 'node:sqlite';
import type { Database } from '../core/db.ts';

export type OnHandSet = ReadonlySet<Id>;

export interface RecipeOutcome {
  recipeId: Id;
  missingCount: number;
  canMake: boolean;
}

export interface LineStatusRow {
  lineId: Id;
  status: LineStatus;
  satisfiedBy: Id | null;
  substitutionEffect: SubstitutionEffect | null;
}

export interface BuyNextRow {
  ingredientId: Id;
  unlocks: Id[];
}

const ON_HAND = `
direct(id) AS MATERIALIZED (
  SELECT id FROM ingredients WHERE on_hand = 1
  UNION
  SELECT ingredient_id FROM bottles WHERE status IN ('sealed', 'open')
),
part_missing(id) AS (
  SELECT p.part_ingredient_id FROM ingredient_parts p
  WHERE p.part_ingredient_id NOT IN (SELECT id FROM direct)
    AND NOT EXISTS (SELECT 1 FROM ingredient_parts q WHERE q.ingredient_id = p.part_ingredient_id)
  UNION
  SELECT p.ingredient_id FROM ingredient_parts p JOIN part_missing m ON m.id = p.part_ingredient_id
  WHERE p.ingredient_id NOT IN (SELECT id FROM direct)
),
on_hand(id) AS MATERIALIZED (
  SELECT id FROM direct
  UNION
  SELECT ingredient_id FROM ingredient_parts WHERE ingredient_id NOT IN (SELECT id FROM part_missing)
)`;

const SATISFACTION = `${ON_HAND},
on_hand_ancestor(id) AS (
  SELECT i.parent_id FROM on_hand o JOIN ingredients i ON i.id = o.id WHERE i.parent_id IS NOT NULL
  UNION
  SELECT i.parent_id FROM on_hand_ancestor a JOIN ingredients i ON i.id = a.id WHERE i.parent_id IS NOT NULL
),
household_target(id) AS MATERIALIZED (
  SELECT for_ingredient_id FROM household_substitutions
  WHERE on_hand_ingredient_id IN (SELECT id FROM on_hand)
)`;

const LINE_MISSING = `NOT (
  l.ingredient_id IN (SELECT id FROM on_hand)
  OR EXISTS (
    SELECT 1 FROM recipe_line_substitutes s
    WHERE s.line_id = l.id AND s.ingredient_id IN (SELECT id FROM on_hand)
  )
  OR (l.specified = 0 AND l.ingredient_id IN (SELECT id FROM on_hand_ancestor))
  OR l.ingredient_id IN (SELECT id FROM household_target)
)`;

function outcomesSql(recipeFilter: string): string {
  return `WITH RECURSIVE ${SATISFACTION}
SELECT r.id AS recipeId, COALESCE(SUM(l.optional = 0 AND ${LINE_MISSING}), 0) AS missingCount
FROM recipes r LEFT JOIN recipe_lines l ON l.recipe_id = r.id
${recipeFilter}
GROUP BY r.id`;
}

const SQL = {
  onHand: `WITH RECURSIVE ${ON_HAND} SELECT id FROM on_hand`,

  outcomes: outcomesSql(''),

  outcomesFor: outcomesSql('WHERE r.id IN (SELECT value FROM json_each(?))'),

  lineStatuses: `WITH RECURSIVE ${SATISFACTION},
line AS (SELECT id, position, ingredient_id, specified FROM recipe_lines WHERE recipe_id = ?),
descendant(line_id, id, distance) AS (
  SELECT line.id, i.id, 1 FROM line JOIN ingredients i ON i.parent_id = line.ingredient_id
  WHERE line.specified = 0
  UNION ALL
  SELECT d.line_id, i.id, d.distance + 1 FROM descendant d JOIN ingredients i ON i.parent_id = d.id
),
candidate AS (
  SELECT
    line.id AS line_id,
    line.position,
    line.ingredient_id,
    line.ingredient_id IN (SELECT id FROM direct) AS c1,
    (SELECT s.ingredient_id FROM recipe_line_substitutes s
      WHERE s.line_id = line.id AND s.ingredient_id IN (SELECT id FROM on_hand)
      ORDER BY s.position LIMIT 1) AS c2,
    (SELECT d.id FROM descendant d JOIN ingredients i ON i.id = d.id
      WHERE d.line_id = line.id AND d.id IN (SELECT id FROM on_hand)
      ORDER BY d.distance, i.folded_name, i.id LIMIT 1) AS c3,
    (SELECT h.id FROM household_substitutions h JOIN ingredients i ON i.id = h.on_hand_ingredient_id
      WHERE h.for_ingredient_id = line.ingredient_id AND h.on_hand_ingredient_id IN (SELECT id FROM on_hand)
      ORDER BY i.folded_name, i.id LIMIT 1) AS c4,
    line.ingredient_id IN (SELECT id FROM on_hand) AS c5
  FROM line
)
SELECT
  c.line_id AS lineId,
  CASE
    WHEN c.c1 THEN 'on_hand'
    WHEN c.c2 IS NOT NULL THEN 'via_substitute'
    WHEN c.c3 IS NOT NULL THEN 'via_variant'
    WHEN c.c4 IS NOT NULL THEN 'via_household_substitution'
    WHEN c.c5 THEN 'via_house_made'
    ELSE 'missing'
  END AS status,
  CASE
    WHEN c.c1 THEN NULL
    WHEN c.c2 IS NOT NULL THEN c.c2
    WHEN c.c3 IS NOT NULL THEN c.c3
    WHEN c.c4 IS NOT NULL THEN h.on_hand_ingredient_id
    WHEN c.c5 THEN c.ingredient_id
  END AS satisfiedBy,
  CASE WHEN NOT c.c1 AND c.c2 IS NULL AND c.c3 IS NULL THEN h.effect END AS substitutionEffect
FROM candidate c LEFT JOIN household_substitutions h ON h.id = c.c4
ORDER BY c.position`,

  lineCoverage: `WITH RECURSIVE ${SATISFACTION}
SELECT
  l.recipe_id AS recipeId,
  CASE
    WHEN l.ingredient_id IN (SELECT id FROM direct) THEN 'on_hand'
    WHEN ${LINE_MISSING} THEN 'missing'
    ELSE 'covered'
  END AS coverage
FROM recipe_lines l
WHERE l.recipe_id IN (SELECT value FROM json_each(?)) AND l.optional = 0
ORDER BY l.recipe_id, l.position`,

  missingIngredients: `WITH RECURSIVE ${SATISFACTION}
SELECT l.ingredient_id AS ingredientId
FROM recipe_lines l
WHERE l.recipe_id = ? AND l.optional = 0 AND ${LINE_MISSING}
GROUP BY l.ingredient_id
ORDER BY MIN(l.position)`,

  buyNext: `WITH RECURSIVE ${SATISFACTION},
gap AS MATERIALIZED (
  SELECT l.id, l.recipe_id, l.ingredient_id, l.specified
  FROM recipe_lines l WHERE l.optional = 0 AND ${LINE_MISSING}
),
gap_recipe AS MATERIALIZED (
  SELECT recipe_id, COUNT(*) AS missing_count FROM gap GROUP BY recipe_id
),
gap_descendant(line_id, id) AS (
  SELECT g.id, i.id FROM gap g JOIN ingredients i ON i.parent_id = g.ingredient_id
  WHERE g.specified = 0
  UNION
  SELECT d.line_id, i.id FROM gap_descendant d JOIN ingredients i ON i.parent_id = d.id
),
cover(ingredient_id, line_id, recipe_id) AS (
  SELECT ingredient_id, id, recipe_id FROM gap
  UNION
  SELECT s.ingredient_id, g.id, g.recipe_id FROM gap g JOIN recipe_line_substitutes s ON s.line_id = g.id
  UNION
  SELECT d.id, g.id, g.recipe_id FROM gap_descendant d JOIN gap g ON g.id = d.line_id
  UNION
  SELECT h.on_hand_ingredient_id, g.id, g.recipe_id
  FROM gap g JOIN household_substitutions h ON h.for_ingredient_id = g.ingredient_id
  UNION
  SELECT p.part_ingredient_id, g.id, g.recipe_id
  FROM gap g JOIN ingredient_parts p ON p.ingredient_id = g.ingredient_id
  WHERE p.part_ingredient_id NOT IN (SELECT id FROM on_hand)
    AND (SELECT COUNT(DISTINCT q.part_ingredient_id) FROM ingredient_parts q
         WHERE q.ingredient_id = g.ingredient_id
           AND q.part_ingredient_id NOT IN (SELECT id FROM on_hand)) = 1
),
unlock AS MATERIALIZED (
  SELECT c.ingredient_id, c.recipe_id
  FROM cover c JOIN gap_recipe g ON g.recipe_id = c.recipe_id
  GROUP BY c.ingredient_id, c.recipe_id, g.missing_count
  HAVING COUNT(*) = g.missing_count
)
SELECT u.ingredient_id AS ingredientId, u.recipe_id AS recipeId
FROM unlock u JOIN ingredients i ON i.id = u.ingredient_id JOIN recipes r ON r.id = u.recipe_id
ORDER BY COUNT(*) OVER (PARTITION BY u.ingredient_id) DESC, i.folded_name, i.id, r.folded_name, r.id`,
} as const;

const statements = new WeakMap<Database, Map<string, StatementSync>>();

function prepared(db: Database, text: string): StatementSync {
  let cache = statements.get(db);
  if (cache === undefined) {
    cache = new Map();
    statements.set(db, cache);
  }
  let statement = cache.get(text);
  if (statement === undefined) {
    statement = db.prepare(text);
    cache.set(text, statement);
  }
  return statement;
}

const substitutionEffect = SubstitutionEffectSchema.nullable();

export function onHandIngredientIds(db: Database): OnHandSet {
  return new Set(
    prepared(db, SQL.onHand)
      .all()
      .map((row) => Number(row.id)),
  );
}

export function recipeOutcomes(db: Database, filter?: { recipeIds?: Id[] }): Map<Id, RecipeOutcome> {
  const rows =
    filter?.recipeIds === undefined
      ? prepared(db, SQL.outcomes).all()
      : prepared(db, SQL.outcomesFor).all(JSON.stringify(filter.recipeIds));
  const outcomes = new Map<Id, RecipeOutcome>();
  for (const row of rows) {
    const recipeId = Number(row.recipeId);
    const missingCount = Number(row.missingCount);
    outcomes.set(recipeId, { recipeId, missingCount, canMake: missingCount === 0 });
  }
  return outcomes;
}

export function recipeLineStatuses(db: Database, recipeId: Id): LineStatusRow[] {
  return prepared(db, SQL.lineStatuses)
    .all(recipeId)
    .map((row) => ({
      lineId: Number(row.lineId),
      status: LineStatusSchema.parse(row.status),
      satisfiedBy: row.satisfiedBy === null ? null : Number(row.satisfiedBy),
      substitutionEffect: substitutionEffect.parse(row.substitutionEffect),
    }));
}

export function recipeLineCoverage(db: Database, recipeIds: Id[]): Map<Id, LineCoverage[]> {
  const coverage = new Map<Id, LineCoverage[]>();
  for (const row of prepared(db, SQL.lineCoverage).iterate(JSON.stringify(recipeIds))) {
    const recipeId = Number(row.recipeId);
    const lines = coverage.get(recipeId) ?? [];
    lines.push(LineCoverageSchema.parse(row.coverage));
    coverage.set(recipeId, lines);
  }
  return coverage;
}

export function buyNext(db: Database, limit: number): BuyNextRow[] {
  const result: BuyNextRow[] = [];
  let current: BuyNextRow | undefined;
  for (const row of prepared(db, SQL.buyNext).iterate()) {
    const ingredientId = Number(row.ingredientId);
    if (current?.ingredientId !== ingredientId) {
      if (result.length === limit) {
        break;
      }
      current = { ingredientId, unlocks: [] };
      result.push(current);
    }
    current.unlocks.push(Number(row.recipeId));
  }
  return result;
}

export function missingIngredientIds(db: Database, recipeId: Id): Id[] {
  return prepared(db, SQL.missingIngredients)
    .all(recipeId)
    .map((row) => Number(row.ingredientId));
}
