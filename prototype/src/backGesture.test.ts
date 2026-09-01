import { describe, expect, it } from 'vitest';
import {
  BACK_EXIT_WINDOW_MS,
  backAction,
  chevronAction,
  escapeConsultsLadder,
  exitWindowOpen,
  rearmAfterClose,
  rearmAfterHint,
  selfHealArm,
  typingTarget,
} from './backGesture';

// Точка отсчёта: «сейчас» в живом коде — `performance.now()`, здесь просто число.
const NOW = 10_000;

describe('backAction — что означает нажатие «Назад»', () => {
  it('правило 1: пока есть что закрыть, Back разбирает стопку, а не выходит', () => {
    // Даже в матче и даже сразу после подсказки: закрытый слой заканчивает нажатие.
    expect(backAction(true, true, NOW, NOW)).toBe('closed');
    expect(backAction(true, false, NOW, -Infinity)).toBe('closed');
  });

  it('правило 3: первое нажатие в матче только предупреждает — матч не теряется вслепую', () => {
    expect(backAction(false, true, NOW, -Infinity)).toBe('hint');
  });

  it('правило 4: второе нажатие в пределах окна выходит по-настоящему', () => {
    expect(backAction(false, true, NOW, NOW)).toBe('exit');
    expect(backAction(false, true, NOW, NOW - BACK_EXIT_WINDOW_MS)).toBe('exit');
  });

  it('правило 4: окно истекло — счёт начинается заново, а не «доедает» старую подсказку', () => {
    // Через минуту игрок уже не помнит подсказку: для него это снова ПЕРВОЕ нажатие.
    expect(backAction(false, true, NOW, NOW - BACK_EXIT_WINDOW_MS - 1)).toBe('hint');
    expect(backAction(false, true, NOW, NOW - 60_000)).toBe('hint');
  });

  it('правило 5: вне матча Back не удерживают — следующее нажатие закроет приложение', () => {
    expect(backAction(false, false, NOW, -Infinity)).toBe('leave');
    // Даже свежая отметка подсказки не превращает выход из хаба в «выход из матча».
    expect(backAction(false, false, NOW, NOW)).toBe('leave');
  });
});

describe('exitWindowOpen — граница окна подтверждения', () => {
  it('ровно на границе окно ещё открыто, за ней — уже нет', () => {
    expect(exitWindowOpen(NOW, NOW - BACK_EXIT_WINDOW_MS)).toBe(true);
    expect(exitWindowOpen(NOW, NOW - BACK_EXIT_WINDOW_MS - 1)).toBe(false);
  });

  it('до первой подсказки окна нет вовсе', () => {
    // `-Infinity` — начальное значение отметки: «подсказки ещё не было».
    expect(exitWindowOpen(NOW, -Infinity)).toBe(false);
  });
});

describe('сентинел истории — ступень, которую тратит каждое нажатие', () => {
  it('правило 2: после закрытия слоя ступень нужна, пока есть слои ИЛИ идёт матч', () => {
    expect(rearmAfterClose(true, false)).toBe(true);
    expect(rearmAfterClose(false, true)).toBe(true);
    expect(rearmAfterClose(true, true)).toBe(true);
  });

  it('правило 2: закрыт последний слой вне матча — ступень не нужна, дальше выход', () => {
    expect(rearmAfterClose(false, false)).toBe(false);
  });

  it('правило 4: подсказка взводит ступень для настоящего второго нажатия', () => {
    expect(rearmAfterHint('hint')).toBe(true);
  });

  it('правило 5: «leave» ступень не ставит — иначе игрок заперт во вкладке', () => {
    expect(rearmAfterHint('leave')).toBe(false);
    expect(rearmAfterHint('exit')).toBe(false);
    expect(rearmAfterHint('closed')).toBe(false);
  });
});

describe('selfHealArm — страховочная сетка кадрового цикла (правило 6)', () => {
  it('взведённый сентинел цикл не трогает: вторая ступень стоила бы лишнего нажатия', () => {
    expect(selfHealArm(true, true, true, NOW, -Infinity)).toBe(false);
    expect(selfHealArm(true, false, true, NOW, -Infinity)).toBe(false);
  });

  it('открытый слой без ступени — чинится немедленно', () => {
    expect(selfHealArm(false, true, false, NOW, -Infinity)).toBe(true);
  });

  it('живой матч без ступени — чинится, иначе Back выгрузит страницу', () => {
    expect(selfHealArm(false, false, true, NOW, -Infinity)).toBe(true);
  });

  it('в окне подсказки цикл молчит — ступень уже поставил обработчик', () => {
    expect(selfHealArm(false, false, true, NOW, NOW)).toBe(false);
    // …но открытый слой всё равно важнее: его ступень тратится на закрытие.
    expect(selfHealArm(false, true, true, NOW, NOW)).toBe(true);
  });

  it('ни слоёв, ни матча — цикл ничего не ставит', () => {
    expect(selfHealArm(false, false, false, NOW, -Infinity)).toBe(false);
  });
});

describe('Escape (правило 7)', () => {
  it('обе формы имени клавиши считаются одной и той же', () => {
    // Старые WebView шлют 'Esc', современные — 'Escape'; игрок жмёт одну кнопку.
    expect(escapeConsultsLadder('Escape', false)).toBe(true);
    expect(escapeConsultsLadder('Esc', false)).toBe(true);
  });

  it('другие клавиши лестницу не трогают', () => {
    expect(escapeConsultsLadder('Enter', false)).toBe(false);
    expect(escapeConsultsLadder('Backspace', false)).toBe(false);
  });

  it('при наборе текста Escape остаётся браузеру', () => {
    expect(escapeConsultsLadder('Escape', true)).toBe(false);
  });

  it('набором считается поле ввода, textarea и любой редактируемый узел', () => {
    expect(typingTarget('INPUT', false)).toBe(true);
    expect(typingTarget('TEXTAREA', false)).toBe(true);
    expect(typingTarget('DIV', true)).toBe(true);
  });

  it('обычный узел набором не считается, узла может не быть вовсе', () => {
    expect(typingTarget('DIV', false)).toBe(false);
    expect(typingTarget('BUTTON', false)).toBe(false);
    expect(typingTarget(undefined, false)).toBe(false);
  });
});

describe('chevronAction — видимая кнопка ‹ (правило 8)', () => {
  it('закрывает слой так же, как аппаратный Back', () => {
    expect(chevronAction(true, true)).toBe('closed');
    expect(chevronAction(true, false)).toBe('closed');
  });

  it('в матче уходит в хаб С ПЕРВОГО нажатия — подсказки на кнопке нет', () => {
    expect(chevronAction(false, true)).toBe('exit');
  });

  it('вне матча отдаёт нажатие системе', () => {
    expect(chevronAction(false, false)).toBe('system-back');
  });

  it('шеврон никогда не возвращает «hint» — ни при каком состоянии', () => {
    for (const closed of [true, false]) {
      for (const inMatch of [true, false]) {
        expect(chevronAction(closed, inMatch)).not.toBe('hint');
      }
    }
  });
});
