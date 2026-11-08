import { writeFileSync } from 'node:fs';
import { out } from '../../gate2/lib.ts';
import { bottle, ingredient, mark, ownerClient, recipe } from '../../gate2/fx.ts';

const c = await ownerClient();
const id: Record<string, number> = {};
const roots = [
  'Whiskey',
  'Gin',
  'Lemon',
  'Lime',
  'Rum',
  'Mint',
  'Bitters',
  'Triple Sec',
  'Dry Curacao',
  'Sugar',
  'Water',
  'Citrus',
];
for (const r of roots) id[r] = await ingredient(c, `CM ${r}`);
id.Bourbon = await ingredient(c, 'CM Bourbon', id.Whiskey);
id.Rye = await ingredient(c, 'CM Rye', id.Whiskey);
id.Yuzu = await ingredient(c, 'CM Yuzu', id.Citrus);
id.Cordial = await ingredient(c, 'CM Cordial', null, [
  { ingredientId: id.Sugar, amount: 1, unit: 'oz' },
  { ingredientId: id.Water, amount: 1, unit: 'oz' },
]);
await bottle(c, id.Bourbon, 'CM Bourbon Bottle', 'sealed');
await bottle(c, id['Dry Curacao'], 'CM Dry Curacao Bottle', 'open');
for (const m of ['Gin', 'Lemon', 'Sugar', 'Water', 'Citrus']) await mark(c, id[m]);
const sub = await c.post('/api/v1/substitutions', {
  fromIngredientId: id['Dry Curacao'],
  toIngredientId: id['Triple Sec'],
  effect: 'same_drink',
});
out('household substitution', sub.status);

const rid: Record<string, number> = {};
const R = async (name: string, lines: Parameters<typeof recipe>[2]) => {
  rid[name] = await recipe(c, name, lines);
};
await R('CM R01 Direct', [{ ing: id.Gin }, { ing: id.Gin, amount: null, unit: null }, { ing: id.Lemon }]);
await R('CM R02 Via Substitute', [{ ing: id.Rye, subs: [id.Rum, id.Bourbon] }, { ing: id.Lemon }]);
await R('CM R03 Via Variant', [{ ing: id.Whiskey }, { ing: id.Gin }]);
await R('CM R04 Specified Variant', [{ ing: id.Whiskey, specified: true }, { ing: id.Gin }]);
await R('CM R05 Household Sub', [{ ing: id['Triple Sec'] }, { ing: id.Lemon }]);
await R('CM R06 House Made', [{ ing: id.Cordial }, { ing: id.Gin }]);
await R('CM R07 Optional Lines', [
  { ing: id.Gin },
  { ing: id.Bitters, optional: true },
  { ing: id.Mint, optional: true },
]);
await R('CM R08 Parent Not Child', [{ ing: id.Yuzu }, { ing: id.Gin }]);
await R('CM R09 Two Missing', [{ ing: id.Rum }, { ing: id.Lime }, { ing: id.Gin }]);
await R('CM R10 Duplicate Lines', [{ ing: id.Rum }, { ing: id.Rum, amount: null, unit: null }, { ing: id.Gin }]);
await R('CM R11 Optional Missing', [{ ing: id.Mint, optional: true }, { ing: id.Rum }, { ing: id.Gin }]);
await R('CM R12 Three Missing', [{ ing: id.Rum }, { ing: id.Lime }, { ing: id.Mint }, { ing: id.Gin }]);
writeFileSync(process.argv[2], JSON.stringify({ id, rid }, null, 1));
out('built', Object.keys(rid).length, 'recipes');
