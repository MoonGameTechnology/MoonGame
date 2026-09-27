import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import type { MissionRow } from '../../decisions/missionView';
import { missionPanelHtml } from './missionPanel';

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
