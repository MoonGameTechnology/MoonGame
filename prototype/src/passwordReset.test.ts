import { describe, it, expect, beforeAll } from 'vitest';
import { t, setLocale } from '../../localization/runtime';
import {
  validateNewPassword,
  stripResetParam,
  parseResetOutcome,
  initPasswordReset,
  MIN_PASSWORD,
  type PasswordResetHost,
} from './passwordReset';

// REFM-19: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

/** Поле ввода без DOM: значение + счётчик фокусов — всё, чем пользуется сцена. */
function field(value = ''): HTMLInputElement & { focused: () => number } {
  let focused = 0;
  const handlers = new Map<string, EventListener>();
  const el = {
    value,
    ariaInvalid: null,
    addEventListener: (type: string, handler: EventListener) => handlers.set(type, handler),
    dispatchEvent: (event: Event) => { handlers.get(event.type)?.(event); return true; },
    focus: () => {
      focused++;
    },
    focused: () => focused,
  };
  return el as unknown as HTMLInputElement & { focused: () => number };
}

function wired(
  over: Partial<PasswordResetHost> = {},
  reply: { ok: boolean; body: unknown } | null = { ok: true, body: { login: 'ник', token: 'сес' } },
) {
  const pass = field();
  const pass2 = field();
  const status: string[] = [];
  const success: Array<[string, string]> = [];
  const sent: Array<[string, string]> = [];
  let busy = false;
  let stages = 0;
  const api = initPasswordReset({
    fields: () => ({ pass, pass2 }),
    status: (m) => status.push(m),
    busy: () => busy,
    setBusy: (v) => {
      busy = v;
    },
    submit: async (token, password) => {
      sent.push([token, password]);
      return reply;
    },
    onSuccess: (login, token) => success.push([login, token]),
    showStage: () => {
      stages++;
    },
    ...over,
  });
  return {
    api,
    pass,
    pass2,
    status,
    success,
    sent,
    stages: () => stages,
    isBusy: () => busy,
  };
}

describe('сброс пароля — правила нового пароля', () => {
  it('слишком короткий отклоняется, курсор — в первое поле', () => {
    const v = validateNewPassword('x'.repeat(MIN_PASSWORD - 1), 'x'.repeat(MIN_PASSWORD - 1));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.focus).toBe('pass');
  });

  it('ровно минимальная длина уже годится — граница включительная', () => {
    const p = 'orbit-signal'.slice(0, MIN_PASSWORD);
    expect(validateNewPassword(p, p).ok).toBe(true);
  });

  it('несовпадение повтора отклоняется, курсор — во ВТОРОЕ поле', () => {
    const v = validateNewPassword('длинный-пароль', 'другой-пароль');
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.focus).toBe('pass2');
      expect(v.key).toBe('auth.pass-mismatch');
    }
  });

  it('короткий И несовпадающий — сначала жалоба на длину', () => {
    const v = validateNewPassword('abc', 'xyz');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.key).toBe('acc.pass.rule');
  });
});

describe('сброс пароля — чистка ссылки от токена (угон аккаунта)', () => {
  it('токен вырезается из адреса', () => {
    const cleaned = stripResetParam('https://void.example/game?reset=СЕКРЕТ');
    expect(cleaned).not.toContain('СЕКРЕТ');
    expect(cleaned).not.toContain('reset');
  });

  it('соседние параметры переживают чистку', () => {
    const cleaned = stripResetParam('https://void.example/g?join=m1&reset=СЕКРЕТ&lang=ru');
    expect(cleaned).toContain('join=m1');
    expect(cleaned).toContain('lang=ru');
    expect(cleaned).not.toContain('СЕКРЕТ');
  });

  it('якорь и путь не теряются', () => {
    const cleaned = stripResetParam('https://void.example/game/hub?reset=СЕКРЕТ#tab');
    expect(cleaned).toContain('/game/hub');
    expect(cleaned).toContain('#tab');
    expect(cleaned).not.toContain('СЕКРЕТ');
  });

  it('не-ASCII путь переживает чистку (в процентном виде — так его пишет браузер)', () => {
    const cleaned = stripResetParam('https://void.example/путь?reset=СЕКРЕТ');
    expect(decodeURIComponent(cleaned)).toContain('/путь');
    expect(cleaned).not.toContain('СЕКРЕТ');
  });

  it('ссылка без токена возвращается как есть — чистить нечего', () => {
    const href = 'https://void.example/game?join=m1';
    expect(stripResetParam(href)).toBe(href);
  });

  it('непарсимый адрес не роняет вход', () => {
    expect(stripResetParam('не-адрес-вовсе')).toBe('не-адрес-вовсе');
  });

  it('несколько повторов параметра вычищаются все до одного', () => {
    const cleaned = stripResetParam('https://void.example/g?reset=A&reset=B');
    expect(cleaned).not.toContain('reset');
    expect(cleaned).not.toContain('A');
    expect(cleaned).not.toContain('B');
  });
});

