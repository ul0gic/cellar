import type { HouseholdRating, RatingState, RatingValue } from '@cellar/contract';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../../app/api.ts';
import { invalidate } from '../../../app/resources.ts';
import { text } from '../../../text/index.ts';
import { actionFailed } from './failures.ts';

const HINT_KEY = 'cellar.ratingHintSeen';
const RATING_VALUES: readonly RatingValue[] = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === 'yes';
  } catch (error) {
    if (error instanceof DOMException) {
      return false;
    }
    throw error;
  }
}

function markHintSeen(): void {
  try {
    localStorage.setItem(HINT_KEY, 'yes');
  } catch (error) {
    if (!(error instanceof DOMException)) {
      throw error;
    }
  }
}

export function householdLine(rating: HouseholdRating): string {
  return rating.average === null
    ? text('recipes.noHouseRatings')
    : text('recipes.houseAverage', { average: rating.average.toFixed(1), count: rating.count });
}

export interface RatingControl {
  readonly value: number;
  readonly household: HouseholdRating;
  readonly recipeId: number;
  readonly onRated: (value: number, state: RatingState) => void;
  readonly alwaysHint?: boolean;
}

async function rate(opts: RatingControl, picked: number): Promise<void> {
  const target = RATING_VALUES.find((value) => value === picked);
  const clearing = target === undefined || target === opts.value;
  try {
    const state = clearing
      ? await call('clearRecipeRating', { params: { id: opts.recipeId } })
      : await call('rateRecipe', { params: { id: opts.recipeId }, body: { value: target } });
    if (clearing) {
      markHintSeen();
    }
    invalidate('recipes', 'stats');
    opts.onRated(state.mine?.value ?? 0, state);
  } catch (error) {
    actionFailed(error, () => void rate(opts, picked));
  }
}

export function ratingControl(opts: RatingControl): TemplateResult {
  const showHint = opts.alwaysHint === true || (opts.value > 0 && !hintSeen());
  return html`<div class="cl-rating-block">
    <lc-rating
      step="0.5"
      clearable
      label=${text('rating.label')}
      .value=${opts.value}
      .change=${(picked: number) => void rate(opts, picked)}
    ></lc-rating>
    ${showHint ? html`<p class="cl-rating-hint">${text('recipes.ratingHint')}</p>` : nothing}
    <p class="cl-rating-house">${text('recipes.yourRating')} ${householdLine(opts.household)}</p>
  </div>`;
}
