import { describe, it, expect } from 'vitest';
import {
  castOptions,
  cooldownLeftH,
  heroAboard,
  heroAlive,
  isCastable,
  isRanged,
  type AbilitySpec,
  type HeroAboard,
} from './heroCasts';

const ЧАС = 3600_000;
const КАСТУЕМЫЕ = new Set(['strike', 'scan', 'spawn_fleet']);
const герой = (over: Partial<HeroAboard> = {}): HeroAboard => ({
  id: 'h1',
  fleetId: 'f1',
  ...over,
});
const умение = (over: Partial<AbilitySpec> = {}): AbilitySpec => ({
  id: 'a1',
  type: 'strike',
  ...over,
});

describe('каст героя — чей это герой', () => {
  it('ГЕРОЙ ДОЛЖЕН БЫТЬ НА БОРТУ ВЫБРАННОГО ФЛОТА: иначе приказ уедет в отказ', () => {
    expect(heroAboard([герой({ fleetId: 'чужой' })], ['f1'])).toBeNull();
    expect(heroAboard([герой()], ['f1'])?.id).toBe('h1');
  });

  it('МЁРТВЫЙ ГЕРОЙ КАСТОВ НЕ ДАЁТ', () => {
    expect(heroAboard([герой({ alive: false })], ['f1'])).toBeNull();
  });

  it('НЕТ ПОЛЯ «ЖИВ» — ЗНАЧИТ ЖИВ: старые матчи не должны разом лишиться героев', () => {
    expect(heroAlive(герой())).toBe(true);
    expect(heroAboard([герой()], ['f1'])?.id).toBe('h1');
  });

  it('герой без флота — не флагман группы', () => {
    expect(heroAboard([герой({ fleetId: undefined })], ['f1'])).toBeNull();
  });

  it('из нескольких подходящих берётся первый — порядок задаёт вызывающий', () => {
    const list = [герой({ id: 'a', fleetId: 'f2' }), герой({ id: 'b', fleetId: 'f1' })];
    expect(heroAboard(list, ['f1', 'f2'])?.id).toBe('a');
  });

  it('пустая группа — нет флагмана', () => {
    expect(heroAboard([герой()], [])).toBeNull();
  });
});

describe('каст героя — что попадает в меню', () => {
  it('НЕ ВСЯКАЯ СПОСОБНОСТЬ КАСТУЕТСЯ: пассивки и ауры в меню не идут', () => {
    expect(isCastable('aura', КАСТУЕМЫЕ)).toBe(false);
    expect(isCastable('strike', КАСТУЕМЫЕ)).toBe(true);
    expect(isCastable(undefined, КАСТУЕМЫЕ)).toBe(false);
  });

  it('пустой слот — не способность', () => {
    expect(castOptions([null, умение()], КАСТУЕМЫЕ, 0, ЧАС).map((o) => o.id)).toEqual(['a1']);
  });

  it('некастуемая способность отсеивается вместе со своим кулдауном', () => {
    expect(castOptions([умение({ type: 'aura' })], КАСТУЕМЫЕ, 0, ЧАС)).toEqual([]);
  });

  it('порядок способностей сохраняется — это порядок слотов героя', () => {
    const list = castOptions(
      [умение({ id: 'x' }), умение({ id: 'y', type: 'scan' })],
      КАСТУЕМЫЕ,
      0,
      ЧАС,
    );
    expect(list.map((o) => o.id)).toEqual(['x', 'y']);
  });
});

describe('каст героя — кулдаун и прицел', () => {
  it('КУЛДАУН НЕ БЫВАЕТ ОТРИЦАТЕЛЬНЫМ: иначе готовая способность покажет «через −3 ч»', () => {
    expect(cooldownLeftH(-3 * ЧАС, 0, ЧАС)).toBe(0);
    expect(cooldownLeftH(undefined, 5 * ЧАС, ЧАС)).toBe(0);
  });

  it('остаток считается от «сейчас», а не от нуля', () => {
    expect(cooldownLeftH(10 * ЧАС, 4 * ЧАС, ЧАС)).toBe(6);
  });

  it('ДАЛЬНОБОЙНАЯ ТРЕБУЕТ ПРИЦЕЛА, ближняя бьёт по себе', () => {
    expect(isRanged(120)).toBe(true);
    expect(isRanged(0)).toBe(false);
    expect(isRanged(undefined)).toBe(false);
  });

  it('пункт меню несёт и кулдаун, и признак прицела', () => {
    const [opt] = castOptions([умение({ range: 90, readyAt: 8 * ЧАС })], КАСТУЕМЫЕ, 2 * ЧАС, ЧАС);
    expect(opt).toEqual({ id: 'a1', cdH: 6, ranged: true });
  });
});
