import { describe, expect, it } from 'vitest';
import { landColumnShown, type LandColumnInput } from './landColumn';

const empty = { used: 0, reserved: 0 };
const input = (over: Partial<LandColumnInput> = {}): LandColumnInput => ({
  holds: [],
  strike: false,
  wingTransfer: false,
  ...over,
});

describe('колонка «Десант» окна флота', () => {
  it('пустой трюм без команд — колонки нет (заказ владельца 2026-09-28)', () => {
    expect(landColumnShown(input())).toBe(false);
    expect(landColumnShown(input({ holds: [empty] }))).toBe(false);
    expect(landColumnShown(input({ holds: [empty, empty] }))).toBe(false);
  });

  it('груз на борту, погрузка в пути или машины в ангаре — колонка есть', () => {
    expect(landColumnShown(input({ holds: [{ used: 2, reserved: 0 }] }))).toBe(true);
    expect(landColumnShown(input({ holds: [{ used: 0, reserved: 1 }] }))).toBe(true);
    // Ангар — второй счётчик того же трюма: войск нет, а челноки на борту.
    expect(landColumnShown(input({ holds: [empty, { used: 3, reserved: 0 }] }))).toBe(true);
  });

  it('при пустом трюме колонку держат команды, которых больше нигде нет', () => {
    expect(landColumnShown(input({ holds: [empty], strike: true }))).toBe(true);
    expect(landColumnShown(input({ wingTransfer: true }))).toBe(true);
  });
});
