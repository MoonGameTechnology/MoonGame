import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import type { MissionRow } from '../../decisions/missionView';
import { captiveStepHtml, chapterChainHtml, missionPanelHtml } from './missionPanel';

beforeAll(() => setLocale('ru'));

const row = (over: Partial<MissionRow> = {}): MissionRow => ({
  id: 'mission.training-recon',
  kind: 'control',
  done: 2,
  total: 5,
  complete: false,
  reward: { research: 30, warrants: 4 },
  targets: [],
  failed: false,
  ...over,
});

describe('панель задач забега (REFM-203)', () => {
  it('задача без цели — строка со счётом, подписью с {n} и наградой обеими валютами', () => {
    const html = missionPanelHtml([row()], false);
    expect(html).toContain('Задачи экспедиции');
    expect(html).toContain('Данные и варранты — на итогах экспедиции.');
    expect(html).toContain('<div class="mp-row">');
    expect(html).toContain('опознать весь полигон — 5 провинций');
    expect(html).toContain('<b class="mp-prog">2/5</b>');
    expect(html).toContain('◇ +30');
    expect(html).toContain('⌖ +4');
    expect(html).not.toContain('data-mission-go');
  });

  it('задача с целью на карте — кнопка «На карте» с id задачи', () => {
    const html = missionPanelHtml([row({ targets: ['p7'] })], false);
    expect(html).toContain('<button type="button" class="mp-row" data-mission-go="mission.training-recon">');
    expect(html).toContain('На карте');
  });

  it('полигон награды не обещает и говорит свою подсказку', () => {
    const html = missionPanelHtml([row()], true);
    expect(html).toContain('Дополнительные задачи: победу не определяют.');
    expect(html).not.toContain('mp-reward');
  });

  it('проваленная задача говорит «провалено», а не висит 0/1', () => {
    const html = missionPanelHtml([row({ done: 0, total: 1, failed: true })], false);
    expect(html).toContain('<div class="mp-row failed">');
    expect(html).toContain('<b class="mp-prog">провалено</b>');
    expect(html).toContain('✗');
  });

  it('выполненная — галочка и приглушённая строка', () => {
    const html = missionPanelHtml([row({ done: 5, complete: true })], false);
    expect(html).toContain('<div class="mp-row done">');
    expect(html).toContain('✓');
  });

  it('маяк считает удержание часами забега', () => {
    const html = missionPanelHtml([row({ id: 'mission.training-beacon', kind: 'beacon', holdMs: 60_000, needMs: 288_000 })], false);
    expect(html).toMatch(/<b class="mp-prog">[^<]+\/[^<]+<\/b>/);
    expect(html).not.toContain('<b class="mp-prog">2/5</b>');
  });

  it('спасение героя — обещает корабль сразу', () => {
    const html = missionPanelHtml([row({ kind: 'recruit' })], false);
    expect(html).toContain('Корабль героя присоединится сразу после спасения.');
  });

  it('id задачи в атрибуте экранируется', () => {
    const html = missionPanelHtml([row({ id: 'a"b', targets: ['p1'] })], false);
    expect(html).toContain('data-mission-go="a&quot;b"');
  });
});

describe('глава V: пленный и цепочка «звено → очаги» (PVR-9.5, PVR-9.7)', () => {
  const captive = (over: Partial<MissionRow> = {}) =>
    row({ id: 'mission.voice-of-unity', kind: 'captive', done: 0, total: 3, targets: ['hideout'], ...over });
  const loaders = [{ id: 'p1_1', label: '2× Крейсер' }];

  it('пленный: под строкой — следующий шаг задания', () => {
    expect(captiveStepHtml(captive(), loaders)).toBe(
      '<p class="mp-hint">Взять убежище наземным штурмом; уничтоженный мир погубит пленного</p>',
    );
    expect(captiveStepHtml(captive({ done: 2 }), [])).toContain('Довести носитель до базы');
  });

  it('взят — предупреждение о носителе ДО погрузки и кнопка на каждый флот у убежища', () => {
    const html = captiveStepHtml(captive({ done: 1 }), loaders);
    expect(html).toContain('Принять пленного на борт у убежища');
    expect(html).toContain('<p class="mp-warn">Гибель носителя — провал задания</p>');
    expect(html).toContain('data-captive-load="p1_1">Принять на борт флотом 2× Крейсер</button>');
    // Флота у убежища нет — подсказка без кнопок и без предупреждения.
    expect(captiveStepHtml(captive({ done: 1 }), [])).not.toContain('mp-warn');
  });

  it('доставлен или провален — подсказок нет; другие задачи их не получают', () => {
    expect(captiveStepHtml(captive({ done: 3, complete: true }), loaders)).toBe('');
    expect(captiveStepHtml(captive({ done: 1, failed: true }), loaders)).toBe('');
    expect(captiveStepHtml(row(), loaders)).toBe('');
    expect(missionPanelHtml([captive({ done: 1 })], false, '', loaders)).toContain('data-captive-load');
  });

  it('звено сети — первый шаг цепочки, очаги считают «N/M»', () => {
    const html = chapterChainHtml(
      [
        { id: 'link', key: 'chain.link', done: true, active: false, target: 'w_link' },
        {
          id: 'production',
          key: 'chain.production',
          done: false,
          active: true,
          target: 'focus_west',
          count: { done: 1, total: 3 },
        },
      ],
      [],
    );
    expect(html).toContain('Звено: найти ретранслятор сети Роя');
    expect(html).toContain('<b class="mp-prog">1/3</b>');
    expect(html).toContain('data-chain-go="focus_west"');
  });
});
