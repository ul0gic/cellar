import { foldName, UNIT_IDS, UNIT_KIND, type UnitId, validateCalculator } from '@cellar/contract';
import { type ImageHeader, inspectImage } from './image.ts';
import { compareCodePoints, type DataFile, type DatasetFiles, type Problem } from './read.ts';

export const FORMAT_VERSION = 1;
export const VERSION_PATTERN = /^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[1-9][0-9]{0,2}$/;
const KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_FILE_PATTERN = /^images\/(recipes|ingredients)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([1-9])\.(webp|jpg|png)$/;
const MAX_AMOUNT = 99_999;
const MAX_IMAGE_BYTES = 2_000_000;
const MAX_IMAGE_SIDE = 10_000;
const MAX_INGREDIENT_DEPTH = 10;

export interface DatasetImage {
  file: string;
  placeholder: string | null;
}

export interface Glass {
  key: string;
  name: string;
  description: string | null;
  capacityMl: number | null;
}

export interface Method {
  key: string;
  name: string;
  dilutionPercent: number;
}

export interface Utensil {
  key: string;
  name: string;
  description: string | null;
}

export interface TasteDescriptor {
  key: string;
  name: string;
}

export interface CalculatorInput {
  key: string;
  label: string;
  defaultValue: number;
  suffix: string;
}

export interface CalculatorOutput {
  key: string;
  label: string;
  expression: string;
  decimals: number;
  suffix: string;
}

export interface Calculator {
  key: string;
  name: string;
  description: string | null;
  inputs: CalculatorInput[];
  outputs: CalculatorOutput[];
}

export interface Part {
  ingredient: string;
  amount: number | null;
  unit: UnitId | null;
}

export interface Ingredient {
  key: string;
  name: string;
  parent: string | null;
  strength: number;
  description: string | null;
  origin: string | null;
  color: string | null;
  defaultUnit: UnitId | null;
  parts: Part[];
  images: DatasetImage[];
}

export interface Substitute {
  ingredient: string;
  amount: number | null;
  amountMax: number | null;
  unit: UnitId | null;
}

export interface Line {
  ingredient: string;
  amount: number | null;
  amountMax: number | null;
  unit: UnitId | null;
  optional: boolean;
  specified: boolean;
  note: string | null;
  substitutes: Substitute[];
}

export interface Recipe {
  key: string;
  name: string;
  description: string | null;
  instructions: string;
  garnish: string | null;
  glass: string | null;
  method: string | null;
  utensils: string[];
  tags: string[];
  year: number | null;
  author: string | null;
  source: string | null;
  parent: string | null;
  images: DatasetImage[];
  lines: Line[];
}

export interface ImageData {
  header: ImageHeader;
  width: number;
  height: number;
  bytes: Buffer;
}

export interface Notice {
  type: 'recipe';
  key: string;
  code: 'repeated-ingredient';
  detail: string;
}

export interface Catalog {
  version: string;
  glasses: Glass[];
  methods: Method[];
  utensils: Utensil[];
  tasteDescriptors: TasteDescriptor[];
  calculators: Calculator[];
  ingredients: Ingredient[];
  recipes: Recipe[];
  images: Map<string, ImageData>;
  notices: Notice[];
}

