import { describe, expect, it } from 'vitest';
import type { Action } from '@void/shared-core';
import { readFileSync } from 'node:fs';
import { createDevMatch, loadShippedData } from './scenario';
import { MatchRoom, type RoomObservation, type RoomPeer } from './matchRoom';
import type { ServerMessage } from './protocol';

// NETA2-8 — ОДНА оркестрация на два пути коммита.
//
// `applyAndBroadcast` (sync) и `commitApply` (durable) делали одно и то же —
// advance → apply → receipt → broadcast → observeEnd → timing, — но двумя записями,
// и это была структурная причина дрейфа (NETA2-0a, расхождение `seq`). Тесты ниже
// закрепляют то, что после сведения не должно разъезжаться НИКОГДА: наблюдаемый
// результат одного и того же действия на двух путях совпадает.
//
// Durable-специфика (что commit ждёт записи, что провал записи не коммитит ничего,
// что наблюдение помечено `durable:true`) закреплена отдельно — `matchRoom-commit.test.ts`.

const data = loadShippedData();

class MemoryPeer implements RoomPeer {
  readonly messages: ServerMessage[] = [];
  send(raw: string): void {
    this.messages.push(JSON.parse(raw) as ServerMessage);
  }
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
}

const orbit = (n: number, fleetId = 'green_1'): Action => ({
  id: `t:green:${n}`,
  type: 'fleet.orbit',
  playerId: 'green',
  payload: { fleetId, orbit: 'near' },
  issuedAt: 0,
});

/** Пара комнат-близнецов: одинаковый мир, разный путь коммита. */
function twins(now: () => number): { sync: MatchRoom; durable: MatchRoom } {
  return {
    sync: createDevMatch(data, { id: 'sync', now, time: now() }),
    durable: createDevMatch(data, {
      id: 'durable',
      now,
      time: now(),
      persist: () => Promise.resolve(),
    }),
  };
}

/** Прогон одного действия по каждому пути: durable ждёт мейлбокса, sync — нет. */
async function bothReceive(
  rooms: { sync: MatchRoom; durable: MatchRoom },
  peers: { sync: MemoryPeer; durable: MemoryPeer },
  action: Action,
): Promise<void> {
  const raw = JSON.stringify({ type: 'action', action });
  await rooms.sync.receive('green', peers.sync, raw);
  await rooms.durable.receive('green', peers.durable, raw);
}

describe('NETA2-8 · sync и durable — одна оркестрация', () => {
  it('УСПЕХ: один и тот же seq, одни и те же события, одинаковая рассылка', async () => {
    const now = () => 1000;
    const rooms = twins(now);
    const peers = { sync: new MemoryPeer(), durable: new MemoryPeer() };
    rooms.sync.addPeer('green', peers.sync);
    rooms.durable.addPeer('green', peers.durable);

    await bothReceive(rooms, peers, orbit(1));

    const deltaOf = (p: MemoryPeer) => p.of('delta').at(-1);
    expect(deltaOf(peers.sync)?.seq).toBe(deltaOf(peers.durable)?.seq);
    expect(deltaOf(peers.sync)?.events).toEqual(deltaOf(peers.durable)?.events);
    expect(peers.sync.of('rejection')).toHaveLength(0);
    expect(peers.durable.of('rejection')).toHaveLength(0);
  });

  it('ОТКАЗ ЯДРА: одинаковый код, одинаковый seq квитанции, обе ветки шлют ровно один отказ', async () => {
    const now = () => 1000;
    const rooms = twins(now);
    const peers = { sync: new MemoryPeer(), durable: new MemoryPeer() };
    rooms.sync.addPeer('green', peers.sync);
    rooms.durable.addPeer('green', peers.durable);

    // Чужой флот: ядро отвергает, мир при этом уже догнан — ровно тот стык, на котором
    // ветки и расходились (SRV-1: события догона рассылаются, квитанция ok:false).
    await bothReceive(rooms, peers, { ...orbit(2), payload: { fleetId: 'red_1', orbit: 'near' } });

    const rej = (p: MemoryPeer) => p.of('rejection');
    expect(rej(peers.sync)).toHaveLength(1);
    expect(rej(peers.durable)).toHaveLength(1);
    expect(rej(peers.sync)[0]!.code).toBe(rej(peers.durable)[0]!.code);
    expect(rej(peers.sync)[0]!.seq).toBe(rej(peers.durable)[0]!.seq);
  });

  it('ЧУЖОЕ ДЕЙСТВИЕ: E_FORBIDDEN с квитанцией на обоих путях (seq растёт одинаково)', async () => {
    const now = () => 1000;
    const rooms = twins(now);
    const peers = { sync: new MemoryPeer(), durable: new MemoryPeer() };
    rooms.sync.addPeer('green', peers.sync);
    rooms.durable.addPeer('green', peers.durable);

    await bothReceive(rooms, peers, { ...orbit(3), playerId: 'red' });

    const rej = (p: MemoryPeer) => p.of('rejection').at(-1);
    expect(rej(peers.sync)?.code).toBe('E_FORBIDDEN');
    expect(rej(peers.durable)?.code).toBe('E_FORBIDDEN');
    expect(rej(peers.sync)?.seq).toBe(rej(peers.durable)?.seq);
  });

  it('ПОВТОР: дедуп отвечает одинаково — успешное действие переигрывается снимком, не применяется заново', async () => {
    const now = () => 1000;
    const rooms = twins(now);
    const peers = { sync: new MemoryPeer(), durable: new MemoryPeer() };
    rooms.sync.addPeer('green', peers.sync);
    rooms.durable.addPeer('green', peers.durable);

    const act = orbit(4);
    await bothReceive(rooms, peers, act);
    const seqAfterFirst = {
      sync: peers.sync.of('delta').at(-1)?.seq,
      durable: peers.durable.of('delta').at(-1)?.seq,
    };
    await bothReceive(rooms, peers, act); // тот же actionId

    // Повтор отвечает ПОЛНЫМ снимком (`state`), а не новой дельтой, и seq не растёт.
    expect(peers.sync.of('state').length).toBe(peers.durable.of('state').length);
    expect(peers.sync.of('state').at(-1)?.seq).toBe(seqAfterFirst.sync);
    expect(peers.durable.of('state').at(-1)?.seq).toBe(seqAfterFirst.durable);
  });

  it('НАБЛЮДЕНИЯ: тот же порядок и те же поля, durable отличается ровно флагом `durable`', async () => {
    const now = () => 1000;
    const seen: { sync: RoomObservation[]; durable: RoomObservation[] } = { sync: [], durable: [] };
    const rooms = {
      sync: createDevMatch(data, { id: 'sync', now, time: now(), observe: (e) => seen.sync.push(e) }),
      durable: createDevMatch(data, {
        id: 'durable',
        now,
        time: now(),
        persist: () => Promise.resolve(),
        observe: (e) => seen.durable.push(e),
      }),
    };
    const peers = { sync: new MemoryPeer(), durable: new MemoryPeer() };
    rooms.sync.addPeer('green', peers.sync);
    rooms.durable.addPeer('green', peers.durable);

    await bothReceive(rooms, peers, orbit(5));

    const shape = (list: RoomObservation[]) =>
      list
        .filter((e) => e.kind === 'action' || (e.kind === 'timing' && e.op === 'submit'))
        .map((e) => (e.kind === 'action' ? `action:${e.type}:${e.ok}:${e.seq}` : 'timing:submit'));
    expect(shape(seen.sync)).toEqual(shape(seen.durable));
    const actionOf = (list: RoomObservation[]) =>
      list.find((e): e is Extract<RoomObservation, { kind: 'action' }> => e.kind === 'action');
    expect(actionOf(seen.sync)?.durable).toBeUndefined();
    expect(actionOf(seen.durable)?.durable).toBe(true);
  });
});

