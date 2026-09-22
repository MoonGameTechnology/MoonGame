import { describe, it, expect } from 'vitest';

import {
  RUN_SAVE_VERSION,
  parseRunSave,
  serializeRunSave,
  type RunSave,
  type RunSaveStore,
} from './runSave';

const sample: RunSave = {
  v: RUN_SAVE_VERSION,
  mode: 'pve_waves',
  difficulty: 'weak',
  state: { time: 42 },
};

describe('снимок забега (PVR-0.3)', () => {
  it('переживает круг «записал → прочитал»', () => {
    expect(parseRunSave(serializeRunSave(sample))).toEqual(sample);
  });

  it('мусор из хранилища — это «сохранения нет», а не исключение', () => {
    // Снимок лежал там, где его правит кто угодно с консолью. Полусобранный мир хуже
    // отсутствующего, поэтому всё сомнительное сводится к одному ответу.
    for (const raw of [null, undefined, '', 'не json', '[]', '"строка"', '42', 'null']) {
      expect([raw, parseRunSave(raw)]).toEqual([raw, null]);
    }
  });

  it('снимок ЧУЖОЙ версии не читается', () => {
    const old = serializeRunSave({ ...sample, v: RUN_SAVE_VERSION - 1 });
    expect(parseRunSave(old)).toBeNull();
  });

  it('снимок без режима, сложности или состояния не читается', () => {
    // Каждое из полей нужно восстановлению: без режима волны не пойдут, без состояния
    // восстанавливать нечего. Отсутствие любого — это не «почти снимок».
    for (const key of ['mode', 'difficulty', 'state'] as const) {
      const broken: Record<string, unknown> = { ...sample };
      delete broken[key];
      expect([key, parseRunSave(JSON.stringify(broken))]).toEqual([key, null]);
    }
  });

  it('интерфейс хранилища подменяется целиком — забег о бэкенде не знает', () => {
    // Смысл абстракции: тот же код забега работает поверх памяти, `localStorage` или
    // облака площадки. Проверяем это самым прямым способом — подставив память.
    let cell: string | null = null;
    const memory: RunSaveStore = {
      load: () => Promise.resolve(cell),
      save: (blob) => {
        cell = blob;
        return Promise.resolve();
      },
      clear: () => {
        cell = null;
        return Promise.resolve();
      },
    };
    return memory
      .save(serializeRunSave(sample))
      .then(() => memory.load())
      .then((raw) => {
        expect(parseRunSave(raw)).toEqual(sample);
        return memory.clear();
      })
      .then(() => memory.load())
      .then((raw) => expect(parseRunSave(raw)).toBeNull());
  });
});
