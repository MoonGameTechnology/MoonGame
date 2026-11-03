import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetaMatchRewardsView } from '../../packages/protocol/src/metaEconomyView';
import { setLocale } from '../../localization/runtime';
import { createMatchRewardsPanel, matchRewardsHtml } from './metaMatchRewards';

const granted = (): MetaMatchRewardsView => ({
  finalReady: true,
  receipts: [
    {
      id: 'one',
      kind: 'settlement',
      at: 1,
      materials: [{ materialId: 'ferroalloys', quantity: 5, soulbound: false }],
      seasonXp: 20,
      warrants: 10,
      drop: { kind: 'module', defId: 'shield_booster', forced: false },
    },
  ],
});
beforeEach(() => {
  setLocale('ru');
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('already committed match rewards', () => {
  it('explains a defeated fighter reward, half-score gold, final kill rounding and veteran bonus', () => {
    const view = granted();
    view.receipts[0]!.sovereignsGranted = 100;
    view.receipts[0]!.warrants = 12;
    view.receipts[0]!.matchReward = { version: 1, reason: 'eliminated', score: 601, scoreDivisor: 2, maxSovereigns: 100,
      kills: 37, killsPerWarrant: 5, baseWarrants: 5, killWarrants: 7, baseMaterials: 3,
      veteranPoints: 20, veteranMaterials: 2, moduleChance: 0.05 };
    const html = matchRewardsHtml(view, false, false);
    expect(html).toContain('Суверены ◆</span><b>+100</b>');
    expect(html).toContain('не больше 100 ◆ за матч');
    expect(html).toContain('Награда сохранена');
    expect(html).toContain('601 ÷ 2');
    expect(html).toContain('5 за участие + 7');
    expect(html).toContain('Шанс модуля: 5%');
    setLocale('en');
    expect(matchRewardsHtml(view, false, false)).toContain('participation until elimination');
  });

  it('shows a settled inactivity decision instead of suggesting the grant is still pending', () => {
    const view: MetaMatchRewardsView = { finalReady: true, receipts: [{ id: 'denied', kind: 'settlement', at: 1,
      warrants: 0, sovereignsGranted: 0, matchReward: { version: 1, reason: 'inactive', score: 601, scoreDivisor: 2, maxSovereigns: 100,
        kills: 37, killsPerWarrant: 5, baseWarrants: 0, killWarrants: 0, baseMaterials: 0,
        veteranPoints: 0, veteranMaterials: 0, moduleChance: 0.05 } }] };
    const html = matchRewardsHtml(view, false, false);
    expect(html).toContain('участие прекратилось');
    expect(html).not.toContain('Подтверждённой награды пока нет');
    expect(html).not.toContain('+300');
  });
  it('shows materials, season XP, Warrants and the actual item without a claim action', () => {
    const view = granted();
    view.receipts.push(view.receipts[0]!);
    const html = matchRewardsHtml(view, false, false);
    expect(html).toContain('Ферросплавы</span><b>+5</b>');
    expect(html).not.toContain('Ферросплавы</span><b>+10</b>');
    expect(html).toContain('Опыт сезона</span><b>+20</b>');
    expect(html).toContain('Варранты</span><b>+10</b>');
    expect(html).toContain('Находка: Тяжёлый щит');
    expect(html).not.toMatch(/claim|data-es="double"/);
    expect(html).toContain('Выдача не зависит от открытия');
  });

  it('names a hull reward using the unit catalog', () => {
    const view = granted();
    view.receipts[0]!.drop = { kind: 'hull', defId: 'cruiser', forced: false };
    expect(matchRewardsHtml(view, false, false)).toContain('Находка: Крейсер');
  });

  it('distinguishes stage payouts from a final result and makes no promise when empty', () => {
    expect(matchRewardsHtml({ ...granted(), finalReady: false }, false, false)).toContain(
      'Итоговое начисление ещё не подтверждено',
    );
    expect(matchRewardsHtml({ receipts: [], finalReady: false }, false, false)).toContain(
      'Подтверждённой награды пока нет',
    );
  });

  it('performs at most one automatic retry, then waits for an explicit refresh', async () => {
    const read = vi.fn(async () => ({ receipts: [], finalReady: false }));
    const panel = createMatchRewardsPanel({ matchId: () => 'match', read }, () => {});
    panel.show(false);
    expect(read).not.toHaveBeenCalled();
    panel.show(true);
    panel.show(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(panel.html()).toContain('Подтверждённой награды пока нет');
    panel.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('stops retrying after the committed final receipt arrives', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ receipts: [], finalReady: false })
      .mockResolvedValue(granted());
    const panel = createMatchRewardsPanel({ matchId: () => 'match', read }, () => {});
    panel.show(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(panel.html()).toContain('Снабжение получено');
  });

  it('leaving the result cancels retries and ignores a late response', async () => {
    let resolve!: (value: MetaMatchRewardsView) => void;
    const read = vi.fn(
      () =>
        new Promise<MetaMatchRewardsView>((done) => {
          resolve = done;
        }),
    );
    const changed = vi.fn();
    const panel = createMatchRewardsPanel({ matchId: () => 'match', read }, changed);
    panel.show(true);
    panel.show(false);
    resolve(granted());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(panel.html()).toBe('');
    expect(changed).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
  });

  it('an unavailable settlement is a read error and never becomes a granted reward', async () => {
    const read = vi.fn(async () => {
      throw new Error('offline');
    });
    const panel = createMatchRewardsPanel({ matchId: () => 'match', read }, () => {});
    panel.show(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(panel.html()).toContain('Не удалось проверить начисления');
    expect(panel.html()).not.toContain('Снабжение получено');
  });
});