describe('сброс пароля — разбор ответа сервера (fail-secure)', () => {
  it('оба поля на месте — вход состоялся', () => {
    const r = parseResetOutcome(true, { login: 'ник', token: 'сес' });
    expect(r).toEqual({ ok: true, login: 'ник', token: 'сес' });
  });

  it('HTTP не ok — отказ, даже если тело выглядит правильным', () => {
    expect(parseResetOutcome(false, { login: 'ник', token: 'сес' }).ok).toBe(false);
  });

  it('сессия без логина (и наоборот) — не вход', () => {
    expect(parseResetOutcome(true, { token: 'сес' }).ok).toBe(false);
    expect(parseResetOutcome(true, { login: 'ник' }).ok).toBe(false);
  });

  it('пустые строки не считаются значениями', () => {
    expect(parseResetOutcome(true, { login: '', token: 'сес' }).ok).toBe(false);
    expect(parseResetOutcome(true, { login: 'ник', token: '' }).ok).toBe(false);
  });

  it('не-строковые поля отвергаются (подделанный ответ)', () => {
    expect(parseResetOutcome(true, { login: 42, token: 'сес' }).ok).toBe(false);
    expect(parseResetOutcome(true, { login: 'ник', token: { a: 1 } }).ok).toBe(false);
  });

  it('мусор вместо тела — отказ, а не падение', () => {
    expect(parseResetOutcome(true, null).ok).toBe(false);
    expect(parseResetOutcome(true, 'строка').ok).toBe(false);
    expect(parseResetOutcome(true, undefined).ok).toBe(false);
  });
});

