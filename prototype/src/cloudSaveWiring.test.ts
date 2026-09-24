/**
 * Сторож проводки облачного сейва (`YAG-2.2`) — статический: `main.ts` живёт на DOM.
 * Правила сверки покрыты в `decisions/cloudSync.test.ts`, адаптер — в `yandex.test.ts`,
 * поведение на собранном архиве — робот `yandextest.mjs`. Здесь стык, и у него три
 * способа сломаться молча:
 *
 * 1. **Изменение без новой правки.** Профиль сохранился, а номер правки не сдвинулся —
 *    сверка на другом устройстве решит, что вперёд ушло облако, и возьмёт его поверх
 *    свежего локального прогресса.
 * 2. **Сверка не ждёт меню.** Меню показало локальный профиль, а через секунду под ним
 *    подменился облачный — игрок успел потратить валюту в чужом профиле.
 * 3. **Уход со страницы без отправки.** Таймер окна квоты после выгрузки не сработает, и
 *    последний прогресс останется на одном устройстве.
 *
 * Вход и развилка (`YAG-1.4`) добавляют ещё два:
 *
 * 4. **Облачный профиль под живым забегом.** Выбор «взять из облака» делается и после
 *    выхода из забега в меню, а забег на паузе принадлежит прежнему профилю — «Продолжить»
 *    засчитал бы облачному профилю чужой забег.
 * 5. **«Оставить этот» своим номером правки.** Облако оказалось бы позади сверки другого
 *    устройства, и то молча записало бы свой профиль поверх выбора игрока.
 *
 * Аудит Sector Zero (`AUD-24`) добавил шестой:
 *
 * 6. **Облако без мира забега.** Везёт один дескриптор — другое устройство пересобирает
 *    мир с карты главы, и «Продолжить» там стирает поражение.
 *
 * `AUD-27` — седьмой:
 *
 * 7. **Сверка без общего срока.** Срок на чтении облака есть, а вопрос «кто играет» перед
 *    ним ждёт SDK вечно — меню, которое сверку дожидается, не открывается никогда.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const body = (name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(SRC)?.[1] ?? '';

describe('YAG-2.2 — каждое изменение профиля — новая правка облака', () => {
  it('сохранение профиля двигает правку', () => {
    expect(body('saveSectorProgress')).toContain('bumpCloudRev();');
  });

  it('смена дескриптора забега двигает правку, повтор того же — нет', () => {
    const save = body('saveRun');
    expect(save).toContain('if (portable !== lastPortableRaw || worldDue) {');
    expect(save).toContain('bumpCloudRev();');
  });

  it('AUD-24: мир забега тоже двигает правку — только изменившийся и не чаще окна', () => {
    // Повтор того же мира (пауза) облако не пишет, а изменившийся — не чаще
    // `CLOUD_RUN_EVERY_MS`: снимок главы — до 36 КБ, и каждая запись — трафик игрока.
    expect(body('saveRun')).toContain(
      'const worldDue = blob !== lastCloudRunBlob && now - cloudRunAt >= CLOUD_RUN_EVERY_MS;',
    );
  });

  it('AUD-24: облако везёт точный мир, принятое облако кладёт его в локальный снимок', () => {
    const push = body('pushCloud');
    expect(push).toContain('const state = await runSaveStore.load();');
    expect(push).toContain('cloudEnvelope(');
    expect(body('adoptCloud')).toContain('if (cloud.state) await runSaveStore.save(cloud.state);');
  });

  it('правка отправляется в облако, а отправка отмечает сверку', () => {
    expect(body('bumpCloudRev')).toContain('pushCloud();');
    expect(body('pushCloud')).toContain('syncedRev: syncMark.rev');
  });
});

describe('YAG-2.2 — сверка на старте', () => {
  it('цепляется к записи профиля — меню её дожидается', () => {
    expect(SRC).toContain('progressWrite = progressWrite.then(syncCloud)');
  });

  it('решение принимает общее правило, развилка облако не трогает', () => {
    const sync = body('syncCloud');
    expect(sync).toContain('planCloudSync(');
    expect(sync).toMatch(
      /if \(plan === 'choose'[^)]*\) \{\s+cloudState = 'held';\s+cloudFork = [^;]+;\s+return;/,
    );
    expect(body('pushCloud')).toContain("if (cloudState !== 'on' || !ownsSectorZero()) return;");
  });

  it('облако не ответило вовремя — в этой сессии его нет, а не зависшее меню', () => {
    const sync = body('syncCloud');
    expect(sync).toContain('Promise.race([host.save.load(), late])');
    expect(sync).toContain('if (raw === undefined) return;');
  });

  it('AUD-27: вопрос «кто играет» — под тем же сроком: молчащий getPlayer не запирает меню', () => {
    // Срок стоял только на чтении облака, а `auth.player()` перед ним ждал SDK без
    // потолка — меню висело на «Проверяем сохранение…» навсегда (прогон архива).
    const sync = body('syncCloud');
    expect(sync).toContain('const player = await Promise.race([host.auth.player(), late]);');
    expect(sync).toMatch(/if \(!player\) return;/);
  });
});

describe('YAG-2.2 — уход со страницы', () => {
  it('отправляет копию сразу, а не в окно квоты', () => {
    expect(SRC).toContain("addEventListener('pagehide', () => pushCloud(true));");
    expect(SRC).toMatch(/if \(document\.visibilityState === 'hidden'\) pushCloud\(true\);/);
  });
});

/** Объект меню `sectorZeroAccount` — от объявления до закрывающей скобки. */
const account = /const sectorZeroAccount[\s\S]*?\n\};/.exec(SRC)?.[0] ?? '';

describe('YAG-1.4 — вход и развилка', () => {
  it('гость видит «Войти» только там, где облако есть, а вход площадка умеет', () => {
    expect(body('syncCloud')).toMatch(/\.authenticated\) \{\s+cloudState = 'guest';/);
    expect(account).toContain(
      "canSignIn: () => cloudState === 'guest' && getPlatform().auth.canSignIn",
    );
  });

  it('после входа — та же сверка, что на старте, и меню её дожидается', () => {
    expect(account).toContain("if ((await getPlatform().auth.signIn()).status !== 'ok') return;");
    expect(account).toContain(
      'progressWrite = progressWrite.then(syncCloud).catch(cloudSyncFailed);',
    );
  });

  it('облачный профиль снимает забег, стоящий на паузе в этой вкладке', () => {
    expect(body('adoptCloud')).toContain('if (runInProgress()) setRunActive(false);');
  });

  it('«Оставить этот» — номер правки по общему правилу, и облако получает профиль', () => {
    expect(account).toMatch(
      /syncMark = keepLocalMark\(syncMark, fork\.cloud\);[\s\S]*cloudState = 'on';\s+pushCloud\(\);/,
    );
  });

  it('родословная проведена насквозь: правка, запись, сверка, взятие облака', () => {
    // Без неё сверка откатывается к номерам разных устройств как одной истории — и молча
    // теряет прогресс, если оптимистичная отметка записи не дошла (ревью Sector Zero).
    expect(body('bumpCloudRev')).toContain('syncMark = bumpMark(syncMark);');
    expect(body('pushCloud')).toContain('lineage: syncMark.lineage');
    expect(body('syncCloud')).toContain('lineage: syncMark.lineage');
    expect(body('adoptCloud')).toContain('syncMark = adoptMark(syncMark, cloud);');
  });
});
