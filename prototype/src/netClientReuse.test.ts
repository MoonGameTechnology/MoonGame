import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState, type GameState } from '../../packages/shared-core/src/index';
import { MultiplayerClient } from '../../packages/client/src/index';
import type { ActionEnvelope } from '../../packages/action-layer/src/index';
import { orderPlan } from './orderRoute';
import { clientPlan, liveSocket, seatKey, type Wire } from './netClientReuse';

describe('переиспользовать клиента или заводить нового (NETA2-5)', () => {
  it('клиента нет — только новый', () => {
    expect(clientPlan({ hasClient: false, sameSeat: false })).toBe('fresh');
    expect(clientPlan({ hasClient: false, sameSeat: true })).toBe('fresh');
  });

  it('ТО ЖЕ МЕСТО — ПЕРЕИСПОЛЬЗУЕМ: иначе очередь обрыва уедет в мусор вместе с клиентом', () => {
    expect(clientPlan({ hasClient: true, sameSeat: true })).toBe('reuse');
  });

  it('ДРУГОЕ МЕСТО — НОВЫЙ: приказ прошлого матча не должен доехать в этот', () => {
    expect(clientPlan({ hasClient: true, sameSeat: false })).toBe('fresh');
  });
});

describe('ключ места', () => {
  it('место — это тройка «сервер + матч + позывной»', () => {
    expect(seatKey('ws://a', 'm1', 'nick')).toBe(seatKey('ws://a', 'm1', 'nick'));
    expect(seatKey('ws://a', 'm1', 'nick')).not.toBe(seatKey('ws://b', 'm1', 'nick'));
    expect(seatKey('ws://a', 'm1', 'nick')).not.toBe(seatKey('ws://a', 'm2', 'nick'));
    expect(seatKey('ws://a', 'm1', 'nick')).not.toBe(seatKey('ws://a', 'm1', 'other'));
  });

  it('разделитель не даёт склеить разные тройки в одну строку', () => {
    // без экранирования «a|b» + «c» и «a» + «b|c» дали бы один ключ, и клиент чужого
    // матча сошёл бы за свой — ровно та ошибка, которую место и должно ловить.
    expect(seatKey('ws://a', 'm|1', 'nick')).not.toBe(seatKey('ws://a', 'm', '1|nick'));
  });
});

describe('живой сокет под одним клиентом', () => {
  it('ПИШЕТ В ТЕКУЩИЙ СОКЕТ: клиент переживает реконнект, сокет — нет', () => {
    let current: { send: (d: string) => void; close: () => void } | null = null;
    const wire = liveSocket(() => current);
    const first = { send: vi.fn(), close: vi.fn() };
    const second = { send: vi.fn(), close: vi.fn() };

    current = first;
    wire.send('a');
    current = second; // обрыв и переподключение: сокет другой, клиент тот же
    wire.send('b');

    expect(first.send.mock.calls).toEqual([['a']]);
    expect(second.send.mock.calls).toEqual([['b']]);
  });

  it('БЕЗ СОКЕТА МОЛЧИТ, А НЕ ПАДАЕТ: в момент обрыва писать физически некуда', () => {
    const wire = liveSocket(() => null);
    expect(() => wire.send('a')).not.toThrow();
    expect(() => wire.close()).not.toThrow();
  });

  it('закрывает тоже текущий сокет', () => {
    const sock = { send: vi.fn(), close: vi.fn() };
    liveSocket(() => sock).close();
    expect(sock.close).toHaveBeenCalledTimes(1);
  });
});

