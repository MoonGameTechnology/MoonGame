import { describe, expect, it } from 'vitest';
import { DEV_NOTICE_VERSION, devNoticeAckValue, needsDevNotice } from './devNotice';

describe('окно «игра в разработке»', () => {
  it('первый запуск — согласия нет, окно показывается', () => {
    expect(needsDevNotice(null)).toBe(true);
  });

  it('после согласия с текущей версией окно больше не показывается', () => {
    expect(needsDevNotice(devNoticeAckValue())).toBe(false);
  });

  it('новая версия текста спрашивает заново даже тех, кто соглашался со старой', () => {
    const old = devNoticeAckValue(DEV_NOTICE_VERSION);
    expect(needsDevNotice(old, DEV_NOTICE_VERSION + 1)).toBe(true);
  });

  it('мусор в хранилище — не согласие', () => {
    for (const junk of ['', '0', 'yes', 'true', ' 1', `${DEV_NOTICE_VERSION}.0`])
      expect(needsDevNotice(junk)).toBe(true);
  });
});
