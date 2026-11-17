import { nativeAdPreviewError, nativeAdPreviewOutcome } from '../../decisions/nativeAdPreview';
import { t } from '../../localization/runtime';
import { currentBuild, isRuStoreBuild } from './updater';

interface PreviewBridge {
  show(request: { placement: 'main.supply'; requestId: string }): Promise<unknown>;
}

/** Sideload APK diagnostics, started only by an explicit tap on the main hub. */
export function initNativeAdPreview(): void {
  if (!currentBuild() || isRuStoreBuild() || document.body.dataset.entry === 'sector-zero') return;
  const native = (globalThis as { VoidRewardedAds?: PreviewBridge }).VoidRewardedAds;
  if (typeof native?.show !== 'function') return;
  const root = document.querySelector('#hp-home .home-main');
  if (!root || document.getElementById('hub-ad-preview')) return;

  const panel = document.createElement('section');
  panel.id = 'hub-ad-preview';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hub-mode';
  const title = document.createElement('b');
  title.dataset.i18n = 'hub.ad-preview.action';
  title.textContent = t('hub.ad-preview.action');
  const hint = document.createElement('span');
  hint.dataset.i18n = 'hub.ad-preview.hint';
  hint.textContent = t('hub.ad-preview.hint');
  button.append(title, hint);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  panel.append(button, status);
  root.prepend(panel);

  let busy = false;
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    status.hidden = false;
    status.textContent = t('hub.ad-preview.loading');
    try {
      const requestId = 'preview_' + crypto.randomUUID();
      const result = await native.show({ placement: 'main.supply', requestId });
      switch (nativeAdPreviewOutcome(result, requestId)) {
        case 'earned': status.textContent = t('hub.ad-preview.earned'); break;
        case 'cancelled': status.textContent = t('hub.ad-preview.cancelled'); break;
        case 'unavailable': {
          const issue = nativeAdPreviewError(result, requestId);
          status.textContent = t(issue.key, { code: issue.code });
          break;
        }
      }
    } catch {
      status.textContent = t('hub.ad-preview.error.app', { code: 'E_AD_CLIENT' });
    } finally {
      busy = false;
      button.disabled = false;
      panel.setAttribute('aria-busy', 'false');
    }
  });
}
