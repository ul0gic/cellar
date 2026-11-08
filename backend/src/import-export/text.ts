import {
  canonicalUnit,
  type DraftLine,
  foldName,
  type Id,
  type InputVolumeUnit,
  LIMITS,
  parseAmount,
  type RecipeDraft,
  type UnitId,
} from '@cellar/contract';
import type { Database } from '../core/db.ts';

export interface IngredientMatcher {
  match(name: string): Id | null;
}

export function ingredientMatcher(db: Database): IngredientMatcher {
  const byName = new Map<string, Id>();
  for (const row of db.prepare('SELECT id, folded_name FROM ingredients ORDER BY id').all()) {
    if (typeof row.id === 'number' && typeof row.folded_name === 'string' && !byName.has(row.folded_name)) {
      byName.set(row.folded_name, row.id);
    }
  }
  return {
    match(name) {
      const words = foldName(name)
        .split(/\s+/)
        .filter((word) => word !== '');
      for (let start = 0; start < words.length; start += 1) {
        const id = byName.get(words.slice(start).join(' '));
        if (id !== undefined) {
          return id;
        }
      }
      return null;
    },
  };
}

interface ReadAmount {
  readonly amount: number;
  readonly amountMax: number | null;
  readonly rest: string;
}

function readAmount(text: string): ReadAmount | null {
  const attached = /^(\d+(?:\.\d+)?)([a-z]+)\b\s*(.*)$/i.exec(text);
  if (attached !== null && canonicalUnit(attached[2]) !== null) {
    return { amount: Number(attached[1]), amountMax: null, rest: `${attached[2]} ${attached[3]}` };
  }
  const range = /^(\S+)\s*(?:-|–|to)\s*(\S+)\s+(.*)$/.exec(text);
  if (range !== null) {
    const low = parseAmount(range[1]);
    const high = parseAmount(range[2]);
    if (low !== null && high !== null && high > low) {
      return { amount: low, amountMax: high, rest: range[3] };
    }
  }
  const tokens = text.split(/\s+/);
  for (const count of [2, 1]) {
    const amount = parseAmount(tokens.slice(0, count).join(' '));
    if (amount !== null && tokens.length >= count) {
      return { amount, amountMax: null, rest: tokens.slice(count).join(' ') };
    }
  }
  return null;
}

function readUnit(rest: string): { unit: UnitId | InputVolumeUnit | null; name: string } {
  const [first = '', second = '', ...others] = rest.split(/\s+/);
  const two = canonicalUnit(`${first} ${second}`);
  if (second !== '' && two !== null) {
    return { unit: two, name: others.join(' ') };
  }
  const one = canonicalUnit(first.replace(/\.$/, ''));
  if (one !== null) {
    return { unit: one, name: [second, ...others].join(' ').trim() };
  }
  return { unit: null, name: rest };
}

function draftLine(matcher: IngredientMatcher, text: string, amount: ReadAmount | null): DraftLine {
  const { unit, name } = amount === null ? { unit: null, name: text } : readUnit(amount.rest);
  const ingredientId = matcher.match(name.replace(/^of\s+/i, ''));
  return {
    ingredientId,
    ingredientText: text,
    matched: ingredientId !== null,
    amount: amount?.amount ?? null,
    amountMax: amount?.amountMax ?? null,
    unit,
    optional: false,
    specified: false,
    note: '',
    substitutes: [],
  };
}

export function ingredientLine(matcher: IngredientMatcher, text: string): DraftLine {
  const trimmed = text.trim();
  return draftLine(matcher, trimmed, readAmount(trimmed));
}

export function emptyDraftRecipe(name: string): RecipeDraft['recipe'] {
  return {
    name: name.slice(0, LIMITS.name.max),
    description: '',
    instructions: '',
    garnish: '',
    source: '',
    year: null,
    glassId: null,
    methodId: null,
    utensilIds: [],
    tags: [],
    parentId: null,
    lines: [],
  };
}

export function draftFromText(matcher: IngredientMatcher, text: string): RecipeDraft {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const nameIndex = lines.findIndex((line) => line !== '');
  const recipe = emptyDraftRecipe(nameIndex === -1 ? '' : lines[nameIndex]);
  const draftLines: DraftLine[] = [];
  const instructions: string[] = [];
  for (const line of lines.slice(nameIndex + 1)) {
    if (line === '') {
      continue;
    }
    const cleaned = line.replace(/^[-*•]\s*/, '');
    const amount = readAmount(cleaned);
    if (amount !== null && draftLines.length < LIMITS.recipeLines.max) {
      draftLines.push(draftLine(matcher, cleaned, amount));
    } else {
      instructions.push(line);
    }
  }
  return {
    source: 'text',
    sourceUrl: null,
    recipe: {
      ...recipe,
      instructions: instructions.join('\n').slice(0, LIMITS.instructions.max),
      lines: draftLines,
    },
    imageUrl: null,
  };
}
