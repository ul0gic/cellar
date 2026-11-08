import { Client } from './lib.ts';

export async function ownerClient(password = 'owner-password-2'): Promise<Client> {
  const c = new Client();
  const r = await c.post('/api/v1/session', { name: 'Owner', password });
  if (r.status !== 200) throw new Error(`owner login ${r.status} ${r.text}`);
  return c;
}

export async function ingredient(
  c: Client,
  name: string,
  parentId: number | null = null,
  parts: { ingredientId: number; amount: number | null; unit: string | null }[] = [],
): Promise<number> {
  const r = await c.post('/api/v1/ingredients', {
    name,
    parentId,
    strength: 0,
    description: '',
    origin: '',
    color: null,
    defaultUnit: null,
    imageId: null,
    parts,
  });
  if (r.status !== 201) throw new Error(`ingredient ${name}: ${r.status} ${r.text}`);
  return r.json.id;
}

export interface Line {
  ing: number;
  optional?: boolean;
  specified?: boolean;
  subs?: number[];
  amount?: number | null;
  unit?: string | null;
  amountMax?: number | null;
}

export async function recipe(c: Client, name: string, lines: Line[]): Promise<number> {
  const r = await c.post('/api/v1/recipes', {
    name,
    description: '',
    instructions: 'Stir.',
    garnish: '',
    source: '',
    year: null,
    glassId: null,
    methodId: null,
    utensilIds: [],
    tags: [],
    imageIds: [],
    parentId: null,
    lines: lines.map((l) => ({
      ingredientId: l.ing,
      amount: l.amount === undefined ? 50 : l.amount,
      amountMax: l.amountMax ?? null,
      unit: l.unit === undefined ? 'ml' : l.unit,
      optional: l.optional ?? false,
      specified: l.specified ?? false,
      note: '',
      substitutes: (l.subs ?? []).map((s) => ({ ingredientId: s, amount: null, amountMax: null, unit: null })),
    })),
  });
  if (r.status !== 201) throw new Error(`recipe ${name}: ${r.status} ${r.text}`);
  return r.json.id;
}

export async function bottle(
  c: Client,
  ingredientId: number,
  name: string,
  status: 'sealed' | 'open' = 'sealed',
  count = 1,
): Promise<number[]> {
  const r = await c.post('/api/v1/bottles', {
    name,
    ingredientId,
    labeledSize: '750 ml',
    volumeMl: 750,
    abv: null,
    pricePaidMinor: null,
    purchasedOn: null,
    openedOn: status === 'open' ? '2026-11-01' : null,
    note: '',
    imageId: null,
    status,
    count,
  });
  if (r.status !== 201) throw new Error(`bottle ${name}: ${r.status} ${r.text}`);
  return r.json.bottles.map((b: { id: number }) => b.id);
}

export async function mark(c: Client, id: number, marked = true): Promise<void> {
  const r = await c.put(`/api/v1/ingredients/${id}/on-hand`, { marked });
  if (r.status !== 200) throw new Error(`mark ${id}: ${r.status} ${r.text}`);
}
