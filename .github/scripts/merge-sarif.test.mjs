import { describe, it, expect } from 'vitest';
import { mergeSarif } from './merge-sarif.mjs';

/**
 * SEC-19. Сторож слияния SARIF. Проверяем не «функция что-то вернула», а ровно то,
 * ради чего она написана: у загрузки один `run`, правила не задвоились, и `ruleIndex`
 * после склейки указывает на СВОЁ правило. Последнее — единственное место, где ошибка
 * не видна глазом: в панели просто окажется чужое описание у части находок.
 */

/** SARIF от одного скана: правила по порядку, результаты адресуют их по индексу. */
const sarif = (driverName, rules, results) => ({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: driverName, rules } }, results }],
});

const rule = (id) => ({ id, shortDescription: { text: `описание ${id}` } });
const result = (ruleId, ruleIndex, uri) => ({
  ruleId,
  ruleIndex,
  level: 'error',
  message: { text: `находка ${ruleId}` },
  locations: [{ physicalLocation: { artifactLocation: { uri } } }],
});

describe('mergeSarif', () => {
  it('складывает несколько файлов в ОДИН run — ровно этого требует upload-sarif', () => {
    const merged = mergeSarif([
      sarif('Trivy', [rule('CVE-1')], [result('CVE-1', 0, 'usr/bin/caddy')]),
      sarif('Trivy', [rule('CVE-2')], [result('CVE-2', 0, 'usr/local/bin/gosu')]),
    ]);
    expect(merged.runs).toHaveLength(1);
    expect(merged.runs[0].results).toHaveLength(2);
  });

  it('пересчитывает ruleIndex на общий список, а не оставляет локальный', () => {
    // У второго файла CVE-2 лежит под индексом 0 в СВОЁМ run; в общем списке он
    // окажется вторым. Без пересчёта находка показала бы описание CVE-1.
    const merged = mergeSarif([
      sarif('Trivy', [rule('CVE-1')], [result('CVE-1', 0, 'a')]),
      sarif('Trivy', [rule('CVE-2')], [result('CVE-2', 0, 'b')]),
    ]);
    const { rules } = merged.runs[0].tool.driver;
    for (const r of merged.runs[0].results) {
      expect(rules[r.ruleIndex].id, `ruleIndex у ${r.ruleId} указывает не на своё правило`).toBe(
        r.ruleId,
      );
    }
  });

  it('не задваивает правило, найденное в обоих образах', () => {
    // Ровно наш случай: пять CVE Go stdlib есть и в caddy, и в gosu (SEC-14).
    // Два одинаковых `id` в одном run — невалидный SARIF.
    const merged = mergeSarif([
      sarif('Trivy', [rule('CVE-2026-27145')], [result('CVE-2026-27145', 0, 'usr/bin/caddy')]),
      sarif(
        'Trivy',
        [rule('CVE-2026-27145')],
        [result('CVE-2026-27145', 0, 'usr/local/bin/gosu')],
      ),
    ]);
    expect(merged.runs[0].tool.driver.rules.map((r) => r.id)).toEqual(['CVE-2026-27145']);
    // Обе НАХОДКИ при этом живы — схлопывать надо правила, а не находки.
    expect(merged.runs[0].results).toHaveLength(2);
    expect(merged.runs[0].results.map((r) => r.locations[0].physicalLocation.artifactLocation.uri))
      .toEqual(['usr/bin/caddy', 'usr/local/bin/gosu']);
  });

  it('сохраняет путь артефакта — по нему и различаются образы после склейки', () => {
    const merged = mergeSarif([
      sarif('Trivy', [rule('CVE-1')], [result('CVE-1', 0, 'usr/bin/caddy')]),
      sarif('Trivy', [rule('CVE-2')], [result('CVE-2', 0, 'usr/local/bin/gosu')]),
    ]);
    const uris = merged.runs[0].results.map(
      (r) => r.locations[0].physicalLocation.artifactLocation.uri,
    );
    expect(uris).toEqual(['usr/bin/caddy', 'usr/local/bin/gosu']);
  });

  it('выбрасывает ruleIndex, которому не нашлось правила, вместо битой ссылки', () => {
    const broken = sarif('Trivy', [], [result('CVE-X', 7, 'a')]);
    const merged = mergeSarif([broken]);
    expect(merged.runs[0].results[0].ruleIndex).toBeUndefined();
    expect(merged.runs[0].results[0].ruleId).toBe('CVE-X'); // ruleId самодостаточен
  });

  it('переживает пустой вход и файл без находок, не роняя загрузку', () => {
    expect(mergeSarif([]).runs).toHaveLength(1);
    expect(mergeSarif([]).runs[0].results).toEqual([]);
    const empty = mergeSarif([sarif('Trivy', [], [])]);
    expect(empty.runs[0].results).toEqual([]);
    expect(empty.runs[0].tool.driver.name).toBe('Trivy');
  });
});
