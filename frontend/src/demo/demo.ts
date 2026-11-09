import { html, render } from '@lightstart/light/html';
import { screen as notFound } from '../screens/launch/not-found.ts';
import { screen as offline } from '../screens/launch/offline.ts';
import { query, navigate } from '../app/router.ts';
import { person } from '../app/person.ts';
import { confirm, confirmTyped } from '../design-system/dialogs.ts';
import { skeleton } from '../design-system/skeleton.ts';
import { toast } from '../design-system/toast.ts';
import type { HaveSegment } from '../design-system/cl-have-bar.ts';
import type { PlateKind } from '../design-system/cl-plate.ts';
import './demo.css';

const PLATES: readonly PlateKind[] = [
  'coupe',
  'cocktail',
  'nick',
  'rocks',
  'highball',
  'flute',
  'wine',
  'mug',
  'shot',
  'glass',
  'bottle',
  'citrus',
  'jar',
];

const READY: readonly HaveSegment[] = ['on', 'on', 'on', 'on'];
const SWAP: readonly HaveSegment[] = ['on', 'via', 'on'];
const MISSING: readonly HaveSegment[] = ['on', 'off', 'on', 'via'];

const SHELF = [
  { name: 'Whiskey', count: 14 },
  { name: 'Rum', count: 9 },
  { name: 'Gin', count: 7 },
  { name: 'Liqueur', count: 6 },
  { name: 'Bitters', count: 4 },
  { name: 'Vermouth', count: 3 },
  { name: 'Brandy', count: 2 },
  { name: 'Tequila', count: 1 },
];

const YEARS = [
  { label: '2023', value: 18 },
  { label: '2024', value: 26 },
  { label: '2025', value: 31 },
  { label: '2026', value: 12 },
];

const FORM_FIELDS = [
  {
    name: 'lines',
    label: 'Line',
    type: 'array',
    addLabel: 'Add a line',
    itemFields: [{ name: 'ingredient', label: 'Ingredient', type: 'text' }],
  },
];

const FORM_DATA = { lines: [{ ingredient: 'Bourbon' }, { ingredient: 'Lemon juice' }] };

function ctxScreen(make: typeof notFound): HTMLElement {
  return make({ params: { path: '/recipez' }, query, navigate, person });
}

