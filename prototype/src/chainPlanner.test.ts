// 24 теста: жесты/меню/таймлайн/разметка режима «Приказ» (CHAIN-UX).
import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import {
  applyMenuAction,
  chainMenuHtml,
  chainMenuItems,
  chainStripHtml,
  chainTimeline,
  draftFinish,
  draftFrom,
  emptyDraft,
  stepGlyph,
  stepHours,
  undoGesture,
  type ChainDraft,
  type ChainPoint,
} from './chainPlanner';
import { MAX_CHAIN_STEPS, MAX_CHAIN_WAIT_HOURS, type ChainStep } from './chain';

beforeAll(() => setLocale('ru')); // под Node рантайм иначе фолбэчится в EN

const own: ChainPoint = { id: 'A', kind: 'own' };
const enemy: ChainPoint = { id: 'B', kind: 'enemy' };
const foe: ChainPoint = { id: 'f-9', kind: 'fleet' };
const opts = { capturable: true, hasArtillery: true, abilities: [] };

describe('черновик и жесты', () => {
  it('финиш маршрута — последний перелёт, иначе старт', () => {
    expect(draftFinish([], 'S')).toBe('S');
    expect(draftFinish([{ kind: 'move', to: 'A' }, { kind: 'wait', hours: 1 }], 'S')).toBe('A');
  });

  it('префилл живого плана — ОДИН жест: ⟲ снимает его целиком', () => {
    const d = draftFrom([{ kind: 'move', to: 'A' }, { kind: 'assault' }]);
    expect(d.gestures).toEqual([2]);
    expect(undoGesture(d).steps).toEqual([]);
  });

  it('действие в чужой точке само дописывает перелёт к ней (одним жестом)', () => {
    const d = applyMenuAction(emptyDraft(), 'assault', enemy, 'S')!;
    expect(d.steps).toEqual([{ kind: 'move', to: 'B' }, { kind: 'assault' }]);
    expect(d.gestures).toEqual([2]);
    expect(undoGesture(d).steps).toEqual([]); // курс+штурм уходят одной кнопкой
  });

  it('«Курс» в точку-финиш бессмыслен — null (пункт серый)', () => {
    const d = applyMenuAction(emptyDraft(), 'move', { id: 'S', kind: 'own' }, 'S');
    expect(d).toBeNull();
  });

  it('повторный ⏱ растит ПОСЛЕДНЮЮ задержку, не плодя шагов', () => {
    let d = applyMenuAction(emptyDraft(), 'wait', own, 'A')!; // уже на месте — без move
    d = applyMenuAction(d, 'wait', own, 'A')!;
    d = applyMenuAction(d, 'wait6', own, 'A')!;
    expect(d.steps).toEqual([{ kind: 'wait', hours: 8 }]);
    expect(d.gestures).toEqual([1]);
  });

  it('часы клампятся капом ядра, на капе — null', () => {
    let d: ChainDraft = { steps: [{ kind: 'wait', hours: MAX_CHAIN_WAIT_HOURS - 2 }], gestures: [1] };
    d = applyMenuAction(d, 'wait6', own, 'A')!;
    expect((d.steps[0] as { hours: number }).hours).toBe(MAX_CHAIN_WAIT_HOURS);
    expect(applyMenuAction(d, 'wait', own, 'A')).toBeNull();
  });

  it('огонь по флоту — strike с целью, повторный тап растит окно', () => {
    let d = applyMenuAction(emptyDraft(), 'fire', foe, 'S')!;
    expect(d.steps).toEqual([{ kind: 'strike', target: 'f-9', hours: 1 }]);
    d = applyMenuAction(d, 'fire', foe, 'S')!;
    expect((d.steps[0] as { hours: number }).hours).toBe(2);
  });

  it('огонь у мира — strike по авто-цели ПОСЛЕ перелёта туда', () => {
    const d = applyMenuAction(emptyDraft(), 'fire', enemy, 'S')!;
    expect(d.steps).toEqual([
      { kind: 'move', to: 'B' },
      { kind: 'strike', target: null, hours: 1 },
    ]);
  });

  it('кап 8 шагов: жест, который не влезает, не применяется', () => {
    const steps: ChainStep[] = Array.from({ length: MAX_CHAIN_STEPS - 1 }, (_, i) => ({
      kind: 'move',
      to: `W${i}`,
    }));
    const d: ChainDraft = { steps, gestures: [steps.length] };
    // штурм в новой точке = move+assault = 2 слота, а остался 1
    expect(applyMenuAction(d, 'assault', enemy, 'S')).toBeNull();
    // а одиночный перелёт в 1 слот — влезает
    expect(applyMenuAction(d, 'move', enemy, 'S')!.steps).toHaveLength(MAX_CHAIN_STEPS);
  });

  it('способность: дальняя несёт мир-цель, ближняя — нет', () => {
    const ranged = { id: 'scan', name: 'Скан', cdH: 0, ranged: true };
    const selfCast = { id: 'veil', name: 'Вуаль', cdH: 0, ranged: false };
    expect(applyMenuAction(emptyDraft(), 'ability', enemy, 'S', ranged)!.steps).toEqual([
      { kind: 'ability', abilityId: 'scan', target: 'B' },
    ]);
    expect(applyMenuAction(emptyDraft(), 'ability', enemy, 'S', selfCast)!.steps).toEqual([
      { kind: 'ability', abilityId: 'veil' },
    ]);
  });
});