describe('сброс пароля — сцена', () => {
  it('open() показывает сцену, чистит поля и возвращает очищенный адрес', () => {
    const w = wired();
    w.pass.value = 'старое';
    const cleaned = w.api.open('ТОКЕН', 'https://void.example/g?reset=ТОКЕН');
    expect(w.stages()).toBe(1);
    expect(w.pass.value).toBe('');
    expect(cleaned).not.toContain('ТОКЕН');
  });

  it('плохой пароль не доходит до сервера', async () => {
    const w = wired();
    w.api.open('ТОКЕН', 'https://void.example/g?reset=ТОКЕН');
    w.pass.value = 'коротко';
    w.pass2.value = 'коротко';
    await w.api.submit();
    expect(w.sent).toEqual([]);
    expect(w.status.at(-1)).toBeTruthy();
    expect(w.pass.ariaInvalid).toBe('true');
  });

  it('повтор выделяет оба поля, исправление любого убирает рамки и сообщение', async () => {
    const w = wired();
    w.api.open('TOKEN', 'https://void.example/g?reset=TOKEN');
    expect([w.pass.ariaInvalid, w.pass2.ariaInvalid]).toEqual([null, null]);
    w.pass.value = 'orbit-new-secret';
    w.pass2.value = 'orbit-other-secret';
    await w.api.submit();
    expect([w.pass.ariaInvalid, w.pass2.ariaInvalid, w.status.at(-1)])
      .toEqual(['true', 'true', t('auth.pass-mismatch')]);
    w.pass.value = w.pass2.value;
    w.pass.dispatchEvent(new Event('input'));
    expect([w.pass.ariaInvalid, w.pass2.ariaInvalid, w.status.at(-1)]).toEqual([null, null, '']);
  });

  it('ответ о старом пароле не помечает уже исправленный пароль', async () => {
    let answer!: (value: { ok: boolean; body: unknown }) => void;
    const w = wired({ submit: () => new Promise((resolve) => { answer = resolve; }) });
    w.api.open('TOKEN', 'https://void.example/g?reset=TOKEN');
    w.pass.value = w.pass2.value = 'orbit-new-secret';
    const pending = w.api.submit();
    w.pass.value = w.pass2.value = 'orbit-other-secret';
    w.pass.dispatchEvent(new Event('input'));
    answer({ ok: false, body: { error: 'E_PASSWORD_POLICY' } });
    await pending;
    expect([w.pass.ariaInvalid, w.pass2.ariaInvalid, w.status.at(-1), w.success]).toEqual([null, null, '', []]);
  });

  it('успешный сброс сохраняет сессию, даже если поля изменили во время запроса', async () => {
    let answer!: (value: { ok: boolean; body: unknown }) => void;
    const w = wired({ submit: () => new Promise((resolve) => { answer = resolve; }) });
    w.api.open('TOKEN', 'https://void.example/g?reset=TOKEN');
    w.pass.value = w.pass2.value = 'orbit-new-secret';
    const pending = w.api.submit();
    w.pass.value = 'changed-after-submit';
    w.pass.dispatchEvent(new Event('input'));
    answer({ ok: true, body: { login: 'Orion', token: 'reset-session' } });
    await pending;
    expect(w.success).toEqual([['Orion', 'reset-session']]);
    expect([w.pass.value, w.pass2.value, w.pass.ariaInvalid, w.pass2.ariaInvalid]).toEqual(['', '', null, null]);
    expect(w.isBusy()).toBe(false);
  });

  it('ответ для прежней ссылки сброса не заменяет новую открытую форму', async () => {
    let answer!: (value: { ok: boolean; body: unknown }) => void;
    const w = wired({ submit: () => new Promise((resolve) => { answer = resolve; }) });
    w.api.open('TOKEN', 'https://void.example/g?reset=TOKEN');
    w.pass.value = w.pass2.value = 'orbit-new-secret';
    const pending = w.api.submit();
    w.api.open('NEW-TOKEN', 'https://void.example/g?reset=NEW-TOKEN');
    w.pass.value = w.pass2.value = 'another-new-secret';
    answer({ ok: true, body: { login: 'Orion', token: 'reset-session' } });
    await pending;
    expect(w.success).toEqual([]);
    expect([w.pass.value, w.pass2.value]).toEqual(['another-new-secret', 'another-new-secret']);
  });

  it('успех тратит токен и логинит — сессия уходит хозяину', async () => {
    const w = wired();
    w.api.open('ТОКЕН', 'https://void.example/g?reset=ТОКЕН');
    w.pass.value = 'достаточно-длинный';
    w.pass2.value = 'достаточно-длинный';
    await w.api.submit();
    expect(w.sent).toEqual([['ТОКЕН', 'достаточно-длинный']]);
    expect(w.success).toEqual([['ник', 'сес']]);
    expect(w.pass.value).toBe(''); // поля вычищены после траты
  });

  it('потраченный токен не отправляется повторно', async () => {
    const w = wired();
    w.api.open('ТОКЕН', 'https://void.example/g?reset=ТОКЕН');
    w.pass.value = 'достаточно-длинный';
    w.pass2.value = 'достаточно-длинный';
    await w.api.submit();
    w.pass.value = 'достаточно-длинный';
    w.pass2.value = 'достаточно-длинный';
    await w.api.submit();
    expect(w.sent[1]?.[0]).toBe(''); // второй раз токена уже нет
  });

  it('отказ сервера показывается игроку и НЕ логинит', async () => {
    const w = wired({}, { ok: false, body: {} });
    w.api.open('ТОКЕН', 'https://void.example/g?reset=ТОКЕН');
    w.pass.value = 'достаточно-длинный';
    w.pass2.value = 'достаточно-длинный';
    await w.api.submit();
    expect(w.success).toEqual([]);
    expect(w.status.at(-1)).toBeTruthy();
  });

  it('новое правило сервера оставляет ссылку пригодной для исправления пароля', async () => {
    const w = wired({}, { ok: false, body: { error: 'E_PASSWORD_POLICY' } });
    w.api.open('ТОКЕН', 'https://void.example/g?reset=ТОКЕН');
    w.pass.value = w.pass2.value = 'достаточно-длинный';
    await w.api.submit();
    expect(w.status.at(-1)).toBe(t('acc.pass.rule'));
    expect(w.pass.focused()).toBeGreaterThan(0);
    expect(w.pass.ariaInvalid).toBe('true');
    expect(w.success).toEqual([]);
    await w.api.submit();
    expect(w.sent[1]?.[0]).toBe('ТОКЕН');
  });

  it('сеть не дошла — тоже отказ, без входа', async () => {
    const w = wired({}, null);
    w.api.open('ТОКЕН', 'https://void.example/g?reset=ТОКЕН');
    w.pass.value = 'достаточно-длинный';
    w.pass2.value = 'достаточно-длинный';
    await w.api.submit();
    expect(w.success).toEqual([]);
  });

  it('замок снимается даже после отказа — форма не залипает', async () => {
    const w = wired({}, { ok: false, body: {} });
    w.api.open('ТОКЕН', 'https://void.example/g?reset=ТОКЕН');
    w.pass.value = 'достаточно-длинный';
    w.pass2.value = 'достаточно-длинный';
    await w.api.submit();
    expect(w.isBusy()).toBe(false);
  });

  it('пока идёт вход, второй отправки не будет', async () => {
    const w = wired({ busy: () => true });
    w.api.open('ТОКЕН', 'https://void.example/g?reset=ТОКЕН');
    w.pass.value = 'достаточно-длинный';
    w.pass2.value = 'достаточно-длинный';
    await w.api.submit();
    expect(w.sent).toEqual([]);
  });
});
