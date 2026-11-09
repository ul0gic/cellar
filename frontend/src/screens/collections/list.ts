import { LIMITS } from '@cellar/contract';
import { html, nothing, render } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import type { ScreenContext } from '../../app/types.ts';
import { plateForGlass } from '../../design-system/cl-plate.ts';
import { illustration } from '../../design-system/illustration.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { text } from '../../text/index.ts';
import { eventText } from '../recipes/parts/events.ts';
import { actionFailed } from '../recipes/parts/failures.ts';
import { openSheet } from '../recipes/parts/sheet.ts';
import { errorOf, onLeave, reload, slowFlag, watch } from '../recipes/parts/view.ts';
import './collections.css';

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-collections';
  const list = resourceFor('listCollections', {}, { tags: ['collections'] });
  const slow = slowFlag(() => draw());

  const create = (): void => {
    let name = '';
    let saving = false;
    const save = async (): Promise<void> => {
      saving = true;
      sheet.redraw();
      try {
        const created = await call('createCollection', { body: { name: name.trim(), description: '' } });
        invalidate('collections');
        sheet.close();
        ctx.navigate(`/collections/${created.id}`);
      } catch (error) {
        saving = false;
        sheet.redraw();
        actionFailed(error, () => void save());
      }
    };
    const sheet = openSheet({
      heading: () => text('collections.newHeading'),
      body: () => html`<lc-input
        label=${text('collections.name')}
        maxlength=${LIMITS.shortName.max}
        value=${name}
        @input=${(event: Event) => {
          name = eventText(event);
          sheet.redraw();
        }}
      ></lc-input>`,
      footer: () => html`
        <lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" ?disabled=${saving || name.trim() === ''} @click=${() => void save()}
          >${text('collections.create')}</lc-button
        >
      `,
    });
  };

  const draw = (): void => {
    const data = list.peek();
    const problem = errorOf(list);
    const head = html`<header class="cl-collections-head">
      <h1 class="cl-collections-title">${text('nav.collections')}</h1>
      <lc-button variant="primary" @click=${create}>
        <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('collections.new')}
      </lc-button>
    </header>`;
    if (data === undefined) {
      if (problem !== null) {
        render(
          html`${head}<lc-empty-state title=${text('loadFailed.title', { screen: text('nav.collections') })} description=${text('loadFailed.body')}>
            ${illustration('empty-lost')}
            <lc-button variant="primary" @click=${() => reload(list)}>${text('loadFailed.retry')}</lc-button>
          </lc-empty-state>`,
          element,
        );
      } else if (slow.slow() && element.querySelector('.cl-skeleton') === null) {
        element.replaceChildren(skeleton('cards', text('nav.collections')));
      }
      return;
    }
    slow.cancel();
    element.querySelector('.cl-skeleton')?.remove();
    render(
      html`${head}
        ${
          data.collections.length === 0
            ? html`<lc-empty-state title=${text('collections.emptyTitle')} description=${text('collections.emptyBody')}>
                ${illustration('empty-glass')}
                <lc-button variant="primary" @click=${create}>${text('collections.new')}</lc-button>
              </lc-empty-state>`
            : html`<ul class="cl-collections-grid">
                ${data.collections.map(
                  (collection) => html`<li>
                    <a class="cl-collection-card" href=${href(`/collections/${collection.id}`)}>
                      <span class="cl-collection-media">
                        ${
                          collection.cover === null
                            ? html`<cl-plate kind=${plateForGlass(null)} name=${collection.name}></cl-plate>`
                            : html`<lc-image
                                src=${collection.cover.url}
                                alt=""
                                placeholder=${collection.cover.thumbhash === null ? nothing : thumbHashDataUrl(collection.cover.thumbhash)}
                              ></lc-image>`
                        }
                      </span>
                      <span class="cl-collection-name">${collection.name}</span>
                      <span class="cl-collection-meta">
                        ${text(collection.recipeCount === 1 ? 'collections.countOne' : 'collections.count', { count: collection.recipeCount })}
                        ${collection.createdBy === null ? '' : text('collections.by', { name: collection.createdBy.name })}
                      </span>
                    </a>
                  </li>`,
                )}
              </ul>`
        }`,
      element,
    );
  };

  const stop = watch(list, draw);
  onLeave(element, () => {
    slow.cancel();
    stop();
  });
  return element;
}
