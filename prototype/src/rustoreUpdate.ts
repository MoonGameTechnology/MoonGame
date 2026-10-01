/**
 * RUS-3 — обновление стор-сборки через SDK обновлений RuStore: проводка моста и баннера.
 *
 * Работает только в APK канала `rustore` (`buildChannel()`, `mobile/channel.mjs`): туда
 * упаковка ставит нативный мост `window.VoidRuStore` (`mobile/patch-rustore.mjs`) и не
 * ставит GitHub-полосу вовсе. Что показать и когда звать мост, решает
 * `decisions/storeUpdate.ts`; здесь только провода: три вызова туда, поток событий
 * `void-rustore` обратно, баннер `#updbar`.
 *
 * Чего здесь нет, и это не забывчивость. **Проверки по таймеру** — расписание общее с
 * GitHub-полосой и живёт в `apkUpdate.ts`. **Текста ошибок** — сбой SDK для игрока
 * означает «обновления нет», а подробности остаются в логе устройства: моста без
 * магазина на телефоне ровно столько же, сколько поставленных не из магазина сборок.
 */
import { t } from '../../localization/runtime';
import {
  initialStoreUpdate,
  parseStoreUpdateEvent,
  storeUpdateBanner,
  storeUpdateEvent,
  storeUpdateIntent,
  type StoreUpdateCall,
  type StoreUpdateIntent,
  type StoreUpdateOp,
} from '../../decisions/storeUpdate';

/** Мост, который кладёт нативная сторона. Своё описание, а не зависимость. */
interface RuStoreBridge {
  checkUpdate?: () => void;
  startUpdate?: () => void;
  completeUpdate?: () => void;
}

/** Событие, которым мост отвечает (`CustomEvent.detail` — см. `patch-rustore.mjs`). */
export const RUSTORE_EVENT = 'void-rustore';

const OP_OF: Record<StoreUpdateCall, StoreUpdateOp> = {
  checkUpdate: 'check',
  startUpdate: 'start',
  completeUpdate: 'complete',
};

export interface RuStoreUpdateOptions {
  /** Сохранить всё ДО перезапуска: установка закрывает приложение. */
  beforeRestart?: () => void;
}

const el = (id: string): HTMLElement | null => document.getElementById(id);

/** Подпись узла по ключу — и в атрибуте, чтобы повторная локализация её не вернула. */
function label(node: Element | null, key: string): void {
  if (!node) return;
  node.setAttribute('data-i18n', key);
  node.textContent = t(key);
}

/**
 * Повесить проводку. Нет моста — `null`, и это не ошибка: сборка канала `rustore` без
 * моста просто живёт без обновлений из игры (стор обновит её сам), а GitHub-полоса в
 * этом канале выключена в любом случае.
 */
export function initRuStoreUpdate(options: RuStoreUpdateOptions = {}): { check(): void } | null {
  const bridge = (globalThis as { VoidRuStore?: RuStoreBridge }).VoidRuStore;
  if (!bridge || typeof bridge !== 'object') return null;
  let state = initialStoreUpdate;

  const render = (): void => {
    const bar = el('updbar');
    if (!bar) return;
    const banner = storeUpdateBanner(state);
    if (!banner) {
      bar.style.display = 'none';
      return;
    }
    const titleKey = banner === 'offer' ? 'upd.available' : 'upd.ready';
    const actionKey = banner === 'offer' ? 'upd.go' : 'upd.restart';
    label(bar.querySelector('.ub-t span'), titleKey);
    label(el('ub-go'), actionKey);
    const ver = el('ub-ver');
    if (ver) ver.textContent = '';
    bar.style.display = 'block'; // перебить display:none из стилей
  };

  const fail = (op: StoreUpdateOp): void => {
    state = storeUpdateEvent(state, { type: 'error', op });
  };

  const intent = (i: StoreUpdateIntent): void => {
    const step = storeUpdateIntent(state, i);
    state = step.state;
    const call = step.call;
    if (call === 'completeUpdate') {
      // Не сохранилось — не перезапускаем: скачанное подождёт, прогресс важнее.
      try {
        options.beforeRestart?.();
      } catch (error) {
        console.error('E_STORE_UPDATE_SAVE', error);
        fail('complete');
        render();
        return;
      }
    }
    if (call) {
      try {
        // Вызов МЕТОДОМ моста: оторванная от объекта функция Java-моста не вызывается.
        bridge[call]?.();
      } catch (error) {
        console.error('E_STORE_UPDATE_BRIDGE', call, error);
        fail(OP_OF[call]);
      }
    }
    render();
  };

  window.addEventListener(RUSTORE_EVENT, (e) => {
    const event = parseStoreUpdateEvent((e as CustomEvent<unknown>).detail);
    if (!event) return;
    state = storeUpdateEvent(state, event);
    render();
  });
  el('ub-go')?.addEventListener('click', (e) => {
    e.preventDefault();
    intent(state.phase === 'ready' ? 'restart' : 'start');
  });
  el('ub-later')?.addEventListener('click', () => intent('later'));

  return { check: () => intent('check') };
}
