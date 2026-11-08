import { type Calculator, type CalculatorInput, type FieldError, type Id, validateCalculator } from '@cellar/contract';
import { CalculatorInputFieldSchema, CalculatorOutputFieldSchema } from '@cellar/contract/schemas';
import type { FastifyInstance } from 'fastify';
import type { Person } from '../core/access.ts';
import type { AppContext } from '../core/context.ts';
import { type Database, withTransaction } from '../core/db.ts';
import { personOf } from '../core/person.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import {
  memberColumns,
  memberRefOrNull,
  num,
  type Row,
  text,
  type ToImageRef,
  textOrNull,
  imageRefsOf,
} from '../recipes/rows.ts';

const INPUTS = CalculatorInputFieldSchema.array();
const OUTPUTS = CalculatorOutputFieldSchema.array();
const SELECT = `SELECT c.*, ${memberColumns('m', 'a', 'creator')} FROM calculators c
  LEFT JOIN members m ON m.id = c.created_by LEFT JOIN images a ON a.id = m.avatar_image_id`;

function toCalculator(row: Row, person: Person, toImageRef: ToImageRef): Calculator {
  const createdBy = row.created_by === null ? null : num(row, 'created_by');
  const provenance = textOrNull(row, 'catalog_key') === null ? 'household' : 'catalog';
  return {
    id: num(row, 'id'),
    name: text(row, 'name'),
    description: text(row, 'description'),
    inputs: INPUTS.parse(JSON.parse(text(row, 'inputs_json'))),
    outputs: OUTPUTS.parse(JSON.parse(text(row, 'outputs_json'))),
    provenance,
    createdBy: memberRefOrNull(row, 'creator', toImageRef),
    canEdit: person.role === 'owner' || (provenance === 'household' && createdBy === person.id),
    updatedAt: text(row, 'updated_at'),
  };
}

function load(db: Database, id: Id, person: Person, toImageRef: ToImageRef): Calculator {
  const row = db.prepare(`${SELECT} WHERE c.id = ?`).get(id);
  if (row === undefined) {
    throw problem('not_found');
  }
  return toCalculator(row, person, toImageRef);
}

function refuseInvalid(input: CalculatorInput): void {
  const fields: FieldError[] = validateCalculator(input).map((issue) => ({
    path: issue.path,
    code:
      issue.error.code === 'invalid_key' || issue.error.code === 'duplicate_key'
        ? 'invalid_value'
        : 'expression_invalid',
    message: issue.error.message,
  }));
  if (fields.length > 0) {
    throw problem('validation_failed', { fields });
  }
}

function requireEditable(calculator: Calculator): void {
  if (!calculator.canEdit) {
    const who = calculator.createdBy?.name ?? 'the owner';
    throw problem('not_owner', { detail: `Only ${who} can change this.` });
  }
}

function createCalculator(ctx: AppContext, input: CalculatorInput, person: Person, toImageRef: ToImageRef): Calculator {
  refuseInvalid(input);
  const now = ctx.now().toISOString();
  const result = ctx.db
    .prepare(
      `INSERT INTO calculators (name, description, inputs_json, outputs_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.description,
      JSON.stringify(input.inputs),
      JSON.stringify(input.outputs),
      person.id,
      now,
      now,
    );
  return load(ctx.db, Number(result.lastInsertRowid), person, toImageRef);
}

function replaceCalculator(
  ctx: AppContext,
  id: Id,
  input: CalculatorInput,
  person: Person,
  toImageRef: ToImageRef,
): Calculator {
  return withTransaction(ctx.db, () => {
    requireEditable(load(ctx.db, id, person, toImageRef));
    refuseInvalid(input);
    const now = ctx.now().toISOString();
    ctx.db
      .prepare(
        `UPDATE calculators SET name = ?, description = ?, inputs_json = ?, outputs_json = ?, updated_at = ?,
         edited_at = CASE WHEN catalog_key IS NULL THEN NULL ELSE COALESCE(edited_at, ?) END WHERE id = ?`,
      )
      .run(input.name, input.description, JSON.stringify(input.inputs), JSON.stringify(input.outputs), now, now, id);
    return load(ctx.db, id, person, toImageRef);
  });
}

function deleteCalculator(ctx: AppContext, id: Id, person: Person, toImageRef: ToImageRef): undefined {
  withTransaction(ctx.db, () => {
    requireEditable(load(ctx.db, id, person, toImageRef));
    const row = ctx.db.prepare('SELECT catalog_key FROM calculators WHERE id = ?').get(id);
    const catalogKey = row === undefined ? null : textOrNull(row, 'catalog_key');
    if (catalogKey !== null) {
      ctx.db
        .prepare('INSERT OR IGNORE INTO catalog_deletions (type, key, deleted_at) VALUES (?, ?, ?)')
        .run('calculators', catalogKey, ctx.now().toISOString());
    }
    ctx.db.prepare('DELETE FROM calculators WHERE id = ?').run(id);
  });
}

function listCalculators(db: Database, person: Person, toImageRef: ToImageRef): { calculators: Calculator[] } {
  const rows = db.prepare(`${SELECT} ORDER BY c.name COLLATE NOCASE, c.id`).all();
  return { calculators: rows.map((row) => toCalculator(row, person, toImageRef)) };
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  const toImageRef = imageRefsOf(ctx);

  route(app, 'listCalculators', async (request) => listCalculators(ctx.db, personOf(request), toImageRef));
  route(app, 'getCalculator', async (request) => load(ctx.db, request.params.id, personOf(request), toImageRef));
  route(app, 'createCalculator', async (request) => createCalculator(ctx, request.body, personOf(request), toImageRef));
  route(app, 'replaceCalculator', async (request) =>
    replaceCalculator(ctx, request.params.id, request.body, personOf(request), toImageRef),
  );
  route(app, 'deleteCalculator', async (request) =>
    deleteCalculator(ctx, request.params.id, personOf(request), toImageRef),
  );
}