const FIELDS = {
  glasses: ['key', 'name', 'description', 'capacityMl'],
  methods: ['key', 'name', 'dilutionPercent'],
  utensils: ['key', 'name', 'description'],
  'taste-descriptors': ['key', 'name'],
  calculators: ['key', 'name', 'description', 'inputs', 'outputs'],
  ingredients: [
    'key',
    'name',
    'parent',
    'strength',
    'description',
    'origin',
    'color',
    'defaultUnit',
    'parts',
    'images',
  ],
  recipes: [
    'key',
    'name',
    'description',
    'instructions',
    'garnish',
    'glass',
    'method',
    'utensils',
    'tags',
    'year',
    'author',
    'source',
    'parent',
    'images',
    'lines',
  ],
} as const satisfies Record<DataFile, readonly string[]>;
const INPUT_FIELDS = ['key', 'label', 'defaultValue', 'suffix'] as const;
const OUTPUT_FIELDS = ['key', 'label', 'expression', 'decimals', 'suffix'] as const;
const PART_FIELDS = ['ingredient', 'amount', 'unit'] as const;
const LINE_FIELDS = [
  'ingredient',
  'amount',
  'amountMax',
  'unit',
  'optional',
  'specified',
  'note',
  'substitutes',
] as const;
const SUBSTITUTE_FIELDS = ['ingredient', 'amount', 'amountMax', 'unit'] as const;
const IMAGE_FIELDS = ['file', 'placeholder'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function length(text: string): number {
  return [...text].length;
}

function formatInteger(n: number): string {
  return n.toLocaleString('en-US');
}

function isHundredths(n: number): boolean {
  return Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}

interface NamedImage {
  file: string;
  source: Checker;
}

class Checker {
  readonly problems: Problem[];
  readonly named: NamedImage[];
  readonly file: string;
  record: string | null = null;
  where: string | null = null;

  constructor(problems: Problem[], named: NamedImage[], file: string) {
    this.problems = problems;
    this.named = named;
    this.file = file;
  }

  at(where: string | null): Checker {
    const child = new Checker(this.problems, this.named, this.file);
    child.record = this.record;
    child.where = where === null ? this.where : this.where === null ? where : `${this.where} ${where}`;
    return child;
  }

  fail(rule: string, message: string): undefined {
    this.problems.push({ file: this.file, record: this.record, where: this.where, rule, message });
  }

  object(value: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
    if (!isRecord(value)) {
      return this.fail('X-03', 'must be an object');
    }
    const keys = Object.keys(value);
    let complete = true;
    for (const field of fields) {
      if (!Object.hasOwn(value, field)) {
        this.fail(field === 'name' || field === 'instructions' ? 'X-02' : 'X-03', `${field} is missing`);
        complete = false;
      }
    }
    for (const key of keys) {
      if (!fields.includes(key)) {
        this.fail('X-03', `unknown field ${key}`);
      }
    }
    const known = keys.filter((key) => fields.includes(key));
    const expected = fields.filter((field) => known.includes(field));
    if (known.some((key, i) => key !== expected[i])) {
      this.fail('X-12', `fields are not in the order ${fields.join(', ')}`);
    }
    return complete ? value : undefined;
  }

  string(field: string, value: unknown, max: number, nullable: boolean): string | null | undefined {
    const required = field === 'name' || field === 'instructions';
    if (value === null) {
      return nullable ? null : this.fail(required ? 'X-02' : 'X-03', `${field} is missing or empty`);
    }
    if (typeof value !== 'string') {
      return this.fail('X-03', `${field} must be a string`);
    }
    if (value === '') {
      return nullable
        ? this.fail('X-12', `${field} is empty; use null`)
        : this.fail(required ? 'X-02' : 'X-03', `${field} is missing or empty`);
    }
    let ok = true;
    if (value.normalize('NFC') !== value) {
      ok = this.fail('X-12', `${field} is not NFC-normalised`) ?? false;
    }
    if (value.trim() !== value) {
      ok = this.fail('X-12', `${field} has leading or trailing whitespace`) ?? false;
    }
    if (value.includes('\r')) {
      ok = this.fail('X-12', `${field} contains CR`) ?? false;
    }
    const size = length(value);
    if (size > max) {
      ok =
        this.fail('X-03', `${field} is ${formatInteger(size)} characters; the cap is ${formatInteger(max)}`) ?? false;
    }
    return ok ? value : undefined;
  }

  requiredString(field: string, value: unknown, max: number): string | undefined {
    const text = this.string(field, value, max, false);
    return text === null ? undefined : text;
  }

  key(field: string, value: unknown, nullable: boolean): string | null | undefined {
    if (value === null && nullable) {
      return null;
    }
    if (typeof value !== 'string' || !KEY_PATTERN.test(value) || value.length > 100) {
      return this.fail('X-03', `${field} ${JSON.stringify(value)} is not a key`);
    }
    return value;
  }

  number(
    field: string,
    value: unknown,
    range: { min: number; max: number; integer: boolean },
    nullable: boolean,
  ): number | null | undefined {
    if (value === null && nullable) {
      return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return this.fail('X-03', `${field} must be a number`);
    }
    if (range.integer && !Number.isInteger(value)) {
      return this.fail('X-03', `${field} ${value} must be an integer`);
    }
    if (value < range.min || value > range.max) {
      return this.fail('X-03', `${field} ${value} is outside ${range.min} to ${formatInteger(range.max)}`);
    }
    return value;
  }

  boolean(field: string, value: unknown): boolean | undefined {
    if (typeof value !== 'boolean') {
      return this.fail('X-03', `${field} must be true or false`);
    }
    return value;
  }

  amount(field: string, value: unknown): number | null | undefined {
    if (value === null) {
      return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return this.fail('X-10', `${field} must be a number`);
    }
    if (value < 0) {
      return this.fail('X-10', `${field} ${value} is negative`);
    }
    if (value > MAX_AMOUNT) {
      return this.fail('X-10', `${field} ${value} exceeds ${formatInteger(MAX_AMOUNT)}`);
    }
    if (!isHundredths(value)) {
      return this.fail('X-10', `${field} ${value} is not a multiple of 0.01`);
    }
    if (value < 0.01) {
      return this.fail('X-03', `${field} ${value} is below 0.01`);
    }
    return value;
  }

  unit(value: unknown): UnitId | null | undefined {
    if (value === null) {
      return null;
    }
    const unit = UNIT_IDS.find((id) => id === value);
    if (unit === undefined) {
      return this.fail(
        'X-05',
        `unit ${typeof value === 'string' ? JSON.stringify(value) : String(value)} is not a unit`,
      );
    }
    return unit;
  }

  array(field: string, value: unknown, max: number): unknown[] | undefined {
    if (!Array.isArray(value)) {
      return this.fail('X-03', `${field} must be an array`);
    }
    if (value.length > max) {
      return this.fail('X-03', `${field} has ${value.length} entries; the cap is ${max}`);
    }
    return value;
  }

  measured(
    o: Record<string, unknown>,
    withMax: boolean,
  ): { amount: number | null; amountMax: number | null; unit: UnitId | null } | undefined {
    const amount = this.amount('amount', o.amount);
    const amountMax = withMax ? this.amount('amountMax', o.amountMax) : null;
    const unit = this.unit(o.unit);
    if (amount === undefined || amountMax === undefined || unit === undefined) {
      return undefined;
    }
    if (unit !== null && UNIT_KIND[unit] === 'instruction' && (amount !== null || amountMax !== null)) {
      return this.fail('X-05', `unit "${unit}" is an instruction and carries no amount`);
    }
    if (amountMax !== null && (amount === null || amountMax <= amount)) {
      return this.fail('X-10', `amountMax ${amountMax} is not greater than amount ${String(amount)}`);
    }
    return { amount, amountMax, unit };
  }
}

function placeholderBytes(value: string): number | null {
  const bare = value.replace(/=+$/, '');
  if (!BASE64_PATTERN.test(value) || bare.length % 4 === 1) {
    return null;
  }
  return Buffer.from(value, 'base64').length;
}

function parseImages(c: Checker, type: 'recipes' | 'ingredients', key: string, value: unknown, max: number) {
  const list = c.array('images', value, max);
  if (list === undefined) {
    return;
  }
  const images: DatasetImage[] = [];
  let ok = true;
  for (const [index, entry] of list.entries()) {
    const ic = c.at(`image ${index + 1}`);
    const o = ic.object(entry, IMAGE_FIELDS);
    if (o === undefined) {
      ok = false;
      continue;
    }
    const match = typeof o.file === 'string' ? IMAGE_FILE_PATTERN.exec(o.file) : null;
    if (typeof o.file !== 'string' || match === null) {
      ok = ic.fail('X-11', `file ${JSON.stringify(o.file)} is not an image path`) ?? false;
      continue;
    }
    if (match[1] !== type || match[2] !== key || match[3] !== String(index + 1)) {
      ok = ic.fail('X-11', `file ${o.file} must be images/${type}/${key}/${index + 1}.<ext>`) ?? false;
      continue;
    }
    let placeholder: string | null = null;
    if (o.placeholder !== null) {
      const size = typeof o.placeholder === 'string' ? placeholderBytes(o.placeholder) : null;
      if (typeof o.placeholder !== 'string' || size === null || size < 5 || size > 64) {
        ok = ic.fail('X-11', 'placeholder does not decode to 5 to 64 bytes') ?? false;
        continue;
      }
      placeholder = o.placeholder;
    }
    images.push({ file: o.file, placeholder });
    c.named.push({ file: o.file, source: ic });
  }
  return ok ? images : undefined;
}

function parseGlass(c: Checker, o: Record<string, unknown>): Glass | undefined {
  const key = c.key('key', o.key, false);
  const name = c.requiredString('name', o.name, 120);
  const description = c.string('description', o.description, 5000, true);
  const capacityMl = c.number('capacityMl', o.capacityMl, { min: 0, max: MAX_AMOUNT, integer: false }, true);
  if (key == null || name === undefined || description === undefined || capacityMl === undefined) {
    return undefined;
  }
  return { key, name, description, capacityMl };
}

function parseMethod(c: Checker, o: Record<string, unknown>): Method | undefined {
  const key = c.key('key', o.key, false);
  const name = c.requiredString('name', o.name, 120);
  const dilutionPercent = c.number('dilutionPercent', o.dilutionPercent, { min: 0, max: 100, integer: false }, false);
  if (key == null || name === undefined || dilutionPercent == null) {
    return undefined;
  }
  return { key, name, dilutionPercent };
}

function parseUtensil(c: Checker, o: Record<string, unknown>): Utensil | undefined {
  const key = c.key('key', o.key, false);
  const name = c.requiredString('name', o.name, 120);
  const description = c.string('description', o.description, 5000, true);
  if (key == null || name === undefined || description === undefined) {
    return undefined;
  }
  return { key, name, description };
}

function parseDescriptor(c: Checker, o: Record<string, unknown>): TasteDescriptor | undefined {
  const key = c.key('key', o.key, false);
  const name = c.requiredString('name', o.name, 120);
  if (key == null || name === undefined) {
    return undefined;
  }
  return { key, name };
}

function fieldKey(c: Checker, value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return c.fail('X-03', 'key must be a string');
  }
  return value;
}

