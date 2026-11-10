import type { ProfileCard } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { effect, signal } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { loadState } from '../../app/load.ts';
import { route } from '../../app/controllers/route.ts';
import { session } from '../../app/controllers/session.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource } from '../../app/resources.ts';
import { navigate } from '../../app/router.ts';
import '../../design-system/lc/avatar.ts';
import '../../design-system/lc/tile.ts';
import { loadFailed } from '../../design-system/load-view.ts';
import { armFirstArrival } from '../../design-system/motion.ts';
import { text } from '../../text/index.ts';
import { carriedQuery, nextPath } from './parts/handoff.ts';
import { arrivalNotice } from './parts/notices.ts';
import { stage } from './parts/stage.ts';
import './who.css';

export const tag = 'cl-screen-login-who';

class WhoScreen extends View {
  readonly profiles = apiResource('listProfiles', []);
  readonly state = loadState([this.profiles]);
  readonly choosing = signal(false);

  connected(): void {
    this.classList.add('cl-who');
    this.profiles.bind(this, {});
    const toSignIn = effect(() => {
      if (this.state.error.value?.code === 'login_required') {
        navigate(`/login${carriedQuery(route.query.peek())}`, { replace: true });
      }
    });
    this.$own(() => toSignIn.dispose());
  }

  private async choose(profile: ProfileCard): Promise<void> {
    if (this.choosing.peek()) {
      return;
    }
    this.choosing.value = true;
    try {
      await call('chooseProfile', { body: { memberId: profile.id } });
      await session.refresh();
      if (!this.isConnected) {
        return;
      }
      armFirstArrival();
      navigate(nextPath(route.query.peek()), { replace: true });
    } catch (error) {
      actionFailed(error, () => void this.choose(profile));
    } finally {
      this.choosing.value = false;
    }
  }

  render() {
    if (this.state.phase.value === 'failed') {
      return this.state.error.value?.code === 'login_required'
        ? nothing
        : stage(loadFailed(text('title.who'), () => this.state.retry(), 'refresh'));
    }
    const profiles = this.profiles.value.value?.profiles;
    if (profiles === undefined) {
      return nothing;
    }
    return stage(html`${arrivalNotice(route.query.value)}
      <h1 class="cl-who-title">${text('login.who.title')}</h1>
      <div class="cl-who-grid">
        ${profiles.map(
          (
            profile,
          ) => html`<lc-tile class="cl-who-tile" interactive label=${profile.name} @select=${() => void this.choose(profile)}>
            <lc-avatar shape="rounded" slot="media" size="xl" name=${profile.name} src=${profile.avatar?.url ?? nothing}></lc-avatar>
          </lc-tile>`,
        )}
      </div>
      <p class="cl-who-hint">${text('login.who.hint')}</p>`);
  }
}

View.register(tag, WhoScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: WhoScreen;
  }
}
