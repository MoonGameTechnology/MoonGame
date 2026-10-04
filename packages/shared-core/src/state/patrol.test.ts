/**
 * ПО КОМУ БЬЁТ ПАТРУЛЬ (SHU-6.2) — ближайший контакт в круге, правилом перехвата.
 *
 * Правило досталось патрулю от дежурного вылета (CC-4), который патруль заменил целиком
 * (SHU-6.6): выбор цели у висящей эскадры один.
 */
import { describe, expect, it } from 'vitest';
import { patrolTarget } from './patrol';

const at = (x: number, y: number) => ({ x, y });

describe('SHU-6.2 — выбор цели патруля', () => {
  it('БЛИЖНИЙ РАНЬШЕ ДАЛЬНЕГО — то же правило, что у перехвата (SHU-1.3)', () => {
    const pick = patrolTarget(at(0, 0), 100, [
      { id: 'far', pos: at(90, 0) },
      { id: 'near', pos: at(10, 0) },
    ]);
    expect(pick).toBe('near');
  });

  it('НА РАВНОЙ ДИСТАНЦИИ — МЕНЬШИЙ id: выбор обязан быть детерминирован', () => {
    const pick = patrolTarget(at(0, 0), 100, [
      { id: 'b', pos: at(0, 50) },
      { id: 'a', pos: at(50, 0) },
    ]);
    expect(pick).toBe('a');
  });

  it('ЗА РАДИУСОМ ЦЕЛИ НЕТ: патруль стережёт круг, а не всю карту', () => {
    expect(patrolTarget(at(0, 0), 100, [{ id: 'far', pos: at(101, 0) }])).toBeNull();
  });

  it('ГРАНИЦА ВКЛЮЧИТЕЛЬНА — та же мерка `withinRange`, по которой ядро пускает удар', () => {
    expect(patrolTarget(at(0, 0), 100, [{ id: 'edge', pos: at(100, 0) }])).toBe('edge');
  });

  it('НУЛЕВОЙ РАДИУС НЕ БЬЁТ ВООБЩЕ: патруля без круга не бывает, но и обещать нечего', () => {
    expect(patrolTarget(at(0, 0), 0, [{ id: 'here', pos: at(0, 0) }])).toBeNull();
  });

  it('ПУСТОЙ СПИСОК — НЕ ОШИБКА: врагов в круге нет, удара нет', () => {
    expect(patrolTarget(at(0, 0), 100, [])).toBeNull();
  });
});
