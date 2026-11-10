import { Controller } from '@lightstart/light/controller/class';
import { computed } from '@lightstart/light/signals';
import { apiResource } from '../resources.ts';

export class ShellController extends Controller {
  private readonly shopping = apiResource('getShoppingList', ['shopping']);
  private readonly menus = apiResource('listMenus', ['menus']);

  readonly shoppingCount = computed(() => this.shopping.value.value?.items.length ?? 0);
  readonly menuLive = computed(() => this.menus.value.value?.items.some((menu) => menu.live) ?? false);

  constructor() {
    super('shell');
  }

  follow(): void {
    this.shopping.bind(this, {});
    this.menus.bind(this, { query: { pageSize: 1 } });
  }
}

export const shell = new ShellController();
await shell.start();
