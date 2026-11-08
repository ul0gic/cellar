import { IMAGE_ASPECT, IMAGE_PURPOSES, type ImagePurpose, LIMITS } from '@cellar/contract';
import { defineComponent } from '@lightstart/light';
import type { LightElements } from '@lightstart/light/components/elements.js';
import { registerFormFieldRenderer } from '@lightstart/light/components/form/field-renderers.js';
import { html } from '@lightstart/light/html';
import T from '@lightstart/light/types';
import { text } from '../text/index.ts';
import { thumbHashOf } from './thumbhash.ts';
import './cl-image-field.css';
import { typedDefault } from './typed-default.ts';

export interface ImageUpload {
  readonly file: Blob;
  readonly width: number;
  readonly height: number;
  readonly thumbhash: string;
  readonly purpose: ImagePurpose;
}

type CropElement = LightElements['lc-image-crop'];

export function outputSize(purpose: ImagePurpose): { width: number; height: number } {
  const [aspectWidth, aspectHeight] = IMAGE_ASPECT[purpose];
  const longSide = LIMITS.imageLongSide;
  return aspectWidth >= aspectHeight
    ? { width: longSide, height: Math.round((longSide * aspectHeight) / aspectWidth) }
    : { width: Math.round((longSide * aspectWidth) / aspectHeight), height: longSide };
}

const RECIPE = typedDefault<ImagePurpose>('recipe');
const NO_CHANGE: ((upload: ImageUpload) => void) | null = null;

export const clImageField = defineComponent({
  tag: 'cl-image-field',
  style: true,
  props: {
    purpose: RECIPE,
    ready: false,
    error: '',
    change: T.function({ defaultValue: NO_CHANGE, attribute: false }),
  },
  async _use() {
    const crop = this.querySelector<CropElement>('lc-image-crop');
    if (crop === null) {
      return;
    }
    const file = await crop.toBlob();
    if (file === null) {
      this.error = text('upload.tooLarge');
      return;
    }
    this.error = '';
    const size = outputSize(this.purpose);
    this.change?.({
      file,
      width: size.width,
      height: size.height,
      thumbhash: await thumbHashOf(file),
      purpose: this.purpose,
    });
  },
  render() {
    const [aspectWidth, aspectHeight] = IMAGE_ASPECT[this.purpose];
    const size = outputSize(this.purpose);
    const hint = text('crop.hint', {
      aspect: aspectWidth === aspectHeight ? text('crop.square') : text('crop.portrait'),
      side: aspectHeight > aspectWidth ? text('crop.tall') : text('crop.wide'),
    });
    return html`
      <lc-image-crop
        shape="square"
        aspect=${`${aspectWidth}:${aspectHeight}`}
        output-size=${size.width}
        output-type="image/webp"
        max-bytes=${LIMITS.imageUploadBytes}
        hint=${hint}
        @load=${() => {
          this.ready = true;
          this.error = '';
        }}
        @error=${() => {
          this.ready = false;
          this.error = text('upload.notPhoto');
        }}
      ></lc-image-crop>
      ${this.error ? html`<p part="cl-image-field-error" role="alert">${this.error}</p>` : ''}
      <lc-button variant="primary" ?disabled=${!this.ready} @click=${() => this._use()}>${text('crop.use')}</lc-button>
    `;
  },
});

export function registerImageField(): void {
  registerFormFieldRenderer('image', (field, _value, onChange, template) => {
    const purpose = IMAGE_PURPOSES.find((candidate) => candidate === field.purpose);
    if (purpose === undefined) {
      throw new Error(`The image field ${field.name} needs a purpose: ${IMAGE_PURPOSES.join(', ')}`);
    }
    return template`<cl-image-field
      purpose=${purpose}
      .change=${(upload: ImageUpload) => onChange(upload)}
    ></cl-image-field>`;
  });
}
