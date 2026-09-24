// CMD-VIS — сторож правила «нет приказа — нет кнопки».
//
// Заказ владельца: недоступный приказ не серый и не тостит отказом — кнопки просто
// НЕТ. Источник правды у видимости один — та же проба ядра (`canOrder`), которой
// решается и сам приказ; рукописных предикатов у кнопки быть не должно, иначе они
// разъедутся с ядром при первом же новом правиле (как разъехались с коридором:
// «а движется ли флот» не знал, что в коридоре остановки не бывает).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { advance, canOrder, newGame, order, HOUR } from './game';
import { moveFleet, stopFleet } from '../../decisions/actions';
import { canAssaultAim } from '../../decisions/cmdAvailability';

/** Живое состояние прототипа: свой флот стоит дома. */
const base = () => {
  const s = newGame();
  const f = Object.values(s.fleets).find((x) => x.owner === 'p1')!;
  return { s, f };
};

/** Флот в пути: настоящий приказ через ядро прототипа + мгновение времени. */
function underway(s: ReturnType<typeof newGame>, fleetId: string, to: string) {
  const sent = order(s, moveFleet('p1', fleetId, to), s.time);
  if (sent.error) throw new Error(`move failed: ${sent.error}`);
  const later = advance(sent.state, sent.state.time + 1);
  const mv = later.state.fleets[fleetId]?.movement;
  if (!mv) throw new Error('fleet did not depart');
  return later.state;
}

describe('CMD-VIS — проба, на которой стоит кнопка «Стоп»', () => {
  it('стоящему флоту стоп недоступен → кнопки нет', () => {
    const { s, f } = base();
    expect(canOrder(s, stopFleet('p1', f.id))).toBe('E_FLEET_BUSY');
  });

  it('флоту в пути по обычной лейне стоп доступен → кнопка есть', () => {
    const { s, f } = base();
    const st = underway(s, f.id, s.planets[f.location!]!.links![0]!);
    expect(canOrder(st, stopFleet('p1', f.id))).toBe(null);
  });

  it('флоту В КОРИДОРЕ стоп недоступен: вошёл в прыжок — доезжай', () => {
    const { s, f } = base();
    const home = f.location!;
    const to = s.planets[home]!.links![0]!;
    // Ребро дома→сосед объявляется КОРИДОРНЫМ (addedLink): у прыжка нет середины.
    s.tempLanes = [
      {
        id: 'lane:cv',
        owner: 'p1',
        from: home,
        to,
        speedBonus: 0,
        expiresAt: s.time + 99 * HOUR,
        addedLink: true,
      },
    ];
    const st = underway(s, f.id, to);
    expect(canOrder(st, stopFleet('p1', f.id))).toBe('E_NOT_A_LANE');
  });
});

describe('CMD-VIS — кнопка и обработчик подключены к пробе', () => {
  it('main.ts решает и видимость «Стопа», и рассылку в группе через canOrder', () => {
    // main.ts — DOM-вход без юнит-харнеса; правило держится, только если ОБА места
    // (сборка ряда команд и обработчик клика) спрашивают ядро, а не свой if.
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const probes = src.match(/canOrder\(s, stopFleet\(ME, /g) ?? [];
    expect(probes.length).toBeGreaterThanOrEqual(2);
    // Рукописного предиката «а движется ли флот» у стопа больше нет.
    expect(src).not.toContain('if (s.fleets[id]?.movement) playerOrder(stopFleet');
  });
});

// Заказ владельца 2026-09-21: «кнопка штурм появляется только если есть во флоте кем
// штурмовать». Тот же CMD-VIS, только проба не у ядра: приказ издаётся ПОСЛЕ выбора
// цели, спросить про мир нечего — поэтому правило про СОСТАВ живёт чистой функцией
// (`decisions/cmdAvailability.canAssaultAim`), а сторож ниже держит её подключение.
describe('CMD-VIS — штурм спрашивает десант, а не корабли', () => {
  const total = (stacks: ReadonlyArray<{ count: number }> = []): number =>
    stacks.reduce((n, st) => n + st.count, 0);

  it('у стартового флота есть корабли, но штурмовать ими некого', () => {
    const { f } = base();
    // Если однажды стартовый состав изменится и десант появится — тест это заметит, и
    // менять надо будет не правило, а фикстуру.
    expect(total(f.units)).toBeGreaterThan(0);
    expect(canAssaultAim([total(f.landing)])).toBe(false);
  });

  it('погрузили десант — штурмовать стало кем', () => {
    const { f } = base();
    const withTroops = { ...f, landing: [{ unit: 'militia', count: 2 }] };
    expect(canAssaultAim([total(withTroops.landing)])).toBe(true);
  });

  it('main.ts даёт кнопке ряда именно ДЕСАНТ выделения и прячет её без него', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain('troops: canAssaultAim(fleets.map((f) => sumUnits(f.landing ?? [])))');
    expect(src).toContain('shown.assault');
    // Прежний предикат считал КОРАБЛИ — с ним кнопка горела у эскадры без десанта.
    expect(src).not.toMatch(/canAssault =[\s\S]{0,120}sumUnits\(f\.units\)/);
  });
});

// CMD-VIS-3 (заказ владельца 2026-09-24): «Если сливать нечего, то и кнопки "слить" не
// должно отображаться», «то же самое с кнопкой десант».
describe('CMD-VIS-3 — «Слить» и «Десант» по составу', () => {
  it('main.ts прячет «Слить» без напарника и «Десант» без меню, а не гасит их', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain('mergeable: mergeOk,');
    expect(src).toContain('troopsMenu: !!troopsIn,');
    expect(src).toMatch(/\(shown\.merge\s*\?\s*cmdBtn\(\s*'merge'/);
    expect(src).toMatch(/\(shown\.troops\s*\?\s*cmdBtn\(\s*'troops'/);
    // Кнопки без условия показа больше нет — ни у одной из двух.
    expect(src).not.toMatch(/\+\s*cmdBtn\(\s*'merge'/);
    expect(src).not.toMatch(/\+\s*cmdBtn\(\s*'troops'/);
  });
});
