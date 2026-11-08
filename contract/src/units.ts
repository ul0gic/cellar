import type { PreferredUnit } from './primitives.ts';

export const RECIPE_ML_PER_OZ = 30;
export const LABEL_ML_PER_FL_OZ = 29.5735;
export const ML_PER_CL = 10;
export const ML_PER_L = 1000;
export const INPUT_VOLUME_UNITS = ['ml', 'oz', 'cl'] as const;
export type InputVolumeUnit = (typeof INPUT_VOLUME_UNITS)[number];

export const UNIT_IDS = [
  'ml',
  'dash',
  'barspoon',
  'drop',
  'tsp',
  'tbsp',
  'cup',
  'shot',
  'splash',
  'pinch',
  'whole',
  'leaf',
  'sprig',
  'slice',
  'wedge',
  'peel',
  'cube',
  'piece',
  'stick',
  'stalk',
  'chunk',
  'scoop',
  'bean',
  'yolk',
  'bottle',
  'inch',
  'capsule',
  'g',
  'part',
  'top-up',
  'float',
  'rinse',
] as const;
export type UnitId = (typeof UNIT_IDS)[number];
export type UnitKind = 'volume' | 'count' | 'ratio' | 'instruction';

export const UNIT_KIND: Readonly<Record<UnitId, UnitKind>> = {
  ml: 'volume',
  dash: 'count',
  barspoon: 'count',
  drop: 'count',
  tsp: 'count',
  tbsp: 'count',
  cup: 'count',
  shot: 'count',
  splash: 'count',
  pinch: 'count',
  whole: 'count',
  leaf: 'count',
  sprig: 'count',
  slice: 'count',
  wedge: 'count',
  peel: 'count',
  cube: 'count',
  piece: 'count',
  stick: 'count',
  stalk: 'count',
  chunk: 'count',
  scoop: 'count',
  bean: 'count',
  yolk: 'count',
  bottle: 'count',
  inch: 'count',
  capsule: 'count',
  g: 'count',
  part: 'ratio',
  'top-up': 'instruction',
  float: 'instruction',
  rinse: 'instruction',
};

export const UNIT_ALIASES: Readonly<Record<string, UnitId | InputVolumeUnit>> = {
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  ounce: 'oz',
  ounces: 'oz',
  'fl oz': 'oz',
  'fl. oz': 'oz',
  floz: 'oz',
  centiliter: 'cl',
  centiliters: 'cl',
  centilitre: 'cl',
  centilitres: 'cl',
  dashes: 'dash',
  drops: 'drop',
  barspoons: 'barspoon',
  bsp: 'barspoon',
  'bar spoon': 'barspoon',
  'bar spoons': 'barspoon',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  cups: 'cup',
  shots: 'shot',
  splashes: 'splash',
  pinches: 'pinch',
  leaves: 'leaf',
  sprigs: 'sprig',
  slices: 'slice',
  wedges: 'wedge',
  peels: 'peel',
  cubes: 'cube',
  pieces: 'piece',
  sticks: 'stick',
  stalks: 'stalk',
  chunks: 'chunk',
  scoops: 'scoop',
  beans: 'bean',
  yolks: 'yolk',
  bottles: 'bottle',
  inches: 'inch',
  in: 'inch',
  capsules: 'capsule',
  gram: 'g',
  grams: 'g',
  parts: 'part',
  topup: 'top-up',
  'top up': 'top-up',
  top: 'top-up',
  'to top': 'top-up',
};

export const UNIT_LABELS: Readonly<Record<UnitId, string>> = {
  ml: 'ml',
  dash: 'dash',
  barspoon: 'barspoon',
  drop: 'drop',
  tsp: 'tsp',
  tbsp: 'tbsp',
  cup: 'cup',
  shot: 'shot',
  splash: 'splash',
  pinch: 'pinch',
  whole: 'whole',
  leaf: 'leaf',
  sprig: 'sprig',
  slice: 'slice',
  wedge: 'wedge',
  peel: 'peel',
  cube: 'cube',
  piece: 'piece',
  stick: 'stick',
  stalk: 'stalk',
  chunk: 'chunk',
  scoop: 'scoop',
  bean: 'bean',
  yolk: 'yolk',
  bottle: 'bottle',
  inch: 'inch',
  capsule: 'capsule',
  g: 'g',
  part: 'part',
  'top-up': 'top up',
  float: 'float',
  rinse: 'rinse',
};

