import type { ImageRef } from '@cellar/contract';
import { defineComponent } from '@lightstart/light';
import { navigation } from '@lightstart/light/navigation';
import { html, nothing } from '@lightstart/light/html';
import type { HaveSegment } from './cl-have-bar.ts';
import { plateForGlass } from './cl-plate.ts';
import { ratingInline } from './cl-rating-inline.ts';
import { thumbHashDataUrl } from './thumbhash.ts';
import './cl-recipe-row.css';
import { typedDefault } from './typed-default.ts';

const NO_SEGMENTS = typedDefault<readonly HaveSegment[]>([]);
const NO_IMAGE = typedDefault<ImageRef | null>(null);
const NO_GLASS = typedDefault<string | null>(null);
const NO_RATING = typedDefault<number | null>(null);

export const clRecipeRow = defineComponent({
  tag: 'cl-recipe-row',
  style: true,
  props: {
    href: '',
    name: '',
    image: NO_IMAGE,
    glass: NO_GLASS,
    segments: NO_SEGMENTS,
    rating: NO_RATING,
  },
  render() {
    return html`
      <a part="cl-recipe-row-link" href=${navigation.href(this.href)}>
        ${
          this.image === null
            ? html`<cl-plate part="cl-recipe-row-thumb" small kind=${plateForGlass(this.glass)} name=${this.name}></cl-plate>`
            : html`<lc-image
                part="cl-recipe-row-thumb"
                src=${this.image.url}
                alt=""
                placeholder=${this.image.thumbhash === null ? nothing : thumbHashDataUrl(this.image.thumbhash)}
              ></lc-image>`
        }
        <span part="cl-recipe-row-content">
          <span part="cl-recipe-row-name">${this.name}</span>
          <cl-have-bar .segments=${this.segments}></cl-have-bar>
        </span>
        <span part="cl-recipe-row-end">${ratingInline(this.rating)}</span>
      </a>
    `;
  },
});
