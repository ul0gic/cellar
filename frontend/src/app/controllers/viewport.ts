import { Controller } from '@lightstart/light/controller/class';
import { signal } from '@lightstart/light/signals';

const WIDE_QUERY = '(min-width: 1024px)';

export class ViewportController extends Controller {
  readonly wide = signal(false);

  constructor() {
    super('viewport');
  }

  override connected(): Promise<void> | null {
    const media = matchMedia(WIDE_QUERY);
    const follow = (): void => {
      this.wide.value = media.matches;
    };
    follow();
    media.addEventListener('change', follow);
    this.$own(() => media.removeEventListener('change', follow));
    return null;
  }
}

export const viewport = new ViewportController();
await viewport.start();
