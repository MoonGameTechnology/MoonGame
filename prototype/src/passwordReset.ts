/**
 * Сброс пароля — трата присланной по почте ссылки «?reset=<token>» (REFM-19).
 *
 * Сцену открывает загрузочный deep-link. Успешный сброс СРАЗУ логинит: сервер отдаёт
 * сессию в ответе, поэтому игрок уезжает в хаб, не вводя пароль второй раз.
 *
 * Токен в ссылке — живая 15-минутная возможность угона аккаунта, поэтому первым делом
 * он вычищается из адресной строки и истории (`stripResetParam`): иначе он утекает в
 * referer, остаётся в кнопке «назад» и в синхронизации истории между устройствами.
 *
 * Сеть и сессии остались у хоста (адрес сервера, ключ сессии, переключение экранов —
 * его хозяйство). Модуль владеет тем, что можно проверить без браузера: правилами
 * пароля, чисткой ссылки и разбором ответа сервера.
 */
import { t } from '../../localization/runtime';

/** Минимальная длина нового пароля — то же правило, что показывает подсказка. */
export const MIN_PASSWORD = 8;

/** Куда вернуть фокус, если новый пароль не принят. */
export type PassField = 'pass' | 'pass2';

/** Проверка нового пароля ДО обращения к серверу: короткий — отказ, несовпадение
 *  повтора — отказ. Возвращает ключ сообщения и поле, куда ставить курсор. */
export function validateNewPassword(
  pass: string,
  repeat: string,
): { ok: true } | { ok: false; key: string; focus: PassField } {
  if (pass.length < MIN_PASSWORD) return { ok: false, key: 'acc.pass.rule', focus: 'pass' };
  if (pass !== repeat) return { ok: false, key: 'auth.pass-mismatch', focus: 'pass2' };
  return { ok: true };
}

/** Убрать `reset=<token>` из ссылки, оставив всё остальное нетронутым. Токен не должен
 *  пережить открытие страницы: он утекает через referer, историю и чужой взгляд.
 *  Непарсимый адрес возвращается как есть — чистить нечего, падать тем более незачем. */
export function stripResetParam(href: string): string {
  try {
    const url = new URL(href);
    if (!url.searchParams.has('reset')) return href;
    url.searchParams.delete('reset');
    return url.pathname + url.search + url.hash;
  } catch {
    return href;
  }
}

/** Ответ сервера на сброс. Fail-secure: успех только когда пришли ОБА поля — сессия
 *  без логина (или наоборот) не считается входом, как бы ни выглядел HTTP-статус. */
export function parseResetOutcome(
  ok: boolean,
  body: unknown,
): { ok: true; login: string; token: string } | { ok: false } {
  if (!ok || typeof body !== 'object' || body === null) return { ok: false };
  const { login, token } = body as { login?: unknown; token?: unknown };
  if (typeof login !== 'string' || !login || typeof token !== 'string' || !token) {
    return { ok: false };
  }
  return { ok: true, login, token };
}

/** Что сцена сброса берёт у экрана входа. */
export interface PasswordResetHost {
  /** Поля нового пароля и его повтора. */
  fields(): { pass: HTMLInputElement; pass2: HTMLInputElement };
  /** Строка статуса под формой. */
  status(msg: string): void;
  /** Идёт ли уже вход — общий на весь экран замок от двойной отправки. */
  busy(): boolean;
  setBusy(v: boolean): void;
  /** `POST /auth/reset`. Сеть у хоста: он владеет адресом сервера. `null` — не дошло. */
  submit(token: string, password: string): Promise<{ ok: boolean; body: unknown } | null>;
  /** Сохранить выданную сессию и уехать в хаб — сброс И ЕСТЬ вход. */
  onSuccess(login: string, token: string): void;
  /** Показать сцену: переключение экранов и подсказка менеджеру паролей, к какому
   *  аккаунту относится новый пароль, — хозяйство хоста. */
  showStage(): void;
}

/** Собрать сцену. `open(token)` зовёт загрузочный deep-link. */
export function initPasswordReset(host: PasswordResetHost): {
  open: (token: string, href: string) => string;
  submit: () => Promise<void>;
} {
  let resetToken = ''; // токен из ссылки — живёт только до успешной траты

  const clearFields = (): void => {
    const { pass, pass2 } = host.fields();
    pass.value = '';
    pass2.value = '';
  };

  async function submit(): Promise<void> {
    const { pass, pass2 } = host.fields();
    const verdict = validateNewPassword(pass.value, pass2.value);
    if (!verdict.ok) {
      host.status(t(verdict.key));
      (verdict.focus === 'pass' ? pass : pass2).focus();
      return;
    }
    if (host.busy()) return;
    host.setBusy(true);
    try {
      const res = await host.submit(resetToken, pass.value);
      const outcome = res ? parseResetOutcome(res.ok, res.body) : { ok: false as const };
      if (!outcome.ok) {
        host.status(t('auth.reset.bad-link'));
        return;
      }
      resetToken = ''; // ссылка потрачена
      clearFields();
      host.status('');
      host.onSuccess(outcome.login, outcome.token);
    } finally {
      host.setBusy(false);
    }
  }

  return {
    /** Принять deep-link: запомнить токен, вернуть ОЧИЩЕННЫЙ адрес (хост подменит им
     *  строку браузера) и подготовить форму. */
    open: (token: string, href: string): string => {
      resetToken = token;
      const cleaned = stripResetParam(href);
      host.showStage();
      const { pass, pass2 } = host.fields();
      pass.value = '';
      pass2.value = '';
      host.status('');
      pass.focus();
      return cleaned;
    },
    submit,
  };
}
