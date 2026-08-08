import { describe, it, expect } from 'vitest';
import {
  QUICK_GLANCE_MS,
  briefSince,
  marksAway,
  splitByAttention,
  worthShowing,
  type ReturnState,
} from './awayBrief';

const возврат = (over: Partial<ReturnState> = {}): ReturnState => ({
  awayFromGameTime: 1000,
  inMatch: true,
  awayAtRealMs: 0,
  nowRealMs: QUICK_GLANCE_MS,
  ...over,
});

describe('брифинг возвращения — когда засекаем уход', () => {
  it('УХОД ЗАСЕКАЕТСЯ ТОЛЬКО В МАТЧЕ: свернуть вкладку в хабе — не отлучка из боя', () => {
    expect(marksAway(true, true)).toBe(true);
    expect(marksAway(true, false)).toBe(false);
  });

  it('видимая вкладка ухода не засекает', () => {
    expect(marksAway(false, true)).toBe(false);
  });
});

describe('брифинг возвращения — брифовать ли', () => {
  it('КОРОТКИЙ ОТСКОК БРИФИНГА НЕ ДАЁТ: окно на полэкрана за секундное переключение', () => {
    expect(briefSince(возврат({ nowRealMs: QUICK_GLANCE_MS - 1 }))).toBeNull();
    expect(briefSince(возврат({ nowRealMs: QUICK_GLANCE_MS }))).toBe(1000);
  });

  it('ухода не засекали — брифовать нечего', () => {
    expect(briefSince(возврат({ awayFromGameTime: null }))).toBeNull();
  });

  it('матч закончился, пока игрока не было — брифинга нет', () => {
    expect(briefSince(возврат({ inMatch: false }))).toBeNull();
  });

  it('ТОЧКА ОТСЧЁТА — ИГРОВОЕ ВРЕМЯ УХОДА, а не реальное', () => {
    // реального времени прошло много, но сводка начинается с игрового момента ухода
    expect(briefSince(возврат({ awayFromGameTime: 42, nowRealMs: 10 ** 9 }))).toBe(42);
  });

  it('игровое время ухода ноль — это валидная точка отсчёта, а не «не засекали»', () => {
    expect(briefSince(возврат({ awayFromGameTime: 0 }))).toBe(0);
  });
});

describe('брифинг возвращения — что показываем', () => {
  it('ПУСТОЙ ДАЙДЖЕСТ НЕ ПОКАЗЫВАЕТСЯ: брифинг ни о чём хуже, чем его отсутствие', () => {
    expect(worthShowing(0)).toBe(false);
    expect(worthShowing(1)).toBe(true);
  });

  it('СНАЧАЛА «ВНИМАНИЕ», ПОТОМ ОСТАЛЬНОЕ — иначе важное утонет в списке', () => {
    const items = [
      { text: 'бой', high: true },
      { text: 'добыча', high: false },
      { text: 'захват', high: true },
    ];
    const { hi, lo } = splitByAttention(items);
    expect(hi.map((i) => i.text)).toEqual(['бой', 'захват']);
    expect(lo.map((i) => i.text)).toEqual(['добыча']);
  });

  it('порядок внутри групп сохраняется — его задаёт сама сводка', () => {
    const items = [
      { text: 'a', high: false },
      { text: 'b', high: false },
    ];
    expect(splitByAttention(items).lo.map((i) => i.text)).toEqual(['a', 'b']);
  });

  it('одни рутинные события — раздел «внимание» пуст', () => {
    expect(splitByAttention([{ high: false }]).hi).toEqual([]);
  });

  it('пустой список делится в две пустые группы', () => {
    expect(splitByAttention([])).toEqual({ hi: [], lo: [] });
  });
});
