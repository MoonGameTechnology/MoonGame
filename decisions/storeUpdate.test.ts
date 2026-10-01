import { describe, expect, it } from 'vitest';
import {
  initialStoreUpdate,
  parseStoreUpdateEvent,
  storeUpdateBanner,
  storeUpdateEvent,
  storeUpdateIntent,
  type StoreUpdateEvent,
  type StoreUpdateIntent,
  type StoreUpdateState,
} from './storeUpdate';

/** Прогон сценария: намерения и события по очереди, вызовы моста — в порядке ухода. */
function play(steps: (StoreUpdateIntent | StoreUpdateEvent)[], from = initialStoreUpdate) {
  let state: StoreUpdateState = from;
  const calls: string[] = [];
  for (const step of steps) {
    if (typeof step === 'string') {
      const next = storeUpdateIntent(state, step);
      state = next.state;
      if (next.call) calls.push(next.call);
    } else state = storeUpdateEvent(state, step);
  }
  return { state, calls, banner: storeUpdateBanner(state) };
}

const available = { type: 'check', available: true } as const;
const none = { type: 'check', available: false } as const;
const accepted = { type: 'flow', accepted: true } as const;
const declined = { type: 'flow', accepted: false } as const;
const downloaded = { type: 'install', status: 'downloaded' } as const;

describe('storeUpdate — путь игрока', () => {
  it('проверка → «Обновить» → согласие в диалоге → скачано → «Перезапустить»', () => {
    const r = play(['check', available, 'start', accepted, downloaded, 'restart']);
    expect(r.calls).toEqual(['checkUpdate', 'startUpdate', 'completeUpdate']);
    expect(r.state.phase).toBe('installing');
    expect(r.banner).toBeNull();
  });

  it('проверка сама диалог магазина НЕ открывает — только предлагает (правило 1)', () => {
    const r = play(['check', available]);
    expect(r.calls).toEqual(['checkUpdate']);
    expect(r.banner).toBe('offer');
  });

  it('скачанное не ставится само: перезапуск ждёт нажатия (правило 2)', () => {
    const r = play(['check', available, 'start', accepted, downloaded]);
    expect(r.calls).not.toContain('completeUpdate');
    expect(r.banner).toBe('ready');
  });

  it('обновления нет — баннера нет', () => {
    expect(play(['check', none]).banner).toBeNull();
  });

  it('пока идёт скачивание, баннера нет', () => {
    expect(play(['check', available, 'start', accepted]).banner).toBeNull();
  });
});

describe('storeUpdate — сбой это покой (правило 3)', () => {
  it('ошибка проверки (нет магазина, не вошёл, поставлено не из магазина) — тишина', () => {
    const r = play(['check', { type: 'error', op: 'check' }]);
    expect(r.state).toEqual(initialStoreUpdate);
    expect(r.banner).toBeNull();
  });

  it('ошибка запуска диалога — тишина, а не зависший «идёт»', () => {
    const r = play(['check', available, 'start', { type: 'error', op: 'start' }]);
    expect(r.state).toEqual(initialStoreUpdate);
  });

  it('скачивание сорвалось — тишина; следующая проверка предложит снова', () => {
    const failed = play([
      'check',
      available,
      'start',
      accepted,
      { type: 'install', status: 'failed' },
    ]);
    expect(failed.banner).toBeNull();
    expect(play(['check', available], failed.state).banner).toBe('offer');
  });

  it('ошибка перезапуска скачанное не теряет и не навязывает сразу', () => {
    const r = play([
      'check',
      available,
      'start',
      accepted,
      downloaded,
      'restart',
      { type: 'error', op: 'complete' },
    ]);
    expect(r.state.phase).toBe('ready');
    expect(r.banner).toBeNull();
    expect(play(['check'], r.state).banner).toBe('ready');
  });

  it('потерянный ответ проверки не запирает обновления до конца сессии', () => {
    const r = play(['check', 'check', available]);
    expect(r.calls).toEqual(['checkUpdate', 'checkUpdate']);
    expect(r.banner).toBe('offer');
  });
});

