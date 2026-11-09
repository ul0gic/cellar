import type { ProfileCard } from '@cellar/contract';
import { html, nothing, render } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import type { ScreenContext } from '../../app/types.ts';
import { armFirstArrival } from '../../design-system/motion.ts';
import { text } from '../../text/index.ts';
import { actionFailed } from '../settings/parts/problems.ts';
import { loadFailed } from '../settings/parts/watch.ts';
import { carriedQuery, nextPath } from './parts/handoff.ts';
import { arrivalNotice } from './parts/notices.ts';
import { stage } from './parts/stage.ts';
import './who.css';

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-who';
  let profiles: readonly ProfileCard[] | null = null;
  let choosing = false;

  const choose = async (profile: ProfileCard): Promise<void> => {
    if (choosing) {
      return;
    }
    choosing = true;
    try {
      await call('chooseProfile', { body: { memberId: profile.id } });
      await ctx.person.refresh();
      armFirstArrival();
      ctx.navigate(nextPath(ctx.query), { replace: true });
    } catch (error) {
      actionFailed(error, () => void choose(profile));
    } finally {
      choosing = false;
    }
  };

  const draw = (): void => {
    if (profiles === null) {
      return;
    }
    render(
      stage(html`${arrivalNotice(ctx.query)}
        <h1 class="cl-who-title">${text('login.who.title')}</h1>
        <div class="cl-who-grid">
          ${profiles.map(
            (
              profile,
              index,
            ) => html`<lc-tile class="cl-who-tile" interactive label=${profile.name} @select=${() => void choose(profile)}>
              <lc-avatar slot="media" size="xl" seed=${String(index + 1)} name=${profile.name} src=${profile.avatar?.url ?? nothing}></lc-avatar>
            </lc-tile>`,
          )}
        </div>
        <p class="cl-who-hint">${text('login.who.hint')}</p>`),
      element,
    );
  };

  const load = async (): Promise<void> => {
    try {
      profiles = (await call('listProfiles', {})).profiles;
      draw();
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (error.code === 'login_required') {
        ctx.navigate(`/login${carriedQuery(ctx.query)}`, { replace: true });
        return;
      }
      render(stage(loadFailed(text('title.who'), () => void load())), element);
    }
  };

  void load();
  return element;
}
