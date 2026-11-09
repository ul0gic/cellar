const LEADING_NUMBER = /^\d+[.)]\s+/;

export function methodSteps(instructions: string): string[] {
  return instructions
    .split(/\n+/)
    .map((step) => step.trim().replace(LEADING_NUMBER, ''))
    .filter((step) => step !== '');
}
