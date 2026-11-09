import type { ImageRef } from '@cellar/contract';
import { defineComponent } from '@lightstart/light';
import { navigation } from '@lightstart/light/navigation';
import { html, nothing } from '@lightstart/light/html';
import T from '@lightstart/light/types';
import { text } from '../text/index.ts';
import type { HaveSegment } from './cl-have-bar.ts';
import { plateForGlass } from './cl-plate.ts';
import { ratingInline } from './cl-rating-inline.ts';
import { thumbHashDataUrl } from './thumbhash.ts';
import './cl-recipe-card.css';
import { typedDefault } from './typed-default.ts';

const NO_SEGMENTS = typedDefault<readonly HaveSegment[]>([]);
const NO_IMAGE = typedDefault<ImageRef | null>(null);
const NO_GLASS = typedDefault<string | null>(null);
const NO_NUMBER = typedDefault<number | null>(null);

export const clRecipeCard = defineComponent({
  tag: 'cl-recipe-card',
  style: true,
  props: {
    href: '',
    name: '',
    summary: '',
    image: NO_IMAGE,
    glass: NO_GLASS,
    segments: NO_SEGMENTS,
    rating: NO_NUMBER,
    madeCount: NO_NUMBER,
    favorite: false,
  },
  events: {
    'favorite-toggle': T.object(),
  },
  _toggleFavorite() {
    this.$emit('favorite-toggle', { favorite: !this.favorite });
  },
  _favoriteButton(placement: 'photo' | 'meta') {
    return html`<button
      type="button"
      part=${`cl-recipe-card-favorite cl-recipe-card-favorite-${placement}`}
      aria-pressed=${this.favorite ? 'true' : 'false'}
      aria-label=${text('card.favorite', { name: this.name })}
      @click=${() => this._toggleFavorite()}
    ><lc-icon name="heart" ?solid=${this.favorite} aria-hidden="true"></lc-icon></button>`;
  },
  render() {
    const made =
      this.madeCount === null
        ? ''
        : this.madeCount === 1
          ? text('card.madeOnce')
          : text('card.madeTimes', { count: this.madeCount });
    return html`
      <a part="cl-recipe-card-link" href=${navigation.href(this.href)}>
        <span part="cl-recipe-card-media">
          ${
            this.image === null
              ? html`<cl-plate part="cl-recipe-card-photo" kind=${plateForGlass(this.glass)} name=${this.name}></cl-plate>`
              : html`<lc-image
                part="cl-recipe-card-photo"
                src=${this.image.url}
                alt=""
                placeholder=${this.image.thumbhash === null ? nothing : thumbHashDataUrl(this.image.thumbhash)}
              ></lc-image>`
          }
          <cl-status-pill part="cl-recipe-card-pill" .segments=${this.segments}></cl-status-pill>
        </span>
        <span part="cl-recipe-card-body">
          <span part="cl-recipe-card-name">${this.name}</span>
          <span part="cl-recipe-card-summary">${this.summary}</span>
          <span part="cl-recipe-card-meta">
            ${ratingInline(this.rating)}
            ${made ? html`<span part="cl-recipe-card-made">${made}</span>` : ''}
          </span>
        </span>
      </a>
      ${this._favoriteButton('photo')} ${this._favoriteButton('meta')}
    `;
  },
});
