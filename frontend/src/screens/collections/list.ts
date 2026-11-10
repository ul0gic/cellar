import { type CollectionSummary, LIMITS } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { eventText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href, navigate } from '../../app/router.ts';
import { plateForGlass } from '../../design-system/cl-plate.ts';
import { illustration } from '../../design-system/illustration.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/empty-state.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/input.ts';
import { waiting } from '../../design-system/load-view.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { text } from '../../text/index.ts';
import { openSheet, type Sheet } from '../recipes/parts/sheet.ts';
import './collections.css';

export const tag = 'cl-screen-collections-list';

class CollectionsList extends View {
  readonly list = apiResource('listCollections', ['collections']);
  readonly state = loadState([this.list]);
  readonly name = signal('');
  readonly saving = signal(false);

  connected(): void {
    this.classList.add('cl-collections');
    this.list.bind(this, {});
  }

  async save(sheet: Sheet): Promise<void> {
    this.saving.value = true;
    try {
      const created = await call('createCollection', { body: { name: this.name.peek().trim(), description: '' } });
      dataChanged('collections');
      sheet.close();
      if (this.isConnected) {
        navigate(`/collections/${created.id}`);
      }
    } catch (error) {
      this.saving.value = false;
      actionFailed(error, () => void this.save(sheet));
    }
  }

  create(): void {
    this.name.value = '';
    this.saving.value = false;
    const sheet = openSheet(this, {
      heading: () => text('collections.newHeading'),
      body: () => html`<lc-input
        label=${text('collections.name')}
        maxlength=${LIMITS.shortName.max}
        value=${this.name.value}
        @input=${(event: Event) => {
          this.name.value = eventText(event);
        }}
      ></lc-input>`,
      footer: () => html`
        <lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" ?disabled=${this.saving.value || this.name.value.trim() === ''} @click=${() => void this.save(sheet)}
          >${text('collections.create')}</lc-button
        >
      `,
    });
  }

  card(collection: CollectionSummary): TemplateResult {
    return html`<li>
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
    </li>`;
  }

  render() {
    const data = this.list.value.value;
    const head = html`<header class="cl-collections-head">
      <h1 class="cl-collections-title">${text('nav.collections')}</h1>
      <lc-button variant="primary" @click=${() => this.create()}>
        <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('collections.new')}
      </lc-button>
    </header>`;
    if (data === undefined) {
      const view = waiting(this.state, text('nav.collections'), 'cards');
      return this.state.phase.value === 'failed' ? html`${head}${view}` : view;
    }
    return html`${head}
      ${
        data.collections.length === 0
          ? html`<lc-empty-state title=${text('collections.emptyTitle')} description=${text('collections.emptyBody')}>
              ${illustration('empty-glass')}
              <lc-button variant="primary" @click=${() => this.create()}>${text('collections.new')}</lc-button>
            </lc-empty-state>`
          : html`<ul class="cl-collections-grid">
              ${data.collections.map((collection) => this.card(collection))}
            </ul>`
      }`;
  }
}

View.register(tag, CollectionsList);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: CollectionsList;
  }
}