export const UNIT_PLURALS: Readonly<Record<UnitId, string>> = {
  ml: 'ml',
  dash: 'dashes',
  barspoon: 'barspoons',
  drop: 'drops',
  tsp: 'tsp',
  tbsp: 'tbsp',
  cup: 'cups',
  shot: 'shots',
  splash: 'splashes',
  pinch: 'pinches',
  whole: 'whole',
  leaf: 'leaves',
  sprig: 'sprigs',
  slice: 'slices',
  wedge: 'wedges',
  peel: 'peels',
  cube: 'cubes',
  piece: 'pieces',
  stick: 'sticks',
  stalk: 'stalks',
  chunk: 'chunks',
  scoop: 'scoops',
  bean: 'beans',
  yolk: 'yolks',
  bottle: 'bottles',
  inch: 'inches',
  capsule: 'capsules',
  g: 'g',
  part: 'parts',
  'top-up': 'top up',
  float: 'float',
  rinse: 'rinse',
};

function isUnitId(unit: string): unit is UnitId {
  return UNIT_IDS.some((id) => id === unit);
}

export function canonicalUnit(raw: string): UnitId | InputVolumeUnit | null {
  const spelled = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (isUnitId(spelled) || isVolumeUnit(spelled)) {
    return spelled;
  }
  return UNIT_ALIASES[spelled] ?? null;
}

export function isVolumeUnit(unit: string): unit is InputVolumeUnit {
  return INPUT_VOLUME_UNITS.some((volumeUnit) => volumeUnit === unit);
}

export function toMl(amount: number, unit: InputVolumeUnit): number {
  switch (unit) {
    case 'ml':
      return amount;
    case 'oz':
      return amount * RECIPE_ML_PER_OZ;
    case 'cl':
      return amount * ML_PER_CL;
  }
}

export interface AmountInput {
  amount: number | null;
  amountMax: number | null;
  unit: UnitId | null;
}

export interface AmountDisplay {
  text: string;
  value: string;
  unit: string;
}

const QUARTER_OZ_ML = 7.5;
const FRACTIONS: Readonly<Record<number, string>> = { 1: '¼', 2: '½', 3: '¾' };

export function scaleAmount(amount: number, servings: number): number {
  return amount * servings;
}

function roundToHalf(value: number): number {
  const rounded = Math.round(value * 2) / 2;
  return rounded === 0 && value > 0 ? 0.5 : rounded;
}

