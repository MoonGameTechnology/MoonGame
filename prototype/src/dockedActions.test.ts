import { describe, expect, it } from 'vitest';
import {
  assaultEnabled,
  attackOffered,
  bombardEnabled,
  docked,
  forecastShown,
  groundSummaryShown,
  strikeOffered,
} from './dockedActions';

describe('docked — правило 1', () => {
  it('стоит у точки, не в пути, не в бою', () => {
    expect(docked(true, false, false)).toBe(true);
  });

  it('в пути не пришвартован: флот между узлами, штурмовать ему нечего', () => {
    expect(docked(true, true, false)).toBe(false);
  });

  it('в бою не пришвартован: там своя карточка с единственным выходом', () => {
    expect(docked(true, false, true)).toBe(false);
    expect(docked(true, true, true)).toBe(false);
  });

  it('вне точки не пришвартован ни при каких прочих условиях', () => {
    for (const moving of [false, true])
      for (const inBattle of [false, true]) expect(docked(false, moving, inBattle)).toBe(false);
  });
});

describe('strikeOffered — правило 2', () => {
  const ME = 'p1';

  it('чужая захватываемая точка — раздел удара есть', () => {
    expect(strikeOffered('p2', ME, true)).toBe(true);
  });

  it('НЕЙТРАЛЬНАЯ точка считается чужой: она не моя, и взять её можно', () => {
    expect(strikeOffered(null, ME, true)).toBe(true);
  });

  it('своя точка — штурмовать некого', () => {
    expect(strikeOffered(ME, ME, true)).toBe(false);
  });

  it('незахватываемая точка — пустое пространство проходное, брать там нечего', () => {
    expect(strikeOffered('p2', ME, false)).toBe(false);
    expect(strikeOffered(null, ME, false)).toBe(false);
  });
});

describe('обстрел и штурм — правила 3 и 4', () => {
  it('обстрел требует И орбиты, И кораблей', () => {
    expect(bombardEnabled(true, 3)).toBe(true);
    expect(bombardEnabled(true, 0)).toBe(false);
    expect(bombardEnabled(false, 3)).toBe(false);
    expect(bombardEnabled(false, 0)).toBe(false);
  });

  it('штурм не спрашивает КОРАБЛИ: высаживается десант, а не корпуса', () => {
    // Транспорт без единого боевого корабля обязан сохранить своё единственное дело:
    // корабли не при чём — важен десант (и то лишь там, где мир защищён).
    expect(assaultEnabled(true, true, true)).toBe(true);
    expect(assaultEnabled(false, true, true)).toBe(false); // без ближней орбиты — никак
  });

  it('на ЗАЩИЩЁННОМ мире пустой трюм гасит кнопку: ядро ответит E_NO_TROOPS', () => {
    // Ровно та тихая ошибка, ради которой заведён модуль: кнопка выглядит доступной,
    // игрок жмёт, ядро отказывает, а снаружи это «ничего не произошло».
    expect(assaultEnabled(true, false, true)).toBe(false);
  });

  it('на НЕзащищённом мире десант не нужен: пустой мир занимают, а не штурмуют', () => {
    // Прятать кнопку тут значило бы отнять законный приказ — ядро такой штурм примет
    // и просто займёт мир (`capturePlanet`, ветка «undefended → occupy»).
    expect(assaultEnabled(true, false, false)).toBe(true);
    expect(assaultEnabled(true, true, false)).toBe(true);
  });

  it('там, где обстрел запрещён пустым составом, штурм всё равно разрешён', () => {
    expect(bombardEnabled(true, 0)).toBe(false);
    expect(assaultEnabled(true, true, true)).toBe(true);
  });
});

describe('attackOffered — правило 7', () => {
  it('чужой флот стоит здесь и свободен — предлагаем атаку', () => {
    expect(attackOffered(true, true)).toBe(true);
  });
  it('нет чужого флота — нечего атаковать', () => {
    expect(attackOffered(true, false)).toBe(false);
  });
  it('свой флот не пришвартован — предлагать нечего (правило 1 сильнее)', () => {
    expect(attackOffered(false, true)).toBe(false);
  });
});

describe('forecastShown — правило 5', () => {
  const живой = [{ count: 2 }];
  const пустой = [{ count: 0 }];

  it('есть и десант, и гарнизон — прогноз уместен', () => {
    expect(forecastShown(живой, живой)).toBe(true);
  });

  it('нет десанта — прогноза нет: «ничья за 0 раундов» читалась бы как расклад', () => {
    expect(forecastShown([], живой)).toBe(false);
    expect(forecastShown(пустой, живой)).toBe(false);
  });

  it('нет гарнизона — прогноза нет по той же причине', () => {
    expect(forecastShown(живой, [])).toBe(false);
    expect(forecastShown(живой, пустой)).toBe(false);
  });

  it('пустые стопки не считаются живыми — они остаются в составе, а людей в них нет', () => {
    expect(forecastShown([{ count: 0 }, { count: 0 }], живой)).toBe(false);
    expect(forecastShown([{ count: 0 }, { count: 1 }], живой)).toBe(true);
  });
});

describe('groundSummaryShown — правило 6', () => {
  it('своя точка — сводка есть', () => {
    expect(groundSummaryShown('p1', 'p1')).toBe(true);
  });

  it('чужая и ничейная — сводки нет: иначе панель протекла бы гарнизон противника', () => {
    expect(groundSummaryShown('p2', 'p1')).toBe(false);
    expect(groundSummaryShown(null, 'p1')).toBe(false);
  });
});
