// D-1 §8.8: the servings stepper runs from 1 to 50.
export const SERVINGS_MAX = 50;

export function servingsOf(raw: string | null): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= SERVINGS_MAX ? value : 1;
}
