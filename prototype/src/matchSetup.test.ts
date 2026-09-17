// BRW-0 — режим партии пишется В СОСТОЯНИЕ, и вот зачем.
//
// Прото-хост раньше поднимал все сессии одним шаблоном, поэтому «режим партии» нигде и
// не жил. Как только он появился, встал вопрос — ГДЕ: в `MatchConfig` хоста или в
// `GameState`. Ответ решает рестарт: durable-снапшот несёт РОВНО состояние
// (`MatchSnapshot.state`), список живых партий хост берёт из стора, и комнату он
// поднимает заново. Режим, живший бы только в конфиге, испарился бы вместе с процессом —
// PvE-сессия вернулась бы с базовыми правилами, но с уже накопленным `state.pve`. Это и
// есть «правила поменялись под матчем», которые `resolveMatchConfig` отказывается
// допускать для неизвестного режима; допустить их через чёрный ход было бы странно.
import { describe, expect, it } from 'vitest';
import { newGame, type SetupConfig } from './matchSetup';
import { START_CANDIDATES } from './map';

const seats: SetupConfig['seats'] = [
  { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
  { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
];

describe('BRW-0 — режим сессии в состоянии', () => {
  it('заданный режим попадает в состояние', () => {
    expect(newGame({ seats, modeId: 'pve_waves' }).modeId).toBe('pve_waves');
  });

  it('без режима поля НЕТ — это не то же самое, что пустая строка', () => {
    // Лента браузера читает молчание как «режим неизвестен» и строку не отсеивает
    // (правило 3 `matchRow.ts`). Пустое поле сломало бы именно это различение.
    const state = newGame({ seats });
    expect(state.modeId).toBeUndefined();
    expect('modeId' in state).toBe(false);
  });

  it('режим переживает сериализацию — то, ради чего он и лежит в состоянии', () => {
    // `GameState` хранится как JSONB, и рестарт поднимает партию ровно из этого.
    const restored = JSON.parse(JSON.stringify(newGame({ seats, modeId: 'duel' })));
    expect(restored.modeId).toBe('duel');
  });

  it('режим и карта — независимые оси: браузер фильтрует по каждой отдельно', () => {
    const pve = newGame({ seats, mapId: 'frontier-50', modeId: 'pve_waves' });
    const pvp = newGame({ seats, modeId: 'standard' });
    expect([pve.mapId, pve.modeId]).toEqual(['frontier-50', 'pve_waves']);
    expect([pvp.mapId, pvp.modeId]).toEqual(['nexus', 'standard']);
  });
});
