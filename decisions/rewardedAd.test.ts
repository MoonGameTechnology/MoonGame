import { describe, expect, it } from 'vitest';
import { initialRewarded, rewardedStep, type RewardedEvent } from './rewardedAd';

/** Прогнать колбэки площадки по порядку и вернуть итог. */
const run = (...events: RewardedEvent[]) => events.reduce(rewardedStep, initialRewarded);

describe('YAG-3.1 — исход rewarded-ролика по колбэкам площадки', () => {
  it('досмотрел и закрыл — `ok`', () => {
    expect(run('open', 'rewarded', 'close').outcome).toBe('ok');
  });

  it('ЗАКРЫЛ РАНЬШЕ НАГРАДЫ — `cancelled`: закрытие ролика наградой не является', () => {
    // Ровно та ошибка, ради которой правило вынесено: `onClose` приходит и тогда, когда
    // игрок нажал крестик. Выдать за него награду — раздать товар за ничего.
    expect(run('open', 'close').outcome).toBe('cancelled');
  });

  it('пока ролик не закрыт — исхода нет, даже после награды', () => {
    // Награду выдаёт игра, и выдаёт её ПОСЛЕ ролика: иначе окно покупки или анимация
    // выдачи всплыли бы под рекламой.
    expect(run('open').outcome).toBeNull();
    expect(run('open', 'rewarded').outcome).toBeNull();
  });

  it('ролик не загрузился — `unavailable`: игрок не отказывался, рекламы просто нет', () => {
    expect(run('error').outcome).toBe('unavailable');
    expect(run('open', 'error').outcome).toBe('unavailable');
  });

  it('сбой ПОСЛЕ награды — всё равно `ok`: заработанное не отнимается', () => {
    expect(run('open', 'rewarded', 'error').outcome).toBe('ok');
  });

  it('исход один: колбэки после него ничего не меняют', () => {
    // Площадка может прислать `onError` вслед за `onClose` или повторить `onClose`.
    // Второй исход означал бы вторую выдачу или отзыв уже выданного.
    expect(run('open', 'close', 'rewarded', 'close').outcome).toBe('cancelled');
    expect(run('open', 'rewarded', 'close', 'error').outcome).toBe('ok');
    expect(run('error', 'rewarded', 'close').outcome).toBe('unavailable');
  });

  it('открытие ролика запоминается — по нему хост снимает паузу звука', () => {
    expect(run().opened).toBe(false);
    expect(run('open').opened).toBe(true);
    // Не открылся — и паузу снимать не с чего: звук не глушили.
    expect(run('error').opened).toBe(false);
  });

  it('СРОК ДО ОТКРЫТИЯ ВЫШЕЛ — `unavailable` (AUD-28): ролик, который так и не начался', () => {
    // Без срока SDK, не приславший ни одного колбэка, держал кнопки рекламы мёртвыми
    // до конца сессии: флаг «ролик идёт» не снимался никогда.
    expect(run('timeout').outcome).toBe('unavailable');
  });

  it('ролик уже на экране — срок не действует: исход даст закрытие', () => {
    expect(run('open', 'timeout').outcome).toBeNull();
    expect(run('open', 'timeout', 'rewarded', 'close').outcome).toBe('ok');
  });

  it('шаг чистый: вход не мутируется', () => {
    const before = run('open');
    const snapshot = JSON.stringify(before);
    rewardedStep(before, 'rewarded');
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