// Сквозная проверка того, ради чего кирпич и затевался: приказ, выданный в момент
// обрыва, доезжает до сервера и доезжает ЧЕСТНЫМ — под сессией, которую сервер выдал
// после переподключения. Здесь собран ровно тот узел, что живёт в `main.ts`: ОДИН
// `MultiplayerClient` поверх `liveSocket`, под которым меняется сокет, и `orderPlan`,
// решающий судьбу приказа. Пока это собиралось руками в `connect()`, приказ на обрыве
// оставалось только отвергнуть — очередь уезжала в мусор вместе с клиентом.
describe('приказ на реконнекте не теряется и не подделывается (NETA2-5)', () => {
  class FakeSocket implements Wire {
    readonly sent: string[] = [];
    closed = false;
    send(data: string): void {
      this.sent.push(data);
    }
    close(): void {
      this.closed = true;
    }
  }
  const state = (): GameState =>
    createInitialState({ seed: 'neta2-5', version: { data: '1', manifest: '1' } });
  const welcome = (sessionId: string, seq: number): string =>
    JSON.stringify({
      type: 'welcome',
      matchId: 'm',
      playerId: 'p1',
      seq,
      serverTime: 0,
      state: state(),
      sessionId,
      gated: true,
    });
  const order = (): Parameters<MultiplayerClient['sendAction']>[0] => ({
    id: 'ui:p1:1',
    type: 'fleet.orbit',
    playerId: 'p1',
    payload: { fleetId: 'F1', orbit: 'near' },
    issuedAt: 0,
  });
  const envelopes = (sock: FakeSocket): ActionEnvelope[] =>
    sock.sent
      .map((raw) => JSON.parse(raw) as { type: string; envelope?: ActionEnvelope })
      .filter((m) => m.type === 'action.v1')
      .map((m) => m.envelope as ActionEnvelope);

  it('ОБРЫВ КОПИТ, WELCOME ДОСЫЛАЕТ — и конверты минтятся под НОВОЙ сессией', () => {
    let sock = new FakeSocket();
    const first = sock;
    const client = new MultiplayerClient(liveSocket(() => sock), {});
    client.open();
    client.receive(welcome('sess-A', 0));

    // связь жива — приказ уходит сразу (маршрут `send`)
    expect(orderPlan({ net: true, hasClient: true, reconnecting: false }).route).toBe('send');
    client.sendAction(order());
    expect(envelopes(first)).toHaveLength(1);

    // обрыв: прототип зовёт connectionLost() и дозванивается новым сокетом
    client.connectionLost();
    const second = (sock = new FakeSocket());
    // приказ, выданный ИМЕННО СЕЙЧАС, — в очередь, а не в отказ
    expect(orderPlan({ net: false, hasClient: true, reconnecting: true }).route).toBe('queue');
    client.sendAction(order());
    client.sendAction(order());
    expect(second.sent).toHaveLength(0); // сессии ещё нет — слать нечем и незачем
    expect(envelopes(first)).toHaveLength(1); // и в мёртвый провод тоже ничего

    client.open(); // сокет открылся — этого мало: гейт ждёт свежую сессию
    expect(second.sent).toHaveLength(0);

    client.receive(welcome('sess-B', 7)); // сервер впустил заново
    const flushed = envelopes(second);
    expect(flushed).toHaveLength(2); // ОБА приказа доехали, в порядке выдачи
    // Подделать их обрывом нельзя: id конверта считается от новой сессии и строгого
    // счётчика, который она обнулила, — старая сессия в них не участвует.
    expect(flushed.map((e) => e.actionId)).toEqual(['sess-B:p1:1', 'sess-B:p1:2']);
    expect(flushed.every((e) => e.sessionId === 'sess-B')).toBe(true);
  });

  it('ПРИКАЗ ПОСЛЕ ВЫХОДА НЕ ДОГОНЯЕТ: с клиентом умирает и его очередь', () => {
    // `dropNetClient()` в main.ts — это `netClient = null`, после чего маршрут приказа
    // становится «отказ», а не «очередь»: копить его больше некому.
    expect(orderPlan({ net: false, hasClient: false, reconnecting: true }).route).toBe('refuse');
    expect(clientPlan({ hasClient: false, sameSeat: true })).toBe('fresh');
  });
});

// Сторож против отката: узел выше проверяет МЕХАНИЗМ, но живёт он в `main.ts`, который
// тестами не покрыт (браузерный монолит). Тот же приём, что у `aiProfile.test.ts` и
// `wireParity.test.ts`: утверждение о коде берётся из кода. Проверяется ровно то, что
// делает очередь возможной, — один клиент на дозвоны и честный сигнал об обрыве.
describe('main.ts держит один клиент на всё присутствие (NETA2-5)', () => {
  const main = readFileSync('prototype/src/main.ts', 'utf8');

  it('клиент создаётся В ОДНОМ месте — иначе дозвон снова выбросит очередь', () => {
    expect(main.match(/new MultiplayerClient\(/g)).toHaveLength(1);
    expect(main).toMatch(/function netClientFor\(/);
  });

  it('клиент сидит на ЖИВОМ проводе, а не на конкретном сокете', () => {
    expect(main).toMatch(/new MultiplayerClient\(liveSocket\(\(\) => netSock\)/);
  });

  it('ОБРЫВ СООБЩАЕТСЯ КЛИЕНТУ: без connectionLost() приказ уйдёт в мёртвый сокет', () => {
    expect(main).toMatch(/netClient\?\.connectionLost\(\)/);
  });

  it('выход игрока и сдача цикла роняют клиента вместе с очередью', () => {
    expect(main.match(/dropNetClient\(\)/g)?.length).toBeGreaterThanOrEqual(3); // объявление + два вызова
  });
});