function suffix(c: Checker, value: unknown): string | undefined {
  if (value === '') {
    return value;
  }
  return c.requiredString('suffix', value, 12);
}

function checkCalculatorRules(c: Checker, calculator: Calculator): boolean {
  const issues = validateCalculator(calculator);
  for (const issue of issues) {
    const [list, index, field] = issue.path.split('.');
    const where = `${list === 'inputs' ? 'input' : 'output'} ${Number.parseInt(index, 10) + 1}`;
    const { code, message } = issue.error;
    if (code === 'invalid_key') {
      c.at(where).fail('X-03', `key is not a variable name: ${message}`);
    } else if (code === 'duplicate_key') {
      c.at(where).fail('X-08', `key repeats: ${message}`);
    } else if (code === 'unknown_name' || code === 'forward_reference') {
      c.at(where).fail('X-08', `${field} names an unknown or later variable: ${message}`);
    } else {
      c.at(where).fail('X-08', `${field} does not parse: ${message}`);
    }
  }
  return issues.length === 0;
}

function parseCalculator(c: Checker, o: Record<string, unknown>): Calculator | undefined {
  const key = c.key('key', o.key, false);
  const name = c.requiredString('name', o.name, 120);
  const description = c.string('description', o.description, 5000, true);
  const rawInputs = c.array('inputs', o.inputs, 10);
  const rawOutputs = c.array('outputs', o.outputs, 20);
  if (rawInputs !== undefined && rawInputs.length === 0) {
    c.fail('X-03', 'inputs has no entries');
  }
  if (rawOutputs !== undefined && rawOutputs.length === 0) {
    c.fail('X-03', 'outputs has no entries');
  }
  let ok = true;
  const inputs: CalculatorInput[] = [];
  for (const [index, entry] of (rawInputs ?? []).entries()) {
    const ic = c.at(`input ${index + 1}`);
    const io = ic.object(entry, INPUT_FIELDS);
    if (io === undefined) {
      ok = false;
      continue;
    }
    const field = fieldKey(ic, io.key);
    const label = ic.requiredString('label', io.label, 60);
    const defaultValue = ic.number(
      'defaultValue',
      io.defaultValue,
      { min: -Number.MAX_VALUE, max: Number.MAX_VALUE, integer: false },
      false,
    );
    const unit = suffix(ic, io.suffix);
    if (field === undefined || label === undefined || defaultValue == null || unit === undefined) {
      ok = false;
      continue;
    }
    inputs.push({ key: field, label, defaultValue, suffix: unit });
  }
  const outputs: CalculatorOutput[] = [];
  for (const [index, entry] of (rawOutputs ?? []).entries()) {
    const oc = c.at(`output ${index + 1}`);
    const oo = oc.object(entry, OUTPUT_FIELDS);
    if (oo === undefined) {
      ok = false;
      continue;
    }
    const field = fieldKey(oc, oo.key);
    const label = oc.requiredString('label', oo.label, 60);
    const expression = oc.requiredString('expression', oo.expression, 200);
    const decimals = oc.number('decimals', oo.decimals, { min: 0, max: 6, integer: true }, false);
    const unit = suffix(oc, oo.suffix);
    if (
      field === undefined ||
      label === undefined ||
      expression === undefined ||
      decimals == null ||
      unit === undefined
    ) {
      ok = false;
      continue;
    }
    outputs.push({ key: field, label, expression, decimals, suffix: unit });
  }
  if (
    !ok ||
    key == null ||
    name === undefined ||
    description === undefined ||
    rawInputs === undefined ||
    rawOutputs === undefined ||
    inputs.length === 0 ||
    outputs.length === 0
  ) {
    return undefined;
  }
  const calculator = { key, name, description, inputs, outputs };
  return checkCalculatorRules(c, calculator) ? calculator : undefined;
}

