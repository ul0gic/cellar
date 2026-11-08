export interface VocabTerm {
  readonly term: string;
  readonly doc: number;
}

export function maxDistance(folded: string): number {
  const length = [...folded].length;
  if (length >= 8) {
    return 2;
  }
  return length >= 5 ? 1 : 0;
}

function damerauLevenshtein(a: readonly string[], b: readonly string[], limit: number): number {
  if (Math.abs(a.length - b.length) > limit) {
    return limit + 1;
  }
  let beforePrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, beforePrevious[j - 2] + 1);
      }
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) {
      return limit + 1;
    }
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length];
}

export function closestTerm(folded: string, vocabulary: readonly VocabTerm[]): string | null {
  const limit = maxDistance(folded);
  const chars = [...folded];
  let best: { term: string; distance: number; doc: number } | null = null;
  for (const { term, doc } of vocabulary) {
    const distance = damerauLevenshtein(chars, [...term], limit);
    if (distance > limit) {
      continue;
    }
    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && (doc > best.doc || (doc === best.doc && term < best.term)))
    ) {
      best = { term, distance, doc };
    }
  }
  return best?.term ?? null;
}
