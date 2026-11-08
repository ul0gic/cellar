export function foldName(name: string): string {
  return name.trim().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').toLowerCase();
}