function parseIngredient(c: Checker, o: Record<string, unknown>): Ingredient | undefined {
  const key = c.key('key', o.key, false);
  const name = c.requiredString('name', o.name, 120);
  const parent = c.key('parent', o.parent, true);
  const strength = c.number('strength', o.strength, { min: 0, max: 100, integer: false }, false);
  const description = c.string('description', o.description, 5000, true);
  const origin = c.string('origin', o.origin, 120, true);
  let color: string | null | undefined = null;
  if (o.color !== null) {
    color =
      typeof o.color === 'string' && COLOR_PATTERN.test(o.color)
        ? o.color
        : c.fail('X-03', `color ${JSON.stringify(o.color)} is not #rrggbb`);
  }
  const defaultUnit = c.unit(o.defaultUnit);
  const rawParts = c.array('parts', o.parts, 20);
  const parts: Part[] = [];
  let ok = rawParts !== undefined;
  for (const [index, entry] of (rawParts ?? []).entries()) {
    const pc = c.at(`part ${index + 1}`);
    const po = pc.object(entry, PART_FIELDS);
    if (po === undefined) {
      ok = false;
      continue;
    }
    const ingredient = pc.key('ingredient', po.ingredient, false);
    const measured = pc.measured(po, false);
    if (ingredient == null || measured === undefined) {
      ok = false;
      continue;
    }
    parts.push({ ingredient, amount: measured.amount, unit: measured.unit });
  }
  const images = key == null ? undefined : parseImages(c, 'ingredients', key, o.images, 1);
  if (
    !ok ||
    key == null ||
    name === undefined ||
    parent === undefined ||
    strength == null ||
    description === undefined ||
    origin === undefined ||
    color === undefined ||
    defaultUnit === undefined ||
    images === undefined
  ) {
    return undefined;
  }
  return { key, name, parent, strength, description, origin, color, defaultUnit, parts, images };
}

