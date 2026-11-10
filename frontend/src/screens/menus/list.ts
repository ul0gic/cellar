import { LIMITS, type MenuSummary } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href, navigate } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import { today } from '../../app/today.ts';
import '../../design-system/cl-live-card.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { illustration } from '../../design-system/illustration.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/dropdown.ts';
import '../../design-system/lc/empty-state.ts';
import '../../design-system/lc/icon.ts';
import { waiting } from '../../design-system/load-view.ts';
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

function openMore(event: MouseEvent): void {
  const trigger = event.currentTarget;
  if (!(trigger instanceof HTMLElement)) {
    return;
  }
  trigger.parentElement?.querySelector<Dropdown>('lc-dropdown')?.toggle(trigger);
}

export const tag = 'cl-screen-menus-list';

class MenusList extends View {
  readonly menus = apiResource('listMenus', ['menus']);
  readonly state = loadState([this.menus]);

  connected(): void {
    setAppBar({});
    this.classList.add('cl-menus', 'cl-reading');
    this.menus.bind(this, { query: { pageSize: LIMITS.pageSize.max } });
  }

  async create(): Promise<void> {
    try {
      const menu = await call('createMenu', { body: { name: text('menus.newName'), date: today(), sections: [] } });
      dataChanged('menus');
      if (this.isConnected) {
        navigate(`/menus/${menu.id}`);
      }
    } catch (error) {
      actionFailed(error, () => void this.create());
    }
  }

  async copy(menu: MenuSummary): Promise<void> {
    try {
      const copied = await call('copyMenu', {
        params: { id: menu.id },
        body: { name: copyName(menu.name), date: today() },
      });
      dataChanged('menus');
      toast({ title: text('menus.copied', { name: menu.name }) });
      if (this.isConnected) {
        navigate(`/menus/${copied.id}`);
      }
    } catch (error) {
      actionFailed(error, () => void this.copy(menu));
    }
  }

  async deleteMenu(menu: MenuSummary): Promise<void> {
    const sure = await confirm(this, {
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
      dataChanged('menus');
      toast({ title: text('menus.deleted', { name: menu.name }) });
    } catch (error) {
      actionFailed(error, () => void this.deleteMenu(menu));
    }
  }

  row(menu: MenuSummary): TemplateResult {
    const ended = menu.endedAt !== null;
    const line = text(ended ? 'menus.rowEnded' : 'menus.rowDraft', {
      date: formatDate(menu.date),
      drinks: drinks(menu.itemCount),
    });
    const items = [
      { label: text('menus.edit'), icon: 'pencil', onClick: () => navigate(`/menus/${menu.id}`) },
      { label: text('menus.copy'), icon: 'copy', onClick: () => void this.copy(menu) },
      { label: text('menus.delete'), icon: 'trash-2', danger: true, onClick: () => void this.deleteMenu(menu) },
    ];
    return html`<li class="cl-menus-row">
      <a class="cl-menus-row-text" href=${href(`/menus/${menu.id}`)}>
        <span class="cl-menus-row-name">${menu.name}</span>
        <span class="cl-menus-row-line">${line}</span>
      </a>
      ${
        ended
          ? html`<lc-button ghost @click=${() => void this.copy(menu)}>${text('menus.copy')}</lc-button>`
          : html`<lc-button ghost href=${href(`/menus/${menu.id}`)}>${text('menus.edit')}</lc-button>`
      }
      <lc-button ghost icon-only aria-haspopup="menu" aria-label=${text('menus.more', { name: menu.name })} @click=${openMore}>
        <lc-icon name="ellipsis" aria-hidden="true"></lc-icon>
      </lc-button>
      <lc-dropdown .items=${items}></lc-dropdown>
    </li>`;
  }

  content(page: { items: readonly MenuSummary[] }): TemplateResult {
    if (page.items.length === 0) {
      return html`<lc-empty-state title=${text('menus.emptyTitle')} description=${text('menus.emptyBody')}>
        ${illustration('empty-menu')}
        <lc-button variant="primary" @click=${() => void this.create()}>
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
            <ul class="cl-menus-list">${rest.map((menu) => this.row(menu))}</ul>`
      }
    `;
  }

  render() {
    const page = this.menus.value.value;
    const shown = waiting(this.state, text('menus.title'), 'rows');
    const failed = this.state.phase.value === 'failed';
    return html`
      <header class="cl-menus-head">
        <h1 class="cl-menus-title">${text('menus.title')}</h1>
        ${
          failed || page?.items.length === 0
            ? nothing
            : html`<lc-button variant="primary" @click=${() => void this.create()}>
              <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('menus.new')}
            </lc-button>`
        }
      </header>
      ${shown ?? (page === undefined ? nothing : this.content(page))}
    `;
  }
}

View.register(tag, MenusList);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: MenusList;
  }
}
