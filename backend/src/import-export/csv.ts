import {
  type CsvImportReport,
  type CsvKind,
  canonicalUnit,
  currencyDigits,
  type DuplicateRule,
  foldName,
  type ImportMode,
  LIMITS,
  parseLabeledSize,
  parseMoney,
  type RowError,
  type UnitId,
} from '@cellar/contract';
import {
  BOTTLE_CSV_COLUMNS,
  BOTTLE_CSV_REQUIRED,
  INGREDIENT_CSV_COLUMNS,
  INGREDIENT_CSV_REQUIRED,
} from '@cellar/contract/schemas';
import { type Database, withTransaction } from '../core/db.ts';
import { problem } from '../core/problems.ts';

const BOM = '﻿';

export const CSV_COLUMNS: Readonly<Record<CsvKind, readonly string[]>> = {
  bottles: BOTTLE_CSV_COLUMNS,
  ingredients: INGREDIENT_CSV_COLUMNS,
};

const REQUIRED: Readonly<Record<CsvKind, readonly string[]>> = {
  bottles: BOTTLE_CSV_REQUIRED,
  ingredients: INGREDIENT_CSV_REQUIRED,
};

const EXAMPLE_ROWS: Readonly<Record<CsvKind, readonly string[]>> = {
  bottles: [
    '',
    'Tanqueray London Dry',
    'London dry gin',
    '750 ml',
    '',
    '43.1',
    '24.99',
    '2026-11-08',
    '',
    '',
    'sealed',
    '',
  ],
  ingredients: ['', 'Orgeat', 'Syrup', '0', 'Almond syrup', 'France', '#f3e9d2', 'ml'],
};

export function csvField(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replaceAll('"', '""')}"` : value;
}

export function csvLine(values: readonly string[]): string {
  return `${values.map(csvField).join(',')}\r\n`;
}

export function csvTemplate(kind: CsvKind): string {
  return `${BOM}${csvLine(CSV_COLUMNS[kind])}${csvLine(EXAMPLE_ROWS[kind])}`;
}

export class CsvSyntaxError extends Error {}