describe('меню точки — «в зависимости от того, что это»', () => {
  it('свой мир: курс и задержки, без штурма и огня', () => {
    const acts = chainMenuItems(emptyDraft(), own, 'S', opts).map((i) => i.act);
    expect(acts).toEqual(['move', 'wait', 'wait6']);
  });

  it('вражеский capturable-мир добавляет штурм и огонь', () => {
    const acts = chainMenuItems(emptyDraft(), enemy, 'S', opts).map((i) => i.act);
    expect(acts).toEqual(['move', 'wait', 'wait6', 'assault', 'fire']);
  });

  it('вражеский флот — только огонь', () => {
    const acts = chainMenuItems(emptyDraft(), foe, 'S', opts).map((i) => i.act);
    expect(acts).toEqual(['fire']);
  });

  it('без артиллерии огонь серый, и причина написана в пункте', () => {
    const fire = chainMenuItems(emptyDraft(), foe, 'S', { ...opts, hasArtillery: false })[0]!;
    expect(fire.disabled).toBe(true);
    expect(fire.why).toBe('в выделении нет артиллерии');
  });

  it('способность на кулдауне серая, с бейджем остатка', () => {
    const items = chainMenuItems(emptyDraft(), own, 'S', {
      ...opts,
      abilities: [{ id: 'scan', name: 'Скан', cdH: 3, ranged: true }],
    });
    const ab = items.find((i) => i.act === 'ability')!;
    expect(ab.disabled).toBe(true);
    expect(ab.label).toContain('Скан');
  });

  it('пункты наращивания часов помечены keep — меню не закрывается', () => {
    const items = chainMenuItems(emptyDraft(), enemy, 'S', opts);
    expect(items.find((i) => i.act === 'wait')!.keep).toBe(true);
    expect(items.find((i) => i.act === 'fire')!.keep).toBe(true);
    expect(items.find((i) => i.act === 'assault')!.keep).toBeUndefined();
  });
});

describe('таймлайн — время до исполнения', () => {
  const travel = (from: string, to: string) => (from === 'S' && to === 'A' ? 2 : 1.5);

  it('накапливает перелёты, задержки и холд способности', () => {
    const tl = chainTimeline(
      [
        { kind: 'move', to: 'A' },
        { kind: 'wait', hours: 4 },
        { kind: 'move', to: 'B' },
        { kind: 'ability', abilityId: 'scan' },
        { kind: 'assault' },
      ],
      'S',
      0,
      travel,
      () => 0.5,
    );
    expect(tl.map((p) => p.endH)).toEqual([2, 6, 7.5, 8, 8]);
    expect(tl.map((p) => p.pointId)).toEqual(['A', 'A', 'B', 'B', 'B']);
  });

  it('baseH сдвигает всё: летящий флот начнёт план по прилёте', () => {
    const tl = chainTimeline([{ kind: 'wait', hours: 1 }], 'A', 3, travel, () => 0);
    expect(tl[0]!.endH).toBe(4);
  });

  it('взведённая голова: headRemH заменяет полные часы ПЕРВОГО wait', () => {
    const tl = chainTimeline(
      [
        { kind: 'wait', hours: 10 },
        { kind: 'wait', hours: 10 },
      ],
      'A',
      0,
      travel,
      () => 0,
      2.5,
    );
    expect(tl.map((p) => p.endH)).toEqual([2.5, 12.5]);
  });

  it('маршрута нет — времена хвоста честно null, не ноль', () => {
    const tl = chainTimeline(
      [
        { kind: 'move', to: 'X' },
        { kind: 'wait', hours: 5 },
      ],
      'S',
      0,
      () => null,
      () => 0,
    );
    expect(tl.map((p) => p.endH)).toEqual([null, null]);
  });
});

describe('разметка', () => {
  it('полоска: счётчик, кнопки, ETA-слот ВНЕ текстового содержимого', () => {
    const html = chainStripHtml({
      fleets: 2,
      count: 3,
      cap: 8,
      canUndo: true,
      canHome: true,
      clearMode: false,
      canSend: true,
      overwrite: true,
    });
    expect(html).toContain('3/8');
    expect(html).toContain('class="ch-eta"'); // патчится textContent, не в сигнатуре
    expect(html).toContain('data-cmd="chundo"');
    expect(html).toContain('data-cmd="chhome"');
    expect(html).toContain('data-cmd="chsend"');
    expect(html).toContain('data-cmd="chexit"');
    expect(html).toContain('chwarn'); // ⚠ разные планы группы
    expect(html).toContain('2 флотов');
  });

  it('пустой черновик: подсказка вместо счётчика, ✓ превращается в «снять приказ»', () => {
    const html = chainStripHtml({
      fleets: 1,
      count: 0,
      cap: 8,
      canUndo: false,
      canHome: false,
      clearMode: true,
      canSend: true,
      overwrite: false,
    });
    expect(html).toContain('chhint');
    expect(html).toContain('снять приказ');
    expect(html).toContain('data-cmd="chundo"');
    expect(html).toContain('disabled');
  });

  it('меню точки: data-ch на пунктах, keep помечен data-keep', () => {
    const html = chainMenuHtml('ПРИКАЗ', 'B · 2/8', chainMenuItems(emptyDraft(), enemy, 'S', opts));
    expect(html).toContain('data-ch="move"');
    expect(html).toContain('data-ch="assault"');
    expect(html).toContain('data-ch="wait" data-keep="1"');
    expect(html).toContain('B · 2/8');
  });

  it('глифы и подписи часов шагов', () => {
    expect(stepGlyph({ kind: 'move', to: 'A' })).toBe('✈');
    expect(stepGlyph({ kind: 'assault' })).toBe('⚔');
    expect(stepHours({ kind: 'wait', hours: 4 })).toBe('⏱4ч');
    expect(stepHours({ kind: 'strike', target: null, hours: 2 })).toBe('🎯2ч');
    expect(stepHours({ kind: 'assault' })).toBe('');
  });
});
