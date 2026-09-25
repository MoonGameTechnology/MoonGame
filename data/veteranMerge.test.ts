/**
 * Ветеран — отдельная плитка (решение владельца 2026-09-25): стеки одного корпуса
 * сливаются только при одной степени «Выслуги». Ключ слияния (`serviceKey`) считается без
 * каталога — числом полных пережитых боёв с потолком — и обязан совпадать со степенью
 * линии `service` из ШИПНУТЫХ данных. Правка порогов в `medalGrades.json` без правки ключа
 * должна ронять этот тест, а не молча делить стеки не по степени.
 */
import { describe, expect, it } from 'vitest';
import { medalGrade, serviceKey, SERVICE_MERGE_CAP } from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();

describe('ключ слияния ветеранов = степень «Выслуги» из данных', () => {
  it('потолок ключа — число степеней линии', () => {
    expect(SERVICE_MERGE_CAP).toBe(data.medals.service!.grades.length);
  });

  it('для любого числа боёв ключ равен степени медали', () => {
    for (const battles of [0, 0.5, 1, 1.5, 2, 3, 3.99, 4, 5, 9])
      expect(serviceKey(battles), `боёв ${battles}`).toBe(medalGrade(battles, data.medals.service!.grades));
  });

  it('у Роя ветеранов нет, у игровых фракций — есть', () => {
    expect(data.factions.swarm?.veterans).toBe(false);
    for (const id of ['vanguard', 'azure', 'crimson', 'amber', 'violet'])
      if (data.factions[id]) expect(data.factions[id]!.veterans, id).toBe(true);
  });
});