describe('NETA2-8 · оркестрация объявлена ОДИН раз', () => {
  // Сторож против отката: паритет выше проверяет ПОВЕДЕНИЕ, но не мешает завтра снова
  // развести две реализации, которые пока совпадают. Тот же приём, что у
  // `aiProfile.test.ts` и `netClientReuse.test.ts`: утверждение о коде берётся из кода.
  const src = readFileSync('packages/server/src/matchRoom.ts', 'utf8');

  it('редьюсер игрового действия вызывается из ОДНОГО места', () => {
    expect(src.match(/this\.kernel\.applyAction\(/g)).toHaveLength(1);
  });

  /** Тело метода по имени — от его сигнатуры до парной закрывающей скобки. */
  function methodBody(name: string): string {
    const at = [`private ${name}(`, `private async ${name}(`]
      .map((sig) => src.indexOf(sig))
      .find((i) => i > -1) ?? -1;
    expect(at, `метод ${name} не найден`).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = src.indexOf('{', at); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
    }
    throw new Error(`не удалось вырезать тело ${name}`);
  }

  it('КОММИТ ЖИВЁТ В ОДНОМ МЕСТЕ: ни один путь не фиксирует мир сам', () => {
    // Именно это разъезжалось: у двух путей были свои `stateValue = …`, своя рассылка и
    // свой банк наград. Теперь их делает `commitPlan`, а пути только решают КОГДА.
    expect(src).toMatch(/private commitPlan\(/);
    for (const name of ['applyAndBroadcast', 'commitApply']) {
      const body = methodBody(name);
      expect(body, `${name} фиксирует состояние сам`).not.toMatch(/this\.stateValue = /);
      expect(body, `${name} рассылает сам`).not.toMatch(/this\.broadcastState\(/);
      expect(body, `${name} банкует награды сам`).not.toMatch(/this\.observeEndIfNeeded\(/);
      expect(body).toMatch(/this\.commitPlan\(/);
    }
  });

  it('ВЫЧИСЛЕНИЕ ЖИВЁТ В ОДНОМ МЕСТЕ: догон и применение — только в planApply', () => {
    expect(methodBody('planApply')).toMatch(/this\.kernel\.applyAction\(/);
    for (const name of ['applyAndBroadcast', 'commitApply']) {
      expect(methodBody(name)).toMatch(/this\.planApply\(/);
      expect(methodBody(name)).not.toMatch(/this\.computeAdvance\(/);
    }
  });

  it('дедуп-фронт объявлен один раз, а не переписан в каждом пути', () => {
    expect(src).toMatch(/private frontGate\(/);
    expect(src.match(/this\.receipts\.get\(/g)).toHaveLength(1);
  });
});
