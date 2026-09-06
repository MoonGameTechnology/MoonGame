import { describe, it, expect } from 'vitest';
import { LOCALE_CHUNKS } from './locale';
import { LOCALE_IDS } from '../../../localization/core';

describe('загрузка локали клиентом', () => {
  it('карта чанков покрывает ровно известные языки', () => {
    expect(Object.keys(LOCALE_CHUNKS).sort()).toEqual([...LOCALE_IDS].sort());
  });
});
