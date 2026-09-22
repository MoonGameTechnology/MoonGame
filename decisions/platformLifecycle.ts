/**
 * Что и КОГДА игра сообщает площадке о своём жизненном цикле (`YAG-1.2`).
 *
 * Площадке нужны три сигнала: «загрузился» (один раз) и «геймплей идёт / геймплей встал»
 * (парно, много раз). Звучит тривиально, но модерация проверяет это debug-панелью
 * покадрово (требование 1.19), а сами вызовы разбросаны по хосту: старт волны, открытие
 * меню, показ рекламы, уход вкладки в фон. Без общего места правила разъезжаются — в этом
 * файле они в одном, без DOM, без SDK и без таймеров.
 *
 * 1. **«Загрузился» отправляется РОВНО ОДИН раз.** `LoadingAPI.ready()` — событие, а не
 *    состояние: второй вызов площадке нечего значить, а нам он стоит риска расхождения с
 *    индикатором. Поэтому повтор гасится здесь, а не «мы же помним, что уже звали».
 * 2. **«Загрузился» — это про ГОТОВНОСТЬ, а не про время.** Модерация смотрит два
 *    сценария: загрузочный экран площадки скрыт тапом и исчез сам. Привязка к таймеру
 *    различает их, привязка к готовности — нет. Поэтому решение принимает вызывающий,
 *    когда игрок правда может начать, а здесь — только «первый раз или нет».
 * 3. **Геймплей парный, и повтор одного и того же — не событие.** `start` при уже идущем
 *    геймплее и `stop` при уже остановленном молчат. Иначе одно и то же действие игрока
 *    (закрыл меню, а следом закрылась реклама) отправит два `start`, и разметка перестанет
 *    соответствовать реальности.
 * 4. **До «загрузился» геймплея не бывает.** Пока `ready` не отправлен, площадка считает
 *    игру грузящейся; `start` оттуда — разметка того, чего ещё нет. Такой вызов гасится, а
 *    не откладывается: отложенный `start` приехал бы в момент, который игрок уже прошёл.
 * 5. **Пауза площадки — ЕЁ решение, а не наше.** На `game_api_pause` геймплей обязан
 *    встать, и это не то же самое, что наша внутренняя пауза: игра может быть на паузе по
 *    меню, а площадка присылает свою. Возобновление после чужой паузы возвращает ровно то
 *    состояние, которое было до неё, — иначе выход из рекламы «оживил» бы меню.
 */

/** Что адаптер знает о жизненном цикле в каждый момент. Снаружи — только через функции. */
export interface LifecycleState {
  /** Отправлен ли `LoadingAPI.ready()` (правило 1). */
  ready: boolean;
  /** Идёт ли геймплей с точки зрения ПЛОЩАДКИ (последним ушёл `start`). */
  playing: boolean;
  /** Стоит ли пауза, пришедшая ОТ ПЛОЩАДКИ (правило 5). */
  platformPaused: boolean;
  /** Хотела ли игра играть в момент чужой паузы — к этому и возвращаемся. */
  wantedPlaying: boolean;
}

/** Что адаптеру сделать: позвать SDK или промолчать. */
export type LifecycleCall = 'ready' | 'start' | 'stop' | null;

export interface LifecycleStep {
  state: LifecycleState;
  call: LifecycleCall;
}

export const initialLifecycle: LifecycleState = {
  ready: false,
  playing: false,
  platformPaused: false,
  wantedPlaying: false,
};

/** Игра загрузилась и в неё можно играть (правила 1–2). */
export function lifecycleReady(s: LifecycleState): LifecycleStep {
  if (s.ready) return { state: s, call: null };
  return { state: { ...s, ready: true }, call: 'ready' };
}

/** Игра просит разметить геймплей идущим (правила 3–4). */
export function lifecycleStart(s: LifecycleState): LifecycleStep {
  const state = { ...s, wantedPlaying: true };
  // Правило 4: до `ready` размечать нечего. Правило 5: чужая пауза сильнее нашего желания —
  // намерение запоминаем, но площадке не врём.
  if (!s.ready || s.platformPaused || s.playing) return { state, call: null };
  return { state: { ...state, playing: true }, call: 'start' };
}

/** Игра просит разметить геймплей остановленным (правило 3). */
export function lifecycleStop(s: LifecycleState): LifecycleStep {
  const state = { ...s, wantedPlaying: false };
  if (!s.playing) return { state, call: null };
  return { state: { ...state, playing: false }, call: 'stop' };
}

/** Площадка сообщила о своей паузе (правило 5). */
export function lifecyclePlatformPause(s: LifecycleState): LifecycleStep {
  const state = { ...s, platformPaused: true };
  if (!s.playing) return { state, call: null };
  return { state: { ...state, playing: false }, call: 'stop' };
}

/** Площадка сообщила, что пауза снята (правило 5). */
export function lifecyclePlatformResume(s: LifecycleState): LifecycleStep {
  const state = { ...s, platformPaused: false };
  // Возвращаем ровно то, что было: играли — играем, стояли в меню — стоим.
  if (!s.wantedPlaying || !s.ready || s.playing) return { state, call: null };
  return { state: { ...state, playing: true }, call: 'start' };
}
