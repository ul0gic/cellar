import type { LineCoverage, RecipeSummary } from '@cellar/contract';
import type { HaveSegment } from '../../../design-system/cl-have-bar.ts';

const SEGMENT: Readonly<Record<LineCoverage, HaveSegment>> = { on_hand: 'on', covered: 'via', missing: 'off' };

export function segmentsOf(recipe: RecipeSummary): HaveSegment[] {
  return recipe.coverage.map((coverage) => SEGMENT[coverage]);
}
