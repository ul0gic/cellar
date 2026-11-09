import { formatAmount, LIMITS, type PartyLine } from '@cellar/contract';
import type { QuerySignal } from '../../../app/types.ts';
import { formatNumber } from '../../../text/format.ts';

// D-1 §8.8: the party servings stepper runs from 1 to 500.
export const PARTY_SERVINGS_MAX = 500;

export interface PartyPlan {
  readonly collectionId: number | null;
  readonly recipeIds: readonly number[];
  readonly same: boolean;
  readonly servings: number;
  readonly each: ReadonlyMap<number, number>;
}

function clampServings(value: number): number {
  return Number.isInteger(value) && value >= 1 ? Math.min(value, PARTY_SERVINGS_MAX) : 1;
}

function ids(raw: string | null): number[] {
  if (raw === null) {
    return [];
  }
  return raw
    .split(',')
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, LIMITS.partyRecipes.max);
}

export function readPlan(query: QuerySignal): PartyPlan {
  const collection = Number(query.get('collection'));
  const each = new Map<number, number>();
  for (const pair of (query.get('each') ?? '').split(',')) {
    const [id, count] = pair.split(':').map(Number);
    if (id !== undefined && count !== undefined && Number.isSafeInteger(id)) {
      each.set(id, clampServings(count));
    }
  }
  return {
    collectionId: Number.isSafeInteger(collection) && collection > 0 ? collection : null,
    recipeIds: ids(query.get('recipes')),
    same: query.get('each') === null,
    servings: clampServings(Number(query.get('servings') ?? '1')),
    each,
  };
}

export function servingsFor(plan: PartyPlan, recipeId: number): number {
  return plan.same ? plan.servings : (plan.each.get(recipeId) ?? plan.servings);
}

export function mlText(line: PartyLine): string {
  return line.volumeMl === null ? '' : formatNumber(Math.round(line.volumeMl));
}

export function ozText(line: PartyLine): string {
  return line.volumeMl === null ? '' : formatAmount({ amount: line.volumeMl, amountMax: null, unit: 'ml' }, 'oz').text;
}

export function countsText(line: PartyLine): string {
  return line.counts
    .map(
      (count) =>
        formatAmount({ amount: count.amount === 0 ? null : count.amount, amountMax: null, unit: count.unit }, 'oz')
          .text,
    )
    .filter((part) => part !== '')
    .join(', ');
}
