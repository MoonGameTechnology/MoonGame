import { describe, expect, it } from 'vitest';
import { HUB_MY_MATCHES, myMatches } from './myMatches';

interface Row {
  matchId: string;
  status?: string;
}
const row = (matchId: string, status = 'ongoing'): Row => ({ matchId, status });
const ids = (v: ReturnType<typeof myMatches<Row>>): string[] =>
  v.kind === 'list' ? v.rows.map((r) => r.matchId) : [];

describe('какие партии — МОИ (ADDR-4)', () => {
  it('мои — те, где у меня МЕСТО; свободные партии сервера сюда не попадают', () => {
    const v = myMatches<Row>({ active: [row('m-1')], available: [row('m-2')] }, HUB_MY_MATCHES);
    expect(ids(v)).toEqual(['m-1']);
  });

  it('АРХИВ — тоже мой, но УБРАННЫЙ С ГЛАЗ: в списке его нет', () => {
    // Иначе «убрал» ничего не значит: партия вернулась бы на главный экран, откуда
    // игрок её только что унёс.
    const v = myMatches<Row>({ active: [row('m-1')], archived: [row('m-old')] }, HUB_MY_MATCHES);
    expect(ids(v)).toEqual(['m-1']);
  });
});

describe('порядок и длина списка (ADDR-4)', () => {
  it('ЖИВЫЕ ВПЕРЕДИ ЗАКОНЧЕННЫХ: доигранная партия не теснит ту, где идёт война', () => {
    const v = myMatches<Row>(
      { active: [row('m-done', 'ended'), row('m-live'), row('m-done2', 'ended'), row('m-live2')] },
      HUB_MY_MATCHES,
    );
    expect(ids(v)).toEqual(['m-live', 'm-live2', 'm-done']);
  });

  it('внутри группы порядок сервера сохраняется — он уже отсортирован по новизне', () => {
    const v = myMatches<Row>({ active: [row('a'), row('b'), row('c')] }, HUB_MY_MATCHES);
    expect(ids(v)).toEqual(['a', 'b', 'c']);
  });

  it('ГЛАВНЫЙ ЭКРАН — НЕ ВТОРОЙ БРАУЗЕР: сверх капа считаем остаток, а не рисуем', () => {
    const v = myMatches<Row>({ active: [row('a'), row('b'), row('c'), row('d'), row('e')] }, 3);
    expect(ids(v)).toEqual(['a', 'b', 'c']);
    expect(v.kind === 'list' && v.more).toBe(2);
  });

  it('ровно по капу — остатка нет', () => {
    const v = myMatches<Row>({ active: [row('a'), row('b'), row('c')] }, 3);
    expect(v.kind === 'list' && v.more).toBe(0);
  });

  it('неположительный кап не прячет всё молча — показываем хотя бы одну', () => {
    const v = myMatches<Row>({ active: [row('a'), row('b')] }, 0);
    expect(ids(v)).toEqual(['a']);
    expect(v.kind === 'list' && v.more).toBe(1);
  });
});

describe('когда списка нет (ADDR-4)', () => {
  it('НЕИЗВЕСТНО ≠ ПУСТО: лента не пришла — не утверждаем, что партий нет', () => {
    // «У вас нет партий» поверх трёх идущих — это ложь, из-за которой игрок пойдёт
    // заводить четвёртую.
    expect(myMatches<Row>(null, HUB_MY_MATCHES)).toEqual({ kind: 'unknown' });
  });

  it('лента пришла, своих партий нет — это отдельное состояние, а не пустой список', () => {
    expect(myMatches<Row>({ active: [], available: [row('m-2')] }, HUB_MY_MATCHES)).toEqual({
      kind: 'none',
    });
  });

  it('сервер не прислал вкладку вовсе — это «нет своих», а не поломка', () => {
    expect(myMatches<Row>({}, HUB_MY_MATCHES)).toEqual({ kind: 'none' });
  });
});
