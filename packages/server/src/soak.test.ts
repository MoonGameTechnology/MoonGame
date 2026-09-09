import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { applyDelta, visibleState, type Action, type GameData, type GameState } from '@void/shared-core';
import { createDevMatch, loadShippedData } from './scenario';
import type { RoomObservation, RoomPeer } from './matchRoom';
import { createMultiplayerServer } from './wsServer';
import type { ServerMessage } from './protocol';

/** The visible-`GameState` a player's client reconstructs to (fog applied,
 *  signatures/remembered ride as separate message fields). */
function visibleBase(state: GameState, player: string, data: GameData): GameState {
  const { signatures: _s, remembered: _r, ...base } = visibleState(state, player, data);
  return base as GameState;
}

function orbit(player: string, seq: number, to: 'near'): Action {
  return {
    id: `soak:${player}:${seq}`,
    type: 'fleet.orbit',
    playerId: player,
    payload: { fleetId: `${player}_1`, orbit: to },
    issuedAt: 0,
  };
}

/** Drive one client: connect, fire all its actions, and resolve with the state
 *  reconstructed from welcome + deltas once it has applied the delta carrying
 *  `untilSeq` (the globally-last action). */
function runClient(
  url: string,
  player: string,
  actions: Action[],
  untilSeq: number,
): Promise<GameState> {
  return new Promise<GameState>((resolve, reject) => {
    const ws = new WebSocket(`${url}?player=${player}`);
    let state: GameState | null = null;
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`${player} did not converge`));
    }, 15_000);
    ws.on('message', (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type === 'welcome') {
        state = message.state;
      } else if (message.type === 'delta' && state) {
        state = applyDelta(state, message.delta);
        if (message.seq >= untilSeq) {
          clearTimeout(timer);
          const final = state;
          ws.close();
          resolve(final);
        }
      }
    });
    ws.on('open', () => {
      for (const action of actions) ws.send(JSON.stringify({ type: 'action', action }));
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

// Soak / consistency under concurrent load — part of the multiplayer-test prep.
// N clients each fire K actions at once; the authoritative room must serialize
// all N×K, stay consistent, and every client must converge to ITS OWN visible
// view (fog of war, F6) reconstructed purely from its welcome + delta stream.
// A late-joining client resyncs from its welcome, so connect timing does not matter.
describe('soak: concurrent clients converge on their authoritative view', () => {
  it('serializes N×K concurrent actions and each client reconstructs its own visible state', async () => {
    const players = ['green', 'red', 'blue', 'gold'];
    const K = 6; // K "enter orbit" actions per client (a single orbit; all end 'near')
    const total = players.length * K;
    const data = loadShippedData();
    const room = createDevMatch(data, { players, now: () => 1000, time: 0 });
    const server = createMultiplayerServer({ room });
    const url = await server.listen();
    try {
      const finals = await Promise.all(
        players.map((player) => {
          const actions: Action[] = [];
          for (let k = 0; k < K; k++) actions.push(orbit(player, k, 'near'));
          return runClient(url, player, actions, total);
        }),
      );

      // Every action was applied exactly once, in a single serialized order.
      expect(room.sequence).toBe(total);
      // Each fleet ended in the near orbit (each client's final action).
      for (const player of players) {
        expect(room.state.fleets[`${player}_1`]?.orbit).toBe('near');
      }
      // Each client reconstructed exactly its own visible view of the
      // authoritative state — no drift, and fog hides the other players.
      players.forEach((player, i) => {
        expect(finals[i]).toEqual(visibleBase(room.state, player, data));
      });
    } finally {
      await server.close();
    }
  });

  it('seats N players from the parameterized scenario', async () => {
    const players = ['p1', 'p2', 'p3'];
    const room = createDevMatch(loadShippedData(), { players, now: () => 0, time: 0 });
    expect(Object.keys(room.state.players).sort()).toEqual(players);
    for (const p of players) {
      expect(room.state.fleets[`${p}_1`]?.owner).toBe(p);
      expect(room.state.planets[`home_${p}`]?.owner).toBe(p);
      expect(room.hasPlayer(p)).toBe(true);
    }
    // sanity: the wire still accepts a seated player and rejects an unknown one
    const server = createMultiplayerServer({ room });
    const wsUrl = await server.listen();
    const ok = new WebSocket(`${wsUrl}?player=p1`);
    try {
      const [data] = (await once(ok, 'message')) as [Buffer];
      expect((JSON.parse(String(data)) as ServerMessage).type).toBe('welcome');
    } finally {
      ok.close();
      await server.close();
    }
  });
});

// RESIL-4 — соак ВРЕМЕНИ, в отличие от соака нагрузки выше. Тот проверяет, что N×K
// одновременных действий сериализуются и каждый клиент собирает свою проекцию; этот —
// что мир, оставленный идти, ДЕЙСТВИТЕЛЬНО идёт неделю игрового времени и не встаёт.
//
// Зачем именно так. Класс дефекта, который стоил нам плейтеста, выглядит одинаково с
// любой стороны: следующий шаг не планируется, и мир замирает — тихо, без исключения в
// логе. Поймать это можно либо людьми на живом сервере, либо прогоном. Прогон дешевле и
// повторяем, поэтому он здесь.
//
// Оба сигнала УЖЕ есть в потоке наблюдений, изобретать ничего не нужно:
//   · `advance_overflow` — тик не двигает время, пока работа просрочена (застой);
//   · `dead_letter` — у запланированного события бросил обработчик, и его выбросили.
describe('соак времени: мир идёт неделю и не встаёт', () => {
  it('за 168 игровых часов ни застоя часов, ни мёртвых писем — и мир при этом РАБОТАЛ', async () => {
    const HOUR = 3_600_000;
    const HOURS = 24 * 7;
    const players = ['green', 'red', 'blue', 'gold'];
    const data = loadShippedData();
    const clock = { now: 0 };
    const seen: RoomObservation[] = [];
    const room = createDevMatch(data, {
      players,
      now: () => clock.now,
      time: 0,
      observe: (e) => seen.push(e),
    });

    // Мир должен не просто тикать вхолостую, а нести запланированные события: без них
    // тест зеленел бы и на наглухо сломанном планировщике. Перелёт домой → nexus даёт
    // прибытие, то есть настоящее событие в расписании.
    const peer: RoomPeer = { send: () => {} };
    for (const p of players) {
      await room.receive(
        p,
        peer,
        JSON.stringify({
          type: 'action',
          action: {
            id: `soak-time:${p}`,
            type: 'fleet.move',
            playerId: p,
            payload: { fleetId: `${p}_1`, to: 'nexus' },
            issuedAt: 0,
          },
        }),
      );
    }
    expect(room.state.fleets.green_1?.movement).toBeDefined(); // приказ принят, полёт идёт

    for (let h = 1; h <= HOURS; h++) {
      clock.now = h * HOUR;
      room.tick();
    }

    // 1. Часы дошли до цели — мир не встал по дороге.
    expect(room.state.time).toBe(HOURS * HOUR);
    // 2. Ни одного застоя: тик, который не двигает время при просроченной работе.
    expect(seen.filter((e) => e.kind === 'advance_overflow')).toEqual([]);
    // 3. Ни одного мёртвого письма: событие, чей обработчик бросил.
    expect(seen.filter((e) => e.kind === 'dead_letter')).toEqual([]);
    // 4. Анти-пустышка: расписание действительно отработало, а не молчало неделю.
    // 4. Анти-пустышка. Проверки 1–3 зеленели бы и на мире, где НИЧЕГО не запланировано:
    //    часы дошли, застоя нет, ронять нечего. Поэтому отдельно требуем, чтобы поток нёс
    //    ДОМЕННЫЕ события: наблюдение `events` эмитится только когда шаг родил события
    //    сверх clock-спанов (`broadcastState` отфильтровывает `time.advanced`).
    expect(seen.some((e) => e.kind === 'events')).toBe(true);
    // 5. И расписание довело дело до конца: в пути не осталось никого. Конкретный ИСХОД
    //    (кто дожил) намеренно не проверяется — четыре флота встречаются в nexus и дерутся,
    //    то есть неделя накрывает и бой, а его результат — вопрос баланса, не надёжности.
    //    Прибивать его тестом значило бы ронять соак на каждой правке чисел.
    expect(Object.values(room.state.fleets).filter((f) => f.movement)).toEqual([]);
  });
});
