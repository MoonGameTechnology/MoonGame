/**
 * Вкладка хаба «Корпорация» (CORP-3): что показать вместо разделов и какие числа нести на
 * их ярлыках. Данные приходят с сервера (`/corps/me`, `/corps/:id`, `/ava/challenges`);
 * здесь только выбор.
 *
 * 1. **Без входа — приглашение войти,** и в сеть вкладка не ходит: корпорация хранится
 *    в аккаунте.
 * 2. **До первого ответа — загрузка,** а не «создайте корпорацию»: игрок в корпорации не
 *    должен даже мельком увидеть предложение основать вторую.
 * 3. **Чтение не удалось и ответа ещё не было — «нет связи» с кнопкой «Обновить».** Отказ
 *    сети не значит, что корпорации нет. Был ответ раньше — остаётся он.
 * 4. **Заявка (роль `recruit`) — карточка ожидания с отзывом:** базу и состав сервер
 *    заявке не показывает.
 * 5. **Ярлыки разделов:** у «Состава» — число заявок, их разбирают глава и офицеры; у
 *    «Битв» — входящие вызовы, на которые отвечает глава.
 */
import type { CorpMemberRole } from './corpMembers';

/** Что занимает вкладку: приглашение войти, загрузка, «нет связи», «без корпорации»,
 *  заявка или сама корпорация. */
export type CorpHubState = 'guest' | 'loading' | 'offline' | 'none' | 'pending' | 'corp';

/** Правила 1–4. `answered` — сервер хотя бы раз ответил на `/corps/me`, `failed` — не
 *  ответил на последний запрос, `role` — роль из последнего ответа. */
export function corpHubState(s: {
  signedIn: boolean;
  answered: boolean;
  failed: boolean;
  role: CorpMemberRole | null;
}): CorpHubState {
  if (!s.signedIn) return 'guest';
  if (!s.answered) return s.failed ? 'offline' : 'loading';
  if (!s.role) return 'none';
  return s.role === 'recruit' ? 'pending' : 'corp';
}

/** Числа на ярлыках разделов; 0 — ярлык без значка. */
export interface CorpHubBadges {
  members: number;
  battles: number;
}

/** Правило 5. */
export function corpHubBadges(
  me: { corpId: string; role: CorpMemberRole } | null,
  members: ReadonlyArray<{ role: CorpMemberRole }>,
  challenges: ReadonlyArray<{ status: string; targetCorp: string }>,
): CorpHubBadges {
  if (!me) return { members: 0, battles: 0 };
  const manager = me.role === 'head' || me.role === 'officer';
  return {
    members: manager ? members.filter((m) => m.role === 'recruit').length : 0,
    battles:
      me.role === 'head'
        ? challenges.filter((c) => c.status === 'pending' && c.targetCorp === me.corpId).length
        : 0,
  };
}
