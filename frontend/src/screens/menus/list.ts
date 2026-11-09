import { LIMITS, type MenuSummary } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { type LoadState, watch } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import { today } from '../../app/today.ts';
import type { ScreenContext } from '../../app/types.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { illustration } from '../../design-system/illustration.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { toast } from '../../design-system/toast.ts';
import { formatDate } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import './list.css';

type Dropdown = LightElements['lc-dropdown'];

function drinks(count: number): string {
  return count === 1 ? text('menus.drink') : text('menus.drinks', { count });
}

function copyName(name: string): string {
  return text('menus.copyName', { name }).slice(0, LIMITS.shortName.max);
}

export function screen(ctx: ScreenContext): HTMLElement {
  setAppBar({});
  const element = document.createElement('section');
  element.className = 'cl-menus cl-reading';
  const menus = resourceFor('listMenus', { query: { pageSize: LIMITS.pageSize.max } }, { tags: ['menus'] });

  const create = async (): Promise<void> => {
    try {
      const menu = await call('createMenu', { body: { name: text('menus.newName'), date: today(), sections: [] } });
      invalidate('menus');
      ctx.navigate(`/menus/${menu.id}`);
    } catch (error) {
      actionFailed(error, () => void create());
    }
  };

  const copy = async (menu: MenuSummary): Promise<void> => {
    try {
      const copied = await call('copyMenu', {
        params: { id: menu.id },
        body: { name: copyName(menu.name), date: today() },
      });
      invalidate('menus');
      toast({ title: text('menus.copied', { name: menu.name }) });
      ctx.navigate(`/menus/${copied.id}`);
    } catch (error) {
      actionFailed(error, () => void copy(menu));
    }
  };

  const remove = async (menu: MenuSummary): Promise<void> => {
    const sure = await confirm({
      title: text('menus.deleteTitle', { name: menu.name }),
      message: text('menus.deleteBody'),
      confirmLabel: text('menus.deleteConfirm'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    try {
      await call('deleteMenu', { params: { id: menu.id } });
      invalidate('menus');
      toast({ title: text('menus.deleted', { name: menu.name }) });
    } catch (error) {
      actionFailed(error, () => void remove(menu));
    }
  };

  const openMore = (event: MouseEvent): void => {
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement)) {
      return;
    }
    trigger.parentElement?.querySelector<Dropdown>('lc-dropdown')?.toggle(trigger);
  };

  const row = (menu: MenuSummary): TemplateResult => {
    const ended = menu.endedAt !== null;
    const line = text(ended ? 'menus.rowEnded' : 'menus.rowDraft', {
      date: formatDate(menu.date),
      drinks: drinks(menu.itemCount),
    });
    const items = [
      { label: text('menus.edit'), icon: 'pencil', onClick: () => ctx.navigate(`/menus/${menu.id}`) },
      { label: text('menus.copy'), icon: 'copy', onClick: () => void copy(menu) },
      { label: text('menus.delete'), icon: 'trash-2', danger: true, onClick: () => void remove(menu) },
    ];
    return html`<li class="cl-menus-row">
      <a class="cl-menus-row-text" href=${href(`/menus/${menu.id}`)}>
        <span class="cl-menus-row-name">${menu.name}</span>
        <span class="cl-menus-row-line">${line}</span>
      </a>
      ${
        ended
          ? html`<lc-button ghost @click=${() => void copy(menu)}>${text('menus.copy')}</lc-button>`
          : html`<lc-button ghost href=${href(`/menus/${menu.id}`)}>${text('menus.edit')}</lc-button>`
      }
      <lc-button ghost icon-only aria-haspopup="menu" aria-label=${text('menus.more', { name: menu.name })} @click=${openMore}>
        <lc-icon name="ellipsis" aria-hidden="true"></lc-icon>
      </lc-button>
      <lc-dropdown .items=${items}></lc-dropdown>
    </li>`;
  };

  const body = (load: LoadState, page: { items: readonly MenuSummary[] } | undefined): TemplateResult => {
    if (load.phase === 'failed') {
      return html`<lc-empty-state
        title=${text('loadFailed.title', { screen: text('menus.title') })}
        description=${text('loadFailed.body')}
      >
        ${illustration('empty-lost')}
        <lc-button variant="primary" @click=${() => load.retry()}>${text('loadFailed.retry')}</lc-button>
      </lc-empty-state>`;
    }
    if (page === undefined) {
      return html``;
    }
    if (page.items.length === 0) {
      return html`<lc-empty-state title=${text('menus.emptyTitle')} description=${text('menus.emptyBody')}>
        ${illustration('empty-menu')}
        <lc-button variant="primary" @click=${() => void create()}>
          <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('menus.new')}
        </lc-button>
      </lc-empty-state>`;
    }
    const live = page.items.find((menu) => menu.live);
    const rest = page.items.filter((menu) => !menu.live);
    return html`
      ${live === undefined ? nothing : html`<cl-live-card name=${live.name} drinks=${live.itemCount} href=${`/menus/${live.id}`}></cl-live-card>`}
      ${
        rest.length === 0
          ? nothing
          : html`<h2 class="cl-menus-heading">${text('menus.past')}</h2>
            <ul class="cl-menus-list">${rest.map(row)}</ul>`
      }
    `;
  };

  const draw = (load: LoadState, page: { items: readonly MenuSummary[] } | undefined): void => {
    const empty = load.phase !== 'failed' && page !== undefined && page.items.length === 0;
    render(
      html`
        <header class="cl-menus-head">
          <h1 class="cl-menus-title">${text('menus.title')}</h1>
          ${
            empty || load.phase === 'failed'
              ? nothing
              : html`<lc-button variant="primary" @click=${() => void create()}>
                <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('menus.new')}
              </lc-button>`
          }
        </header>
        ${load.phase === 'slow' && page === undefined ? skeleton('rows', text('menus.title')) : body(load, page)}
      `,
      element,
    );
  };

  watch(element, [menus], (load) => draw(load, menus.peek()));
  return element;
}