function printMl(ml: number): string {
  const rounded = roundToHalf(ml);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function roundToQuarter(value: number): number {
  const rounded = Math.round(value * 4) / 4;
  return rounded === 0 && value > 0 ? 0.25 : rounded;
}

function printQuarters(quarterRounded: number): string {
  const whole = Math.floor(quarterRounded);
  const quarters = Math.round((quarterRounded - whole) * 4);
  const fraction = FRACTIONS[quarters];
  if (fraction === undefined) {
    return String(whole);
  }
  return whole === 0 ? fraction : `${whole} ${fraction}`;
}

function joinRange(low: string, high: string | null): string {
  return high === null ? low : `${low}–${high}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatAmount(line: AmountInput, preferred: PreferredUnit, servings = 1): AmountDisplay {
  const { unit } = line;
  if (unit !== null && UNIT_KIND[unit] === 'instruction') {
    const label = UNIT_LABELS[unit];
    return { text: capitalise(label), value: '', unit: label };
  }
  if (line.amount === null) {
    if (unit === null) {
      return { text: '', value: '', unit: '' };
    }
    const label = unit === 'ml' ? preferred : UNIT_LABELS[unit];
    return { text: capitalise(label), value: '', unit: label };
  }
  const low = scaleAmount(line.amount, servings);
  const high = line.amountMax === null ? null : scaleAmount(line.amountMax, servings);

  if (unit === 'ml') {
    if (preferred === 'ml' || low < QUARTER_OZ_ML) {
      const value = joinRange(printMl(low), high === null ? null : printMl(high));
      return { text: `${value} ml`, value, unit: 'ml' };
    }
    const value = joinRange(
      printQuarters(roundToQuarter(low / RECIPE_ML_PER_OZ)),
      high === null ? null : printQuarters(roundToQuarter(high / RECIPE_ML_PER_OZ)),
    );
    return { text: `${value} oz`, value, unit: 'oz' };
  }

  const lowRounded = roundToQuarter(low);
  const highRounded = high === null ? null : roundToQuarter(high);
  const value = joinRange(printQuarters(lowRounded), highRounded === null ? null : printQuarters(highRounded));
  if (unit === null) {
    return { text: value, value, unit: '' };
  }
  const largest = highRounded ?? lowRounded;
  const label = largest <= 1 ? UNIT_LABELS[unit] : UNIT_PLURALS[unit];
  return { text: `${value} ${label}`, value, unit: label };
}

export function formatVolume(ml: number, preferred: PreferredUnit): string {
  if (preferred === 'oz') {
    return `${(ml / RECIPE_ML_PER_OZ).toFixed(1)} oz`;
  }
  if (ml < ML_PER_L) {
    return `${printMl(ml)} ml`;
  }
  return `${(ml / ML_PER_L).toFixed(2)} L`;
}

const VULGAR_FRACTIONS: Readonly<Record<string, number>> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };

export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (/^(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) {
    return Number(trimmed);
  }
  const fraction = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(trimmed);
  if (fraction !== null) {
    const [, whole, numerator, denominator] = fraction;
    if (Number(denominator) === 0) {
      return null;
    }
    return Number(whole ?? 0) + Number(numerator) / Number(denominator);
  }
  const vulgar = /^(\d+)?\s?([¼½¾])$/.exec(trimmed);
  if (vulgar !== null) {
    const [, whole, symbol] = vulgar;
    return Number(whole ?? 0) + VULGAR_FRACTIONS[symbol];
  }
  return null;
}

const LABEL_UNIT_ML: Readonly<Record<string, number>> = {
  ml: 1,
  cl: ML_PER_CL,
  l: ML_PER_L,
  litre: ML_PER_L,
  liter: ML_PER_L,
  'fl oz': LABEL_ML_PER_FL_OZ,
  floz: LABEL_ML_PER_FL_OZ,
  oz: LABEL_ML_PER_FL_OZ,
};

export function parseLabeledSize(label: string): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(ml|cl|litre|liter|l|fl\s?oz|oz)\s*$/i.exec(label);
  if (match === null) {
    return null;
  }
  const [, number, unit] = match;
  const factor = LABEL_UNIT_ML[unit.toLowerCase().replace(/\s/, ' ')];
  return Math.round(Number(number.replace(',', '.')) * factor * 1000) / 1000;
}

function currencyFormat(currency: string): Intl.NumberFormat {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency });
}

export function currencyDigits(currency: string): number {
  const digits = currencyFormat(currency).resolvedOptions().maximumFractionDigits;
  if (digits === undefined) {
    throw new Error(`Intl reports no fraction digits for currency ${currency}`);
  }
  return digits;
}

export function formatMoney(minor: number, currency: string): string {
  return currencyFormat(currency).format(minor / 10 ** currencyDigits(currency));
}

export function parseMoney(text: string, currency: string): number | null {
  const symbol = currencyFormat(currency)
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value;
  let rest = text.trim();
  if (symbol !== undefined && rest.startsWith(symbol)) {
    rest = rest.slice(symbol.length).trim();
  }
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(rest);
  if (match === null) {
    return null;
  }
  const [, whole, fraction = ''] = match;
  const digits = currencyDigits(currency);
  if (fraction.length > digits) {
    return null;
  }
  return Number.parseInt(`${whole.replaceAll(',', '')}${fraction.padEnd(digits, '0')}`, 10);
}