function parseLine(c: Checker, entry: unknown): Line | undefined {
  const o = c.object(entry, LINE_FIELDS);
  if (o === undefined) {
    return undefined;
  }
  const ingredient = c.key('ingredient', o.ingredient, false);
  const measured = c.measured(o, true);
  const optional = c.boolean('optional', o.optional);
  const specified = c.boolean('specified', o.specified);
  const note = c.string('note', o.note, 500, true);
  const rawSubstitutes = c.array('substitutes', o.substitutes, 10);
  const substitutes: Substitute[] = [];
  let ok = rawSubstitutes !== undefined;
  for (const [index, sub] of (rawSubstitutes ?? []).entries()) {
    const sc = c.at(`substitute ${index + 1}`);
    const so = sc.object(sub, SUBSTITUTE_FIELDS);
    if (so === undefined) {
      ok = false;
      continue;
    }
    const subIngredient = sc.key('ingredient', so.ingredient, false);
    const subMeasured = sc.measured(so, true);
    if (subIngredient == null || subMeasured === undefined) {
      ok = false;
      continue;
    }
    substitutes.push({ ingredient: subIngredient, ...subMeasured });
  }
  if (
    !ok ||
    ingredient == null ||
    measured === undefined ||
    optional === undefined ||
    specified === undefined ||
    note === undefined
  ) {
    return undefined;
  }
  return { ingredient, ...measured, optional, specified, note, substitutes };
}

