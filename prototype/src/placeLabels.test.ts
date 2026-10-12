/**
 * Сторож подписей мест (SZ-map-ids) — статический, как соседние сторожа рендера: холст в
 * vitest не поднять, а проверять мок значило бы проверять мок.
 *
 * Что держит: игрок видит место по имени провинции (`placeName` → `decisions/provinceName.ts`,
 * PVR-6.19), а не по сырому id узла. На картах глав Sector Zero id — английские слова
 * (`home_a`, `pirate_den`), и до PVR-6.19 холст, журнал и карточки показывали их одинаково на
 * обоих языках — п. 8.2.3 требований Яндекс Игр. Там же жила зашитая строка `'asteroid field'`.
 * На картах без имён место тоже названо — авто-именем без повторов (`planetName.ts`, UIX-5.2):
 * подпись «C0R2» и окно того же боя «STYX-3» были одним миром под двумя именами.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
// Подписи радара (метка сигнатуры, кольца дальномера) живут у его владельца (REFM-239).
const RADAR = readFileSync(new URL('./mapRadar.ts', import.meta.url), 'utf8');
// Подписи наложений (позывной вылета, борта патруля, срок коридора) — у них (REFM-233).
const OVERLAYS = readFileSync(new URL('./mapOverlays.ts', import.meta.url), 'utf8');
// Подписи прицелов (прогноз боя у цели «Атаки», часы хода) — у них же (REFM-233, часть 2).
const AIM = readFileSync(new URL('./mapAim.ts', import.meta.url), 'utf8');
// Подписи меток (отсчёт осады, знак носителя, заряды мин, часы цепочек) — у них (REFM-234).
const MARKS = readFileSync(new URL('./mapMarks.ts', import.meta.url), 'utf8');
// Подписи миров (метка тумана, имена на схеме, поле астероидов, выноска мира) — у них (REFM-235).
const WORLDS = readFileSync(new URL('./mapWorlds.ts', import.meta.url), 'utf8');

describe('SZ-map-ids — места называются именами', () => {
  it('ни одна подпись холста не пишет сырой id узла', () => {
    // `fillText(n.id …)`, `fillText(p.id …)`, `fillText(id, …)` — прежние формы подписи.
    expect((MAIN + RADAR + OVERLAYS + AIM + MARKS + WORLDS).match(/fillText\(\s*(?:[np]\.)?id\b/g) ?? []).toEqual([]);
    // Четыре подписи: метка тумана, схема, поле астероидов, выноска мира.
    expect(WORLDS.match(/fillText\(placeName\(/g)?.length).toBe(4);
  });

  it('заголовок карточки мира — имя, а не id узла (UIX-5.2)', () => {
    // Карточки тумана («нет телеметрии», «последний снимок») брали в заголовок `p.id`.
    expect(MAIN.match(/cardHeader\([^,]+,\s*(?:[np]\.)?id\b/g) ?? []).toEqual([]);
  });

  it('вид сектора под полем астероидов — из данных, а не зашитой строкой', () => {
    expect(MAIN + WORLDS).not.toContain("'asteroid field'");
  });
});

describe('UIX-5.3 — надписи холста словами языка игрока', () => {
  it('литерал в `fillText` несёт значок и число, но не английское слово', () => {
    // «◌ SIGNATURE 240» и «● REVEAL 120» у колец радара стояли на обоих языках: литерал
    // холста гейт локализации не видит, он ищет `t('…')`. Слово — только через ключ.
    const literals = [...(MAIN + RADAR + OVERLAYS + AIM + MARKS + WORLDS).matchAll(/fillText\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) =>
      m[2]!.replace(/\$\{[^}]*\}/g, ''),
    );
    expect(literals.length).toBeGreaterThan(5); // разбор не должен молча опустеть
    // Последние такие подписи — «G:4 B:…» и «✦last» тумана и схемы — переведены словарём
    // терминов (UIX-5.4): теперь это `t('map.callout.garrison')` и `t('map.fog.old')`.
    expect(literals.filter((l) => /[A-Za-z]{2,}/.test(l))).toEqual([]);
  });

  it('гарнизон и старые данные на холсте подписаны ключами (UIX-5.4)', () => {
    expect(WORLDS.match(/t\('map\.callout\.garrison'/g)?.length).toBe(2);
    expect(WORLDS).toContain("t('map.fog.old')");
  });

  it('кольца радара выбранного мира подписаны ключами', () => {
    expect(RADAR).toContain("t('map.radar.detect'");
    expect(RADAR).toContain("t('map.radar.identify'");
  });
});