export function parseCsv(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (quoted) {
    throw new CsvSyntaxError('a quoted field is not closed');
  }
  if (fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

interface Sheet {
  readonly rows: readonly { readonly line: number; readonly cells: ReadonlyMap<string, string> }[];
  readonly warnings: readonly RowError[];
  readonly missing: readonly string[];
}

function readSheet(kind: CsvKind, table: readonly string[][]): Sheet {
  const [header = [], ...body] = table;
  const known = new Set(CSV_COLUMNS[kind]);
  const names = header.map(normaliseHeader);
  const warnings: RowError[] = names.flatMap((name, index) =>
    known.has(name)
      ? []
      : [{ row: 1, column: header[index].trim(), reason: `Unknown column “${header[index].trim()}” was ignored.` }],
  );
  const missing = REQUIRED[kind].filter((column) => !names.includes(column));
  const rows = body.map((cells, index) => {
    const map = new Map<string, string>();
    for (const [column, name] of names.entries()) {
      if (known.has(name)) {
        map.set(name, (cells[column] ?? '').trim());
      }
    }
    return { line: index + 2, cells: map };
  });
  return { rows, warnings, missing };
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function numberIn(value: string, min: number, max: number): number | null {
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(value)) {
    return null;
  }
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

type Status = 'sealed' | 'open' | 'finished';

interface BottleRow {
  readonly line: number;
  readonly id: number | null;
  readonly name: string;
  readonly ingredient: string;
  readonly labeledSize: string;
  readonly volumeMl: number | null;
  readonly abv: number | null;
  readonly priceMinor: number | null;
  readonly purchasedOn: string | null;
  readonly openedOn: string | null;
  readonly finishedOn: string | null;
  readonly status: Status;
  readonly note: string;
}

interface IngredientRow {
  readonly line: number;
  readonly id: number | null;
  readonly name: string;
  readonly parent: string | null;
  readonly strength: number;
  readonly description: string;
  readonly origin: string | null;
  readonly color: string | null;
  readonly defaultUnit: UnitId;
}

export interface CsvRequest {
  readonly text: string;
  readonly kind: CsvKind;
  readonly mode: ImportMode;
  readonly duplicate: DuplicateRule;
  readonly unmatchedParentId: number | null;
  readonly memberId: number;
  readonly currency: string;
  readonly now: string;
}

class RowChecker {
  readonly errors: RowError[] = [];
  private readonly line: number;
  private readonly cells: ReadonlyMap<string, string>;

  constructor(line: number, cells: ReadonlyMap<string, string>) {
    this.line = line;
    this.cells = cells;
  }

  get ok(): boolean {
    return this.errors.length === 0;
  }

  fail(column: string | null, reason: string): void {
    this.errors.push({ row: this.line, column, reason });
  }

  text(column: string, max: number): string {
    const value = this.cells.get(column) ?? '';
    if ([...value].length > max) {
      this.fail(column, `Keep it under ${max} characters.`);
    }
    return value;
  }

  id(): number | null {
    const value = this.cells.get('id') ?? '';
    if (value === '') {
      return null;
    }
    if (!/^[1-9][0-9]{0,15}$/.test(value)) {
      this.fail('id', `“${value}” isn't a number.`);
      return null;
    }
    return Number(value);
  }

  number(column: string, min: number, max: number): number | null {
    const value = this.cells.get(column) ?? '';
    if (value === '') {
      return null;
    }
    const n = numberIn(value, min, max);
    if (n === null) {
      this.fail(column, `“${value}” isn't a number.`);
    }
    return n;
  }

  date(column: string): string | null {
    const value = this.cells.get(column) ?? '';
    if (value === '') {
      return null;
    }
    if (!isDate(value)) {
      this.fail(column, `“${value}” isn't a date like 2026-11-08.`);
      return null;
    }
    return value;
  }
}

function checkBottle(
  line: number,
  cells: ReadonlyMap<string, string>,
  currency: string,
): { row: BottleRow; errors: RowError[] } {
  const check = new RowChecker(line, cells);
  const id = check.id();
  const name = check.text('name', LIMITS.name.max);
  if (name === '') {
    check.fail('name', 'Name is empty.');
  }
  const ingredient = check.text('ingredient', LIMITS.name.max);
  if (ingredient === '') {
    check.fail('ingredient', 'Name is empty.');
  }
  const labeledSize = check.text('labeled_size', LIMITS.labeledSize.max);
  const volumeMl = check.number('volume_ml', 0, LIMITS.volumeMl.max) ?? parseLabeledSize(labeledSize);
  const abv = check.number('abv', 0, 100);
  const priceText = cells.get('price_paid') ?? '';
  const priceMinor = priceText === '' ? null : parseMoney(priceText, currency);
  if (priceText !== '' && priceMinor === null) {
    check.fail('price_paid', `“${priceText}” isn't a price.`);
  }
  const purchasedOn = check.date('purchased_on');
  const openedOn = check.date('opened_on');
  const finishedOn = check.date('finished_on');
  const statusText = (cells.get('status') ?? '').toLowerCase() || 'sealed';
  const status: Status | null =
    statusText === 'sealed' || statusText === 'open' || statusText === 'finished' ? statusText : null;
  if (status === null) {
    check.fail('status', 'Status must be sealed, open or finished.');
  }
  if (status === 'open' && openedOn === null && (cells.get('opened_on') ?? '') === '') {
    check.fail('opened_on', 'Opened date is needed for an open bottle.');
  }
  const note = check.text('note', LIMITS.bottleNote.max);
  return {
    row: {
      line,
      id,
      name,
      ingredient,
      labeledSize,
      volumeMl,
      abv,
      priceMinor,
      purchasedOn,
      openedOn,
      finishedOn,
      status: status ?? 'sealed',
      note,
    },
    errors: check.errors,
  };
}

function checkIngredient(line: number, cells: ReadonlyMap<string, string>): { row: IngredientRow; errors: RowError[] } {
  const check = new RowChecker(line, cells);
  const id = check.id();
  const name = check.text('name', LIMITS.name.max);
  if (name === '') {
    check.fail('name', 'Name is empty.');
  }
  const parent = check.text('parent', LIMITS.name.max);
  const strength = check.number('strength', 0, 100) ?? 0;
  const description = check.text('description', LIMITS.description.max);
  const origin = check.text('origin', LIMITS.name.max);
  const colorText = (cells.get('color') ?? '').toLowerCase();
  if (colorText !== '' && !/^#[0-9a-f]{6}$/.test(colorText)) {
    check.fail('color', `“${cells.get('color')}” isn't a color like #c0ffee.`);
  }
  const unitText = cells.get('default_unit') ?? '';
  const canonical = unitText === '' ? 'ml' : canonicalUnit(unitText);
  const defaultUnit: UnitId | null = canonical === 'oz' || canonical === 'cl' ? 'ml' : canonical;
  if (defaultUnit === null) {
    check.fail('default_unit', `“${unitText}” isn't a unit Cellar knows.`);
  }
  return {
    row: {
      line,
      id,
      name,
      parent: parent === '' ? null : parent,
      strength,
      description,
      origin: origin === '' ? null : origin,
      color: colorText === '' ? null : colorText,
      defaultUnit: defaultUnit ?? 'ml',
    },
    errors: check.errors,
  };
}

interface IngredientIndex {
  byFolded: Map<string, number[]>;
  parentOf: Map<number, number | null>;
}

function ingredientIndex(db: Database): IngredientIndex {
  const byFolded = new Map<string, number[]>();
  const parentOf = new Map<number, number | null>();
  for (const row of db.prepare('SELECT id, folded_name, parent_id FROM ingredients').all()) {
    if (typeof row.id !== 'number' || typeof row.folded_name !== 'string') {
      continue;
    }
    byFolded.set(row.folded_name, [...(byFolded.get(row.folded_name) ?? []), row.id]);
    parentOf.set(row.id, typeof row.parent_id === 'number' ? row.parent_id : null);
  }
  return { byFolded, parentOf };
}

function exists(db: Database, table: 'bottles' | 'ingredients', id: number): boolean {
  return db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) !== undefined;
}

function blankReport(request: CsvRequest, rows: number): CsvImportReport {
  return {
    kind: request.kind,
    mode: request.mode,
    committed: false,
    rows,
    creates: 0,
    updates: 0,
    skips: 0,
    createdIngredients: [],
    errors: [],
  };
}

function insertIngredient(
  db: Database,
  values: {
    name: string;
    parentId: number | null;
    strength: number;
    description: string;
    origin: string | null;
    color: string | null;
    defaultUnit: string;
  },
  memberId: number,
  now: string,
): number {
  const result = db
    .prepare(
      `INSERT INTO ingredients (name, folded_name, parent_id, strength, description, color, origin, default_unit, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.name,
      foldName(values.name),
      values.parentId,
      values.strength,
      values.description,
      values.color,
      values.origin,
      values.defaultUnit,
      memberId,
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

function importBottles(db: Database, request: CsvRequest, sheet: Sheet, write: boolean): CsvImportReport {
  const report = blankReport(request, sheet.rows.length);
  const index = ingredientIndex(db);
  const created = new Map<string, number>();
  const unmatchedParentId = request.unmatchedParentId;
  if (unmatchedParentId !== null && !exists(db, 'ingredients', unmatchedParentId)) {
    report.errors.push({ row: 1, column: null, reason: 'The parent chosen for new ingredients no longer exists.' });
  }
  for (const { line, cells } of sheet.rows) {
    const { row, errors } = checkBottle(line, cells, request.currency);
    const folded = foldName(row.ingredient);
    let ingredientId = index.byFolded.get(folded)?.[0] ?? created.get(folded);
    if (ingredientId === undefined && unmatchedParentId === null && row.ingredient !== '') {
      errors.push({
        row: line,
        column: 'ingredient',
        reason: `No ingredient named “${row.ingredient}”. Add it first, or choose a parent for new ingredients.`,
      });
    }
    report.errors.push(...errors);
    if (errors.length > 0) {
      continue;
    }
    if (ingredientId === undefined) {
      report.createdIngredients.push(row.ingredient);
      ingredientId = write
        ? insertIngredient(
            db,
            {
              name: row.ingredient,
              parentId: unmatchedParentId,
              strength: 0,
              description: '',
              origin: null,
              color: null,
              defaultUnit: 'ml',
            },
            request.memberId,
            request.now,
          )
        : -1;
      created.set(folded, ingredientId);
    }
    const duplicate = row.id !== null && exists(db, 'bottles', row.id);
    const action = duplicate ? request.duplicate : 'create';
    if (action === 'skip') {
      report.skips += 1;
      continue;
    }
    const values = [
      row.name,
      ingredientId,
      row.labeledSize,
      row.volumeMl,
      row.abv,
      row.priceMinor,
      row.purchasedOn,
      row.openedOn,
      row.finishedOn,
      row.status,
      row.note,
    ];
    if (action === 'update') {
      report.updates += 1;
      if (write) {
        db.prepare(
          `UPDATE bottles SET name = ?, ingredient_id = ?, labeled_size = ?, volume_ml = ?, abv = ?, price_paid_minor = ?,
           purchased_on = ?, opened_on = ?, finished_on = ?, status = ?, note = ?, updated_at = ? WHERE id = ?`,
        ).run(...values, request.now, row.id);
      }
      continue;
    }
    report.creates += 1;
    if (write) {
      db.prepare(
        `INSERT INTO bottles (name, ingredient_id, labeled_size, volume_ml, abv, price_paid_minor, purchased_on, opened_on,
         finished_on, status, note, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(...values, request.memberId, request.now, request.now);
    }
  }
  return report;
}

function importIngredients(db: Database, request: CsvRequest, sheet: Sheet, write: boolean): CsvImportReport {
  const report = blankReport(request, sheet.rows.length);
  const index = ingredientIndex(db);
  const fileIds = new Map<string, number>();
  const findUnder = (folded: string, parentId: number | null): number | undefined =>
    index.byFolded.get(folded)?.find((id) => index.parentOf.get(id) === parentId);
  for (const { line, cells } of sheet.rows) {
    const { row, errors } = checkIngredient(line, cells);
    let parentId: number | null = null;
    if (row.parent !== null) {
      const foldedParent = foldName(row.parent);
      const found = fileIds.get(foldedParent) ?? index.byFolded.get(foldedParent)?.[0];
      if (found === undefined) {
        errors.push({
          row: line,
          column: 'parent',
          reason: `Parent “${row.parent}” isn't in Cellar or earlier in this file.`,
        });
      } else {
        parentId = found;
      }
    }
    report.errors.push(...errors);
    if (errors.length > 0) {
      continue;
    }
    const folded = foldName(row.name);
    const duplicateId = row.id !== null && exists(db, 'ingredients', row.id) ? row.id : findUnder(folded, parentId);
    const action = duplicateId === undefined ? 'create' : request.duplicate;
    const values = {
      name: row.name,
      parentId,
      strength: row.strength,
      description: row.description,
      origin: row.origin,
      color: row.color,
      defaultUnit: row.defaultUnit,
    };
    if (action === 'skip' && duplicateId !== undefined) {
      report.skips += 1;
      fileIds.set(folded, duplicateId);
      continue;
    }
    if (action === 'update' && duplicateId !== undefined) {
      report.updates += 1;
      fileIds.set(folded, duplicateId);
      if (write) {
        db.prepare(
          `UPDATE ingredients SET name = ?, folded_name = ?, parent_id = ?, strength = ?, description = ?, origin = ?, color = ?,
           default_unit = ?, updated_at = ?,
           edited_at = CASE WHEN catalog_key IS NULL THEN NULL ELSE COALESCE(edited_at, ?) END WHERE id = ?`,
        ).run(
          values.name,
          folded,
          values.parentId,
          values.strength,
          values.description,
          values.origin,
          values.color,
          values.defaultUnit,
          request.now,
          request.now,
          duplicateId,
        );
      }
      continue;
    }
    report.creates += 1;
    const id = write ? insertIngredient(db, values, request.memberId, request.now) : -line;
    fileIds.set(folded, id);
  }
  return report;
}

export function importCsvText(db: Database, request: CsvRequest): CsvImportReport {
  let table: string[][];
  try {
    table = parseCsv(request.text);
  } catch (error) {
    if (error instanceof CsvSyntaxError) {
      throw problem('unsupported_media_type', { detail: 'Upload a .csv file.' });
    }
    throw error;
  }
  const sheet = readSheet(request.kind, table);
  const run = (write: boolean): { report: CsvImportReport; blocking: RowError[] } => {
    const report =
      request.kind === 'bottles'
        ? importBottles(db, request, sheet, write)
        : importIngredients(db, request, sheet, write);
    const blocking: RowError[] = sheet.missing.map((column) => ({
      row: 1,
      column,
      reason: `Column “${column}” is missing.`,
    }));
    if (sheet.rows.length > LIMITS.csvRows) {
      blocking.push({
        row: 1,
        column: null,
        reason: `Only ${LIMITS.csvRows.toLocaleString('en-US')} rows can be imported at once.`,
      });
    }
    blocking.push(...report.errors);
    return { report: { ...report, errors: [...sheet.warnings, ...blocking] }, blocking };
  };
  const failure = (checked: { report: CsvImportReport; blocking: RowError[] }) =>
    problem('import_has_errors', {
      detail: `Fix the ${new Set(checked.blocking.map((error) => error.row)).size} rows listed, then import again. Nothing was saved.`,
      report: checked.report,
    });
  const dry = run(false);
  if (request.mode === 'dry_run') {
    return dry.report;
  }
  if (dry.blocking.length > 0) {
    throw failure(dry);
  }
  return withTransaction(db, () => {
    const committed = run(true);
    if (committed.blocking.length > 0) {
      throw failure(committed);
    }
    return { ...committed.report, committed: true };
  });
}

export function moneyText(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}