export function mountDemo(root: HTMLElement): void {
  document.getElementById('launch')?.remove();
  let rating = 3.5;

  const draw = (): void => {
    render(
      html`
        <main class="cl-page cl-demo">
          <h1>Compositions</h1>

          <section aria-labelledby="demo-bulbs">
            <h2 id="demo-bulbs">Bulbs</h2>
            <div class="cl-demo-row">
              <cl-bulb status="on" label="On hand"></cl-bulb>
              <cl-bulb status="via" label="Covered another way"></cl-bulb>
              <cl-bulb status="off" label="Missing"></cl-bulb>
              <cl-bulb status="optional" label="Optional"></cl-bulb>
              <cl-bulb status="on" size="live" label="Live"></cl-bulb>
              <cl-bulb status="on" size="dot" label="A menu is live"></cl-bulb>
            </div>
          </section>

          <section aria-labelledby="demo-have">
            <h2 id="demo-have">Have-bar and status pill</h2>
            <div class="cl-demo-col">
              <cl-have-bar .segments=${READY}></cl-have-bar>
              <cl-have-bar .segments=${SWAP}></cl-have-bar>
              <cl-have-bar .segments=${MISSING} stacked></cl-have-bar>
            </div>
            <div class="cl-demo-photo"><cl-status-pill .segments=${MISSING}></cl-status-pill></div>
          </section>

          <section aria-labelledby="demo-plates">
            <h2 id="demo-plates">Plates</h2>
            <div class="cl-demo-plates">
              ${PLATES.map((kind) => html`<cl-plate kind=${kind} name=${kind}></cl-plate>`)}
              <cl-plate kind="rocks" small name="Old fashioned"></cl-plate>
            </div>
          </section>

          <section aria-labelledby="demo-figure">
            <h2 id="demo-figure">Figure</h2>
            <cl-figure value="212" label="drinks we can make tonight" sublabel="Substitutes count as on hand." count-up>
              <lc-button variant="primary" href="/recipes/new">New recipe</lc-button>
            </cl-figure>
          </section>

          <section aria-labelledby="demo-cards">
            <h2 id="demo-cards">Recipe cards and rows</h2>
            <div class="cl-demo-cards">
              <cl-recipe-card
                href="/recipes/1"
                name="Paper Plane"
                summary="Bourbon, Aperol, Amaro Nonino, lemon juice"
                glass="Coupe"
                .segments=${READY}
                .rating=${4.7}
                .madeCount=${14}
                favorite
              ></cl-recipe-card>
              <cl-recipe-card
                href="/recipes/2"
                name="Mai Tai"
                summary="Aged rum, orange curaçao, orgeat, lime juice"
                glass="Rocks"
                .segments=${MISSING}
                .rating=${4.2}
                .madeCount=${1}
              ></cl-recipe-card>
            </div>
            <cl-recipe-row href="/recipes/1" name="Paper Plane" glass="Coupe" .segments=${READY} .rating=${4.7}></cl-recipe-row>
            <cl-recipe-row href="/recipes/2" name="Mai Tai" glass="Rocks" .segments=${MISSING} .rating=${4.2}></cl-recipe-row>
          </section>

          <section aria-labelledby="demo-lines">
            <h2 id="demo-lines">Ingredient lines</h2>
            <cl-ingredient-line
              .amount=${{ amount: 22.5, amountMax: null, unit: 'ml' }}
              unit="oz"
              name="Bourbon"
              href="/ingredients/1"
              status="on_hand"
              bottle="Buffalo Trace"
            ></cl-ingredient-line>
            <cl-ingredient-line
              .amount=${{ amount: 22.5, amountMax: 30, unit: 'ml' }}
              unit="oz"
              name="Aperol"
              href="/ingredients/2"
              status="via_substitute"
              via="Campari"
            ></cl-ingredient-line>
            <cl-ingredient-line
              .amount=${{ amount: 1, amountMax: null, unit: 'barspoon' }}
              unit="oz"
              name="Grappa amaro"
              href="/ingredients/3"
              status="missing"
              note="Chilled"
            ></cl-ingredient-line>
            <cl-ingredient-line
              .amount=${{ amount: null, amountMax: null, unit: 'top-up' }}
              unit="ml"
              name="Soda water"
              href="/ingredients/4"
              status="via_household_substitution"
              via="Seltzer"
              effect="changes_drink"
              optional
            ></cl-ingredient-line>
          </section>

          <section aria-labelledby="demo-live">
            <h2 id="demo-live">Live card, QR, stacked bar</h2>
            <cl-live-card name="Christmas Eve" drinks="9" href="/menus/1"></cl-live-card>
            <cl-qr value="http://cellar.local:7380/m/0123456789abcdefghjkmnpqrs"></cl-qr>
            <cl-stacked-bar label="Shelf by category" .items=${SHELF}></cl-stacked-bar>
          </section>

          <section aria-labelledby="demo-light">
            <h2 id="demo-light">Light components styled by light.css</h2>
            <lc-rating
              step="0.5"
              clearable
              label="Your rating"
              .value=${rating}
              .change=${(value: number) => {
                rating = value;
                draw();
              }}
            ></lc-rating>
            <lc-rating readonly step="0.5" .value=${4.5}></lc-rating>
            <lc-progress-bar value="412" max="663" label="Loading the recipe book"></lc-progress-bar>
            <lc-progress-bar indeterminate label="Making the backup"></lc-progress-bar>
            <lc-clipboard text="http://cellar.local:7380/m/0123456789abcdefghjkmnpqrs" label="Copy the link"></lc-clipboard>
            <lc-bar-chart label="Finished by year" height="140" show-values .data=${YEARS}></lc-bar-chart>
            <lc-form .fields=${FORM_FIELDS} .data=${FORM_DATA}></lc-form>
          </section>

          <section aria-labelledby="demo-feedback">
            <h2 id="demo-feedback">Dialogs, toasts, skeleton</h2>
            <div class="cl-demo-row">
              <lc-button variant="quiet" @click=${() => toast({ title: 'Note saved.' })}>Plain toast</lc-button>
              <lc-button
                variant="quiet"
                @click=${() => toast({ title: 'Made it. That’s 4 times for you.', action: { label: 'Undo', run: () => toast({ title: 'Undone.' }) } })}
              >Toast with an action</lc-button>
              <lc-button variant="quiet" @click=${() => toast({ title: 'Couldn’t save. Cellar didn’t answer.', variant: 'error' })}>Error toast</lc-button>
              <lc-button
                variant="quiet"
                @click=${() =>
                  void confirm({
                    title: 'Delete Paper Plane?',
                    message: 'It’s removed for everyone.',
                    confirmLabel: 'Delete recipe',
                    danger: true,
                  })}
              >Confirm</lc-button>
              <lc-button
                variant="quiet"
                @click=${() =>
                  void confirmTyped({
                    title: 'Replace everything with this backup?',
                    message: 'Everything added since then is lost, for every member.',
                    phrase: 'replace everything',
                    confirmLabel: 'Restore backup',
                  })}
              >Typed confirm</lc-button>
            </div>
            ${skeleton('rows', 'Recipes')}
            <cl-image-field purpose="recipe"></cl-image-field>
          </section>

          <section aria-labelledby="demo-screens">
            <h2 id="demo-screens">Launch screens</h2>
            ${ctxScreen(notFound)}
            <div class="cl-demo-offline">${offline()}</div>
          </section>
        </main>
        <lc-toast position="bottom-center"></lc-toast>
      `,
      root,
    );
  };
  draw();
}
