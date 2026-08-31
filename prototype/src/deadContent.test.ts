// AI-BAL-10 (остаток): «мёртвый контент» — это ТРИ разных диагноза, а не один список.
//
// Отчёт валил в одну строку то, что лечится по-разному: `farm`/`power_plant` бот СТРОИТЬ
// УМЕЕТ (правило «подними ферму при дефиците еды» стоит в `ai.ts`) — они молчали, пока
// дефицит был недостижим, и ожили от правки КОНТЕНТА (BAL-3, шкала `upkeep`); а
// `radar`/`starfort`/`sensor_frigate` бот не заказывает вовсе, потому что механики, ради
// которых они существуют (туман, гарнизон), прибор не покрывает — там правка контента не
// поможет вообще. Первое — сигнал про БАЛАНС, второе — про ПРИБОР, и одна общая строка
// толкала чинить не то.
//
// Признак берётся из исходника бота, а не из списка в харнесе: список устареет молча, а
// исходник — это то, что бот реально умеет. Прецедент такой проверки в репозитории уже
// есть — `aiProfile.test.ts` тоже читает исходники, чтобы утверждение о боте не
// разъехалось с ботом.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitDeadContent } from './deadContent';

describe('AI-BAL-10 — диагноз мёртвого контента', () => {
  it('id, которого нет в исходнике бота, попадает в «вне репертуара»', () => {
    const split = splitDeadContent(['radar'], "const CHAIN = ['mine', 'refinery'];");
    expect(split.offRepertoire).toEqual(['radar']);
    expect(split.unbuilt).toEqual([]);
  });

  it('id, который бот заказывает, попадает в «умеет, но ни разу»', () => {
    const split = splitDeadContent(['farm'], "for (const [need, b] of [['food', 'farm']])");
    expect(split.unbuilt).toEqual(['farm']);
    expect(split.offRepertoire).toEqual([]);
  });

  it('двойные кавычки считаются так же, как одинарные', () => {
    // Харнес читает СЫРОЙ текст, а не AST: если бот однажды напишет "starfort", это
    // по-прежнему должно означать «в репертуаре», иначе диагноз соврёт из-за стиля кавычек.
    expect(splitDeadContent(['starfort'], 'build(p, "starfort")').unbuilt).toEqual(['starfort']);
  });

  it('подстрока чужого id не считается упоминанием', () => {
    // `mine` — подстрока `metal_mine`/`determine`. Без границ по кавычкам такой признак
    // объявил бы «в репертуаре» всё, чьё имя вложено в другое слово.
    expect(
      splitDeadContent(['mine'], "build(p, 'metal_mine'); // determine").offRepertoire,
    ).toEqual(['mine']);
  });

  it('порядок входа сохраняется — отчёт должен читаться стабильно', () => {
    const src = "['power_plant', 'farm']";
    const split = splitDeadContent(['radar', 'power_plant', 'starfort', 'farm'], src);
    expect(split.offRepertoire).toEqual(['radar', 'starfort']);
    expect(split.unbuilt).toEqual(['power_plant', 'farm']);
  });

  it('на ЖИВОМ исходнике бота диагноз совпадает с разбором кирпича', () => {
    // Сторож против молчаливого устаревания: если бот научится радару или разучится
    // ферме, тест покраснеет и заставит переписать диагноз, а не оставит его в отчёте
    // как унаследованную правду. Проверяется РЕПЕРТУАР (что бот умеет), а не факт
    // постройки: сколько раз он это построил — вопрос к прогону, а не к исходнику.
    const ai = readFileSync('prototype/src/ai.ts', 'utf8');
    const split = splitDeadContent(
      ['farm', 'power_plant', 'radar', 'sensor_frigate', 'starfort', 'spaceport'],
      ai,
    );
    expect(split.unbuilt).toEqual(['farm', 'power_plant']);
    expect(split.offRepertoire).toEqual(['radar', 'sensor_frigate', 'starfort', 'spaceport']);
  });
});
