export interface AbvLine {
  amountMl: number | null;
  strength: number;
  optional: boolean;
}

function countedMl(line: AbvLine): number | null {
  return !line.optional && line.amountMl !== null && line.amountMl > 0 ? line.amountMl : null;
}

export function recipeVolumeMl(lines: readonly AbvLine[]): number | null {
  let total: number | null = null;
  for (const line of lines) {
    const ml = countedMl(line);
    if (ml !== null) {
      total = (total ?? 0) + ml;
    }
  }
  return total;
}

export function computeAbv(lines: readonly AbvLine[], dilutionPercent: number): number | null {
  const volume = recipeVolumeMl(lines);
  if (volume === null) {
    return null;
  }
  let alcohol = 0;
  for (const line of lines) {
    const ml = countedMl(line);
    if (ml !== null) {
      alcohol += ml * line.strength;
    }
  }
  return alcohol / (volume * (1 + dilutionPercent / 100));
}

export function formatAbv(abv: number | null): string {
  return abv === null ? '' : `${abv.toFixed(1)}%`;
}