function parseRecipe(c: Checker, o: Record<string, unknown>): Recipe | undefined {
  const key = c.key('key', o.key, false);
  const name = c.requiredString('name', o.name, 120);
  const description = c.string('description', o.description, 5000, true);
  const instructions = c.requiredString('instructions', o.instructions, 5000);
  const garnish = c.string('garnish', o.garnish, 500, true);
  const glass = c.key('glass', o.glass, true);
  const method = c.key('method', o.method, true);
  const rawUtensils = c.array('utensils', o.utensils, 20);
  const utensils: string[] = [];
  let ok = rawUtensils !== undefined;
  for (const value of rawUtensils ?? []) {
    const utensil = c.key('utensils', value, false);
    if (utensil == null) {
      ok = false;
    } else if (utensils.includes(utensil)) {
      ok = c.fail('X-03', `utensil ${utensil} repeats`) ?? false;
    } else {
      utensils.push(utensil);
    }
  }
  const rawTags = c.array('tags', o.tags, 20);
  const tags: string[] = [];
  ok = ok && rawTags !== undefined;
  for (const value of rawTags ?? []) {
    const tag = c.requiredString('tags', value, 50);
    if (tag === undefined) {
      ok = false;
    } else if (tags.some((other) => other.toLowerCase() === tag.toLowerCase())) {
      ok = c.fail('X-12', `tag ${JSON.stringify(tag)} repeats ignoring case`) ?? false;
    } else {
      tags.push(tag);
    }
  }
  const year = c.number('year', o.year, { min: 1, max: 9999, integer: true }, true);
  const author = c.string('author', o.author, 200, true);
  const source = c.string('source', o.source, 1000, true);
  const parent = c.key('parent', o.parent, true);
  const images = key == null ? undefined : parseImages(c, 'recipes', key, o.images, 5);
  const rawLines = c.array('lines', o.lines, 40);
  if (rawLines !== undefined && rawLines.length === 0) {
    ok = c.fail('X-06', 'has no lines') ?? false;
  }
  const lines: Line[] = [];
  for (const [index, entry] of (rawLines ?? []).entries()) {
    const line = parseLine(c.at(`line ${index + 1}`), entry);
    if (line === undefined) {
      ok = false;
    } else {
      lines.push(line);
    }
  }
  if (
    !ok ||
    key == null ||
    name === undefined ||
    description === undefined ||
    instructions === undefined ||
    garnish === undefined ||
    glass === undefined ||
    method === undefined ||
    year === undefined ||
    author === undefined ||
    source === undefined ||
    parent === undefined ||
    images === undefined ||
    rawLines === undefined
  ) {
    return undefined;
  }
  return {
    key,
    name,
    description,
    instructions,
    garnish,
    glass,
    method,
    utensils,
    tags,
    year,
    author,
    source,
    parent,
    images,
    lines,
  };
}

interface Parsed<T> {
  records: T[];
  keys: Set<string>;
}

function parseFile<T extends { key: string }>(
  problems: Problem[],
  named: NamedImage[],
  name: DataFile,
  value: unknown,
  parse: (c: Checker, o: Record<string, unknown>) => T | undefined,
): Parsed<T> {
  const file = `data/${name}.json`;
  const records: T[] = [];
  const keys = new Set<string>();
  const c = new Checker(problems, named, file);
  if (!Array.isArray(value)) {
    problems.push({ file, record: null, where: null, rule: null, message: `${file} is not a JSON array` });
    return { records, keys };
  }
  let previous: string | null = null;
  for (const [index, entry] of value.entries()) {
    const rc = c.at(null);
    const rawKey = isRecord(entry) ? entry.key : undefined;
    if (typeof rawKey === 'string' && KEY_PATTERN.test(rawKey)) {
      rc.record = rawKey;
      if (keys.has(rawKey)) {
        rc.fail('X-07', `key ${rawKey} is used by two records`);
      }
      keys.add(rawKey);
      if (previous !== null && compareCodePoints(previous, rawKey) > 0) {
        rc.fail('X-12', `records are not sorted by key ("${previous}" comes before it)`);
      }
      previous = rawKey;
    } else {
      rc.where = `record ${index + 1}`;
    }
    const o = rc.object(entry, FIELDS[name]);
    if (o === undefined) {
      continue;
    }
    const record = parse(rc, o);
    if (record !== undefined) {
      records.push(record);
    }
  }
  return { records, keys };
}

function checkFoldedNames(problems: Problem[], name: DataFile, records: { key: string; name: string }[]): void {
  const seen = new Map<string, string>();
  for (const record of records) {
    const folded = foldName(record.name);
    const other = seen.get(folded);
    if (other === undefined) {
      seen.set(folded, record.key);
    } else {
      problems.push({
        file: `data/${name}.json`,
        record: record.key,
        where: null,
        rule: 'X-07',
        message: `name ${JSON.stringify(record.name)} folds to the same name as "${other}"`,
      });
    }
  }
}

function reference(c: Checker, what: string, key: string | null, keys: Set<string>): void {
  if (key !== null && !keys.has(key)) {
    c.problems.push({
      file: c.file,
      record: c.record,
      where: c.where,
      rule: 'X-04',
      message: `${what} "${key}" names no record`,
    });
  }
}

