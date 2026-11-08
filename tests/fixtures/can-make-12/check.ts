import { readFileSync } from 'node:fs';
import { out } from '../../gate2/lib.ts';
import { ownerClient } from '../../gate2/fx.ts';

interface ExpectedRecipe {
  missing: number;
  lines: string[];
  add: string[];
}
interface Expected {
  recipes: Record<string, ExpectedRecipe>;
  filters: Record<string, string[]>;
  facets: unknown;
  buyNext: { name: string; unlocks: string[] }[];
}
interface ListItem {
  name: string;
  missingCount: number;
}
interface RecipeLine {
  status: string;
  optional: boolean;
  satisfiedBy?: { name: string } | null;
  substitutionEffect?: string | null;
}
interface BuyNextItem {
  ingredient: { name: string };
  recipes: { name: string }[];
  unlocks: number;
}
interface ShoppingItem {
  ingredient: { name: string };
  count: number;
}

const expected: Expected = JSON.parse(readFileSync(new URL('./expected.json', import.meta.url), 'utf8'));
const st = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const c = await ownerClient();
const short = (n: string) => n.split(' ')[1];
let mismatches = 0;
const say = (ok: boolean, msg: string) => {
  if (!ok) mismatches++;
  out(ok ? 'ok  ' : 'FAIL', msg);
};

// list filters
const all = await c.get('/api/v1/recipes?pageSize=100&q=CM');
say(all.json.items.length === 12, `list q=CM has ${all.json.items.length} items`);
say(
  JSON.stringify(all.json.facets) === JSON.stringify(expected.facets),
  `facets ${JSON.stringify(all.json.facets)} expected ${JSON.stringify(expected.facets)}`,
);
const listMissing: Record<string, number> = {};
const allItems: ListItem[] = all.json.items;
for (const i of allItems) listMissing[short(i.name)] = i.missingCount;
for (const [name, e] of Object.entries(expected.recipes))
  say(
    listMissing[short(name)] === e.missing,
    `list missingCount ${name}: ${listMissing[short(name)]} expected ${e.missing}`,
  );
const flt: Record<string, string[]> = {};
for (const s of ['can_make', 'missing_1', 'missing_2']) {
  const r = await c.get(`/api/v1/recipes?pageSize=100&status=${s}`);
  const filterItems: ListItem[] = r.json.items;
  flt[s] = filterItems.map((i) => short(i.name)).sort();
  say(
    JSON.stringify(flt[s]) === JSON.stringify([...expected.filters[s]].sort()),
    `filter ${s}: ${flt[s]} expected ${expected.filters[s]}`,
  );
}
// per recipe page
for (const [name, e] of Object.entries(expected.recipes)) {
  const r = await c.get(`/api/v1/recipes/${st.rid[name]}`);
  const pageLines: RecipeLine[] = r.json.lines;
  const lines = pageLines.map(
    (l) =>
      l.status +
      (l.satisfiedBy ? `:${l.satisfiedBy.name}` : '') +
      (l.substitutionEffect ? `:${l.substitutionEffect}` : ''),
  );
  say(
    JSON.stringify(lines) === JSON.stringify(e.lines),
    `${name} lines ${JSON.stringify(lines)} expected ${JSON.stringify(e.lines)}`,
  );
  const reqMissing = pageLines.filter((l) => !l.optional && l.status === 'missing').length;
  say(
    r.json.missingCount === e.missing && reqMissing === e.missing,
    `${name} page missingCount ${r.json.missingCount}, required missing lines ${reqMissing}, expected ${e.missing}`,
  );
  const inFilter =
    e.missing === 0 ? 'can_make' : e.missing === 1 ? 'missing_1' : e.missing === 2 ? 'missing_2' : 'none';
  const member =
    Object.entries(flt)
      .filter(([, v]) => v.includes(short(name)))
      .map(([k]) => k)[0] ?? 'none';
  say(member === inFilter, `${name} filter membership ${member} expected ${inFilter}`);
}
// buy next
const bn = await c.get('/api/v1/buy-next');
const buyNextItems: BuyNextItem[] = bn.json.items;
const got = buyNextItems.map((i) => ({
  name: i.ingredient.name,
  unlocks: i.recipes.map((r) => r.name),
  n: i.unlocks,
}));
say(
  JSON.stringify(got.map((g) => [g.name, g.unlocks])) ===
    JSON.stringify(expected.buyNext.map((b) => [b.name, b.unlocks])),
  `buy-next ${JSON.stringify(got)}`,
);
say(
  got.every((g) => g.n === g.unlocks.length),
  'unlock counts equal listed names',
);
// add missing in order, cumulative
const listed = new Set<string>();
for (const [name, e] of Object.entries(expected.recipes)) {
  const r = await c.post(`/api/v1/recipes/${st.rid[name]}/missing-to-shopping-list`);
  const before = listed.size;
  let alreadyExpected = 0;
  for (const n of e.add) {
    if (listed.has(n)) alreadyExpected++;
    listed.add(n);
  }
  const listItems: ShoppingItem[] = r.json.list.items;
  const names = listItems.map((i) => i.ingredient.name).sort();
  say(
    r.status === 200 &&
      r.json.added === listed.size - before &&
      r.json.alreadyListed === alreadyExpected &&
      JSON.stringify(names) === JSON.stringify([...listed].sort()),
    `${name} addMissing added ${r.json.added} already ${r.json.alreadyListed} list ${JSON.stringify(names)}; expected added ${listed.size - before} already ${alreadyExpected}`,
  );
}
const sl = await c.get('/api/v1/shopping-list');
const shoppingItems: ShoppingItem[] = sl.json.items;
say(
  shoppingItems.every((i) => i.count === 1),
  `shopping counts ${JSON.stringify(shoppingItems.map((i) => [i.ingredient.name, i.count]))}`,
);
out('mismatches', mismatches);