describe('storeUpdate — один вызов в полёте (правило 4)', () => {
  it('двойной тап по «Обновить» открывает ОДИН диалог', () => {
    expect(play(['check', available, 'start', 'start']).calls).toEqual([
      'checkUpdate',
      'startUpdate',
    ]);
  });

  it('двойной тап по «Перезапустить» шлёт ОДИН вызов', () => {
    const r = play(['check', available, 'start', accepted, downloaded, 'restart', 'restart']);
    expect(r.calls.filter((c) => c === 'completeUpdate')).toHaveLength(1);
  });

  it('проверка по графику не перебивает открытый диалог и скачивание', () => {
    expect(play(['check', available, 'start', 'check']).calls).toEqual([
      'checkUpdate',
      'startUpdate',
    ]);
    expect(play(['check', available, 'start', accepted, 'check']).state.phase).toBe('downloading');
  });

  it('«Перезапустить» без скачанного не зовёт ничего', () => {
    expect(play(['restart']).calls).toEqual([]);
    expect(play(['check', available, 'restart']).calls).toEqual(['checkUpdate']);
  });
});

describe('storeUpdate — «Позже» (правило 5)', () => {
  it('прячет предложение, и «Обновить» после этого не срабатывает', () => {
    const r = play(['check', available, 'later', 'start']);
    expect(r.banner).toBeNull();
    expect(r.calls).toEqual(['checkUpdate']);
  });

  it('следующий результат проверки показывает предложение снова', () => {
    expect(play(['check', available, 'later', 'check', available]).banner).toBe('offer');
  });

  it('отказ в диалоге магазина — то же «Позже»', () => {
    const r = play(['check', available, 'start', declined]);
    expect(r.state.phase).toBe('offer');
    expect(r.banner).toBeNull();
  });

  it('скачанное после «Позже» заново не проверяется — снова предлагается поставить', () => {
    const r = play(['check', available, 'start', accepted, downloaded, 'later', 'check']);
    expect(r.calls).toEqual(['checkUpdate', 'startUpdate']);
    expect(r.banner).toBe('ready');
  });
});

describe('storeUpdate — событие вне своего шага (правило 6)', () => {
  it('результат проверки без проверки в полёте ничего не двигает', () => {
    expect(play([available]).state).toEqual(initialStoreUpdate);
  });

  it('согласие из диалога без открытого диалога ничего не двигает', () => {
    expect(play([accepted]).state).toEqual(initialStoreUpdate);
  });

  it('диалог не открылся, потому что обновление уже поставили, — покой', () => {
    expect(play(['check', available, 'start', none]).state).toEqual(initialStoreUpdate);
  });

  it('скачивание пошло раньше, чем пришёл ответ диалога, — порядок событий не важен', () => {
    const r = play([
      'check',
      available,
      'start',
      { type: 'install', status: 'downloading' },
      accepted,
      downloaded,
    ]);
    expect(r.banner).toBe('ready');
  });

  it('повторное «скачано» не снимает «Позже» с готового обновления', () => {
    const r = play(['check', available, 'start', accepted, downloaded, 'later', downloaded]);
    expect(r.banner).toBeNull();
  });
});

describe('parseStoreUpdateEvent — строгий разбор', () => {
  it('принимает ровно четыре формы', () => {
    expect(parseStoreUpdateEvent({ type: 'check', available: true })).toEqual(available);
    expect(parseStoreUpdateEvent({ type: 'flow', accepted: false })).toEqual(declined);
    expect(parseStoreUpdateEvent({ type: 'install', status: 'downloaded' })).toEqual(downloaded);
    expect(parseStoreUpdateEvent({ type: 'error', op: 'start' })).toEqual({
      type: 'error',
      op: 'start',
    });
  });

  it('лишние поля отбрасываются, а не протаскиваются дальше', () => {
    expect(parseStoreUpdateEvent({ type: 'error', op: 'check', message: 'boom' })).toEqual({
      type: 'error',
      op: 'check',
    });
  });

  it('незнакомое и битое — null', () => {
    for (const raw of [
      null,
      undefined,
      'check',
      42,
      {},
      { type: 'check' },
      { type: 'check', available: 'yes' },
      { type: 'flow', accepted: 1 },
      { type: 'install', status: 'installed' },
      { type: 'error', op: 'download' },
      { type: 'pay', ok: true },
    ])
      expect(parseStoreUpdateEvent(raw)).toBeNull();
  });
});