function checkIngredientChains(problems: Problem[], ingredients: Ingredient[]): void {
  const parentOf = new Map(ingredients.map((i) => [i.key, i.parent]));
  for (const ingredient of ingredients) {
    const seen = new Set([ingredient.key]);
    let current = ingredient.parent;
    let depth = 0;
    while (current !== null && parentOf.has(current)) {
      depth += 1;
      const base = { file: 'data/ingredients.json', record: ingredient.key, where: null, rule: 'X-09' };
      if (seen.has(current)) {
        problems.push({ ...base, message: 'parent chain makes a cycle' });
        break;
      }
      if (depth > MAX_INGREDIENT_DEPTH) {
        problems.push({ ...base, message: `parent chain is deeper than ${MAX_INGREDIENT_DEPTH}` });
        break;
      }
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
  }
}

function checkRecipeChains(problems: Problem[], recipes: Recipe[]): void {
  const parentOf = new Map(recipes.map((r) => [r.key, r.parent]));
  for (const recipe of recipes) {
    const seen = new Set([recipe.key]);
    let current = recipe.parent;
    while (current !== null && parentOf.has(current)) {
      if (seen.has(current)) {
        problems.push({
          file: 'data/recipes.json',
          record: recipe.key,
          where: null,
          rule: 'X-09',
          message: 'parent chain makes a cycle',
        });
        break;
      }
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
  }
}

function checkTagSpellings(problems: Problem[], recipes: Recipe[]): void {
  const spellings = new Map<string, string[]>();
  for (const recipe of recipes) {
    for (const tag of recipe.tags) {
      const folded = tag.toLowerCase();
      const list = spellings.get(folded) ?? [];
      if (!list.includes(tag)) {
        list.push(tag);
      }
      spellings.set(folded, list);
    }
  }
  for (const list of spellings.values()) {
    if (list.length > 1) {
      const sorted = [...list].sort(compareCodePoints);
      problems.push({
        file: 'data/recipes.json',
        record: null,
        where: null,
        rule: 'X-12',
        message: `data/recipes.json: tag has ${list.length} spellings: ${sorted.map((t) => JSON.stringify(t)).join(', ')}`,
      });
    }
  }
}

function checkImageFiles(
  problems: Problem[],
  named: NamedImage[],
  imageFiles: string[],
  readImageBytes: (file: string) => Buffer | null,
): Map<string, ImageData> {
  const images = new Map<string, ImageData>();
  const owners = new Map<string, number>();
  for (const { file } of named) {
    owners.set(file, (owners.get(file) ?? 0) + 1);
  }
  for (const file of imageFiles) {
    if (!owners.has(file)) {
      problems.push({ file, record: null, where: null, rule: 'X-11', message: `${file} is named by no record` });
    }
  }
  for (const { file, source } of named) {
    if ((owners.get(file) ?? 0) > 1) {
      source.fail('X-11', `file ${file} is named by two records`);
      continue;
    }
    const bytes = readImageBytes(file);
    if (bytes === null) {
      source.fail('X-11', `file ${file} is missing`);
      continue;
    }
    const header = inspectImage(bytes);
    if (header === null) {
      source.fail('X-11', `file ${file} is not WebP, JPEG or PNG`);
      continue;
    }
    if (!file.endsWith(`.${header.extension}`)) {
      source.fail('X-11', `file ${file} holds ${header.mediaType} bytes; its extension must be .${header.extension}`);
      continue;
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      source.fail(
        'X-11',
        `file ${file} is ${formatInteger(bytes.length)} bytes; the cap is ${formatInteger(MAX_IMAGE_BYTES)}`,
      );
      continue;
    }
    if (header.size === null) {
      source.fail('X-11', `file ${file} has no readable size`);
      continue;
    }
    const { width, height } = header.size;
    if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
      source.fail(
        'X-03',
        `file ${file} is ${width} x ${height}; each side must be 1 to ${formatInteger(MAX_IMAGE_SIDE)}`,
      );
      continue;
    }
    images.set(file, { header, width, height, bytes });
  }
  return images;
}

function repeatedIngredientNotices(recipes: Recipe[]): Notice[] {
  const notices: Notice[] = [];
  for (const recipe of recipes) {
    const positions = new Map<string, number[]>();
    for (const [index, line] of recipe.lines.entries()) {
      positions.set(line.ingredient, [...(positions.get(line.ingredient) ?? []), index + 1]);
    }
    for (const [ingredient, lines] of positions) {
      if (lines.length > 1) {
        const listed = `${lines.slice(0, -1).join(', ')} and ${lines[lines.length - 1]}`;
        notices.push({
          type: 'recipe',
          key: recipe.key,
          code: 'repeated-ingredient',
          detail: `lines ${listed} ${lines.length === 2 ? 'both' : 'all'} use ${ingredient}`,
        });
      }
    }
  }
  return notices.sort(
    (a, b) => compareCodePoints(a.type, b.type) || compareCodePoints(a.key, b.key) || compareCodePoints(a.code, b.code),
  );
}

function checkVersion(problems: Problem[], value: unknown): string | undefined {
  const fail = (message: string): undefined => {
    problems.push({ file: 'version.json', record: null, where: null, rule: null, message });
  };
  if (!isRecord(value)) {
    return fail('version.json is not a JSON object');
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || keys[0] !== 'formatVersion' || keys[1] !== 'version') {
    return fail('version.json must hold formatVersion and version, in that order, and nothing else');
  }
  if (value.formatVersion !== FORMAT_VERSION) {
    return fail(`version.json: formatVersion must be ${FORMAT_VERSION}`);
  }
  if (typeof value.version !== 'string' || !VERSION_PATTERN.test(value.version)) {
    return fail('version.json: version must be YYYY.MM.DD-N');
  }
  return value.version;
}

export function validateDataset(
  files: DatasetFiles,
  readImageBytes: (file: string) => Buffer | null,
): { ok: true; catalog: Catalog } | { ok: false; problems: Problem[] } {
  const problems: Problem[] = [];
  const version = checkVersion(problems, files.version);
  const named: NamedImage[] = [];
  const glasses = parseFile(problems, named, 'glasses', files.data.glasses, parseGlass);
  const methods = parseFile(problems, named, 'methods', files.data.methods, parseMethod);
  const utensils = parseFile(problems, named, 'utensils', files.data.utensils, parseUtensil);
  const descriptors = parseFile(problems, named, 'taste-descriptors', files.data['taste-descriptors'], parseDescriptor);
  const calculators = parseFile(problems, named, 'calculators', files.data.calculators, parseCalculator);
  const ingredients = parseFile(problems, named, 'ingredients', files.data.ingredients, parseIngredient);
  const recipes = parseFile(problems, named, 'recipes', files.data.recipes, parseRecipe);

  checkFoldedNames(problems, 'glasses', glasses.records);
  checkFoldedNames(problems, 'methods', methods.records);
  checkFoldedNames(problems, 'utensils', utensils.records);
  checkFoldedNames(problems, 'taste-descriptors', descriptors.records);
  checkFoldedNames(problems, 'calculators', calculators.records);
  checkFoldedNames(problems, 'ingredients', ingredients.records);

  const ingredientFile = new Checker(problems, [], 'data/ingredients.json');
  for (const ingredient of ingredients.records) {
    const ic = ingredientFile.at(null);
    ic.record = ingredient.key;
    reference(ic, 'parent', ingredient.parent, ingredients.keys);
    for (const [index, part] of ingredient.parts.entries()) {
      reference(ic.at(`part ${index + 1}`), 'ingredient', part.ingredient, ingredients.keys);
    }
  }
  const recipeFile = new Checker(problems, [], 'data/recipes.json');
  for (const recipe of recipes.records) {
    const rc = recipeFile.at(null);
    rc.record = recipe.key;
    reference(rc, 'glass', recipe.glass, glasses.keys);
    reference(rc, 'method', recipe.method, methods.keys);
    for (const utensil of recipe.utensils) {
      reference(rc, 'utensil', utensil, utensils.keys);
    }
    reference(rc, 'parent', recipe.parent, recipes.keys);
    for (const [index, line] of recipe.lines.entries()) {
      const lc = rc.at(`line ${index + 1}`);
      reference(lc, 'ingredient', line.ingredient, ingredients.keys);
      for (const [subIndex, sub] of line.substitutes.entries()) {
        reference(lc.at(`substitute ${subIndex + 1}`), 'ingredient', sub.ingredient, ingredients.keys);
      }
    }
  }
  checkIngredientChains(problems, ingredients.records);
  checkRecipeChains(problems, recipes.records);
  checkTagSpellings(problems, recipes.records);
  const images = checkImageFiles(problems, named, files.imageFiles, readImageBytes);

  if (problems.length > 0 || version === undefined) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    catalog: {
      version,
      glasses: glasses.records,
      methods: methods.records,
      utensils: utensils.records,
      tasteDescriptors: descriptors.records,
      calculators: calculators.records,
      ingredients: ingredients.records,
      recipes: recipes.records,
      images,
      notices: repeatedIngredientNotices(recipes.records),
    },
  };
}
