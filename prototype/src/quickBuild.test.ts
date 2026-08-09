import { describe, it, expect } from 'vitest';
import { parseBuildAnchor, quickBuildOrder, type QuickBuildGates } from './quickBuild';

const ВСЁ_ХОРОШО: QuickBuildGates = {
  worldOwner: 'p1',
  me: 'p1',
  sectorAllows: true,
  locked: false,
};
const заказ = (raw: string | undefined, g: Partial<QuickBuildGates> = {}) =>
  quickBuildOrder(raw, { ...ВСЁ_ХОРОШО, ...g });

describe('быстрый заказ — разбор якоря', () => {
  it('пара kind:id разбирается', () => {
    expect(parseBuildAnchor('building:mine')).toEqual({ kind: 'building', id: 'mine' });
    expect(parseBuildAnchor('unit:cruiser')).toEqual({ kind: 'unit', id: 'cruiser' });
  });

  it('ОБРЕЗАННЫЙ ЯКОРЬ — НЕ ЗАКАЗ: иначе правый клик закажет «что-нибудь»', () => {
    expect(parseBuildAnchor('building')).toBeNull();
    expect(parseBuildAnchor('building:')).toBeNull();
    expect(parseBuildAnchor(':mine')).toBeNull();
    expect(parseBuildAnchor('')).toBeNull();
    expect(parseBuildAnchor(undefined)).toBeNull();
  });

  it('неизвестный вид не проходит', () => {
    expect(parseBuildAnchor('ship:cruiser')).toBeNull();
  });
});

describe('быстрый заказ — чей мир', () => {
  it('свой мир — заказ проходит', () => {
    expect(заказ('building:mine')).toEqual({ kind: 'building', id: 'mine' });
  });

  it('ЧУЖОЙ МИР ЧУЖОЙ И ДЛЯ ПРАВОГО КЛИКА', () => {
    expect(заказ('building:mine', { worldOwner: 'p2' })).toBeNull();
  });

  it('мир не выбран — заказывать некуда', () => {
    expect(заказ('building:mine', { worldOwner: null })).toBeNull();
  });
});

describe('быстрый заказ — гейты здания', () => {
  it('сектор не разрешает — заказа нет', () => {
    expect(заказ('building:mine', { sectorAllows: false })).toBeNull();
  });

  it('ЗАНЯТОЕ МЕСТО НЕ ЗАКАЗЫВАЕТСЯ ВТОРОЙ РАЗ: двойной клик успевал до перерисовки', () => {
    expect(заказ('building:mine', { locked: true })).toBeNull();
  });

  it('ГЕЙТЫ СЕКТОРА И ЗАНЯТОСТИ — ПРО ЗДАНИЯ: у юнитов своя очередь и нет лимита', () => {
    expect(заказ('unit:cruiser', { sectorAllows: false, locked: true })).toEqual({
      kind: 'unit',
      id: 'cruiser',
    });
  });

  it('чужой мир перекрывает и юнита — владелец проверяется раньше вида', () => {
    expect(заказ('unit:cruiser', { worldOwner: 'p2' })).toBeNull();
  });
});
