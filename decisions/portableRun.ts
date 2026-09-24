/**
 * `PortableRunSave` (`YAG-2.1`) — забег, описанный НЕСКОЛЬКИМИ СОТНЯМИ БАЙТ вместо
 * целого мира. Чистое решение обоих клиентов: ни хранилища, ни SDK, ни таймеров.
 *
 * ## Дескриптор — ЗАПАСНОЙ путь, а не основной (AUD-24)
 *
 * До AUD-24 облако везло только дескриптор, и забег на другом устройстве всегда
 * пересобирался по нему. Доводы были: лимит (снят сверкой `YAG-0.1`/`YAG-0.2` — у `setData`
 * 200 КБ, а не 10), частота записи и сеть на телефоне. Упущено было главное: пересобранный
 * мир ВЫГОДНЕЕ проигрываемого. Вход со второго устройства возвращал дом, флот и казну и
 * стирал всё наступление Роя — бесплатная перемотка поражения, которую §2.3 роадмапа
 * площадки запрещает даже за рекламу. Прогон на главе II: проигранный забег после
 * «Продолжить» на втором устройстве выигрывался.
 *
 * Теперь облако везёт точный мир (`runSave.ts`), а частоту и сеть держит частота отправки
 * (раз в 30 с и на уходе со страницы). За дескриптором остался один довод, и он настоящий:
 * **совместимость версий.** Шесть полей переживают смену формы `GameState`, блоб — нет, и
 * после обновления игры старый снимок миром не становится. Туда игрок по желанию не
 * попадёт — поэтому только туда и можно пускать неточное восстановление.
 *
 * ## Что делает форму возможной
 *
 * Мир забега **не случаен**: он строится из фиксированной карты главы одним и тем же
 * `buildStateFromMap`. Значит восстанавливать нечего, кроме выбора игрока — какая глава,
 * сложность, докуда дошёл, что взял. Сид сюда не нужен вовсе, и это не экономия, а
 * отсутствие зависимости: дескриптор не ломается при смене генератора, потому что
 * генератора нет. Главу несёт id карты (`map`), а не режим: у глав Sector Zero режим один.
 *
 * ⚠️ **Восстановление НЕ побайтовое.** Позиции флотов, идущие бои и накопленные ресурсы
 * из дескриптора не возвращаются: игрок попадает в тот же забег, на ту же волну, с теми же
 * усилениями, а мир — с карты главы. Для запасного пути после обновления игры этого
 * достаточно; как ОСНОВНОЙ путь это перемотка поражения (см. выше).
 *
 * ## Мета сюда НЕ входит
 *
 * Звёздность, модули, герой и кошельки живут в `SectorZeroProgress` и сохраняются
 * отдельно, раньше забега (`PVR-0.3`: «сперва мета, потом забег»). Дублировать их здесь
 * значило бы завести второй источник правды о прогрессе — ровно ту пару живых версий
 * одного факта, которую запрещает рабочее соглашение.
 */

/** Версия формата. Чужая версия читается как «сохранения нет» — см. {@link parsePortableRun}. */
export const PORTABLE_RUN_VERSION = 1;

/** Забег в переносимом виде. Семь полей, из них три необязательных. */
export interface PortableRunSave {
  v: number;
  /** Режим, под которым забег вооружён (`data.modes` id) — он же выбирает карту. */
  mode: string;
  /** Сложность, выбранная на запуске. */
  difficulty: string;
  /** Волн уже пришло. 0 — забег начат, но первая ещё не landed. */
  wave: number;
  /** Серийный номер попытки Sector Zero: защищает награду от повторной выдачи. */
  attempt?: number;
  /** Взятые усиления (`grantOnly`-технологии), в порядке взятия. */
  boons?: string[];
  /** Id карты главы (`GameState.mapId`). Режим главу не определяет — у глав он общий; без
   *  этого поля восстановление отказывает, а не угадывает главу. */
  map?: string;
}

/** Минимум, который нужен описателю от состояния. Своя форма, а не импорт `GameState`:
 *  `decisions/` остаются чистыми, а тест не собирает мир целиком. */
export interface RunFacts {
  mapId?: string;
  pve?: { waveNumber?: number };
  players?: Record<string, { technologies?: { completed?: string[] } } | undefined>;
}

/** Какие технологии считаются усилениями забега. Отдельным параметром, а не чтением
 *  каталога: решение не знает про `GameData` и не обязано. */
export type IsBoon = (technologyId: string) => boolean;

/**
 * Состояние → дескриптор. Чистая функция: тот же вход даёт тот же выход.
 *
 * Порядок усилений сохраняется таким, каким его дал `completed`, — он и есть порядок
 * взятия, и восстановление опирается на него, а не на сортировку.
 */
export function describeRun(
  facts: RunFacts,
  playerId: string,
  isBoon: IsBoon,
  meta: { mode: string; difficulty: string; attempt?: number },
): PortableRunSave {
  const completed = facts.players?.[playerId]?.technologies?.completed ?? [];
  const boons = completed.filter((id) => isBoon(id));
  const wave = facts.pve?.waveNumber;
  return {
    v: PORTABLE_RUN_VERSION,
    mode: meta.mode,
    difficulty: meta.difficulty,
    wave: Number.isSafeInteger(wave) && wave! > 0 ? wave! : 0,
    ...(Number.isSafeInteger(meta.attempt) && meta.attempt! > 0 ? { attempt: meta.attempt } : {}),
    ...(boons.length > 0 ? { boons } : {}),
    ...(typeof facts.mapId === 'string' && facts.mapId !== '' ? { map: facts.mapId } : {}),
  };
}

/** Дескриптор → строка для хранилища. */
export function serializePortableRun(save: PortableRunSave): string {
  return JSON.stringify(save);
}

/**
 * Строка из хранилища → дескриптор или `null`.
 *
 * `null` на ВСЁ сомнительное: пусто, не JSON, не объект, чужая версия, нет режима или
 * сложности, волна не целая или отрицательная. Дескриптор приезжает из облака площадки
 * и из `localStorage` — то есть из мест, которые правит кто угодно с консолью, и мог
 * быть записан другой версией игры. Полувосстановленный забег хуже, чем его отсутствие:
 * игрок не поймёт, что потерял, и решит, что игра сломана.
 */
export function parsePortableRun(raw: string | null | undefined): PortableRunSave | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const save = parsed as Partial<PortableRunSave>;
  if (save.v !== PORTABLE_RUN_VERSION) return null;
  if (typeof save.mode !== 'string' || save.mode === '') return null;
  if (typeof save.difficulty !== 'string' || save.difficulty === '') return null;
  if (!Number.isSafeInteger(save.wave) || save.wave! < 0) return null;
  // Усиления фильтруются, а не отвергают снимок целиком: один битый id — это потерянное
  // усиление, а не потерянный забег. Дубли убираются — повторное усиление ядро всё равно
  // не выдаст, а в дескрипторе оно означало бы лишний байт и ложную историю.
  const boons = Array.isArray(save.boons)
    ? [...new Set(save.boons.filter((id): id is string => typeof id === 'string' && id !== ''))]
    : [];
  return {
    v: save.v,
    mode: save.mode,
    difficulty: save.difficulty,
    wave: save.wave!,
    ...(Number.isSafeInteger(save.attempt) && save.attempt! > 0 ? { attempt: save.attempt } : {}),
    ...(boons.length > 0 ? { boons } : {}),
    ...(typeof save.map === 'string' && save.map !== '' ? { map: save.map } : {}),
  };
}

/** Минимум мира, который нужен восстановлению. Своя форма, а не `GameState` — по той же
 *  причине, что {@link RunFacts}; на вход приходит настоящий мир, и он же выходит. */
export interface ResumableState {
  pve?: { waveNumber: number; totalWaves: number; nextWaveAt?: number };
  players?: Record<string, { technologies?: { completed?: string[] } } | undefined>;
}

/**
 * Свежий мир забега → тот же забег на волне из дескриптора (`YAG-2.1`). Чистая функция:
 * вход не меняется, выход — новый мир.
 *
 * На вход — мир, собранный ровно как у нового запуска той же миссии и уже засеянный
 * модулем PvE (волна 0, следующая назначена). Отсюда два решения:
 *
 * - **номер волны выставляется, а расписание — нет.** Следующая волна придёт через
 *   обычный интервал: игрок вернулся — ему дают время осмотреться, а не встречают штурмом.
 *   Волна сверх длины забега срезается до последней, и отсчёт к следующей снимается;
 * - **усиления — только из списка режима.** Дескриптор приезжает из хранилища, которое
 *   правит кто угодно, и без этой проверки через него можно было бы выдать себе любую
 *   технологию каталога. Порядок сохраняется — это порядок взятия.
 *
 * `null` — мир не засеян или игрока в нём нет: «восстановить нечем», а не полумир.
 */
export function resumePortableRun<T extends ResumableState>(
  state: T,
  save: PortableRunSave,
  playerId: string,
  allowedBoons: readonly string[],
): T | null {
  if (!state.pve || !state.players?.[playerId]) return null;
  const next = JSON.parse(JSON.stringify(state)) as T;
  const pve = next.pve!;
  pve.waveNumber = Math.min(Math.max(0, save.wave), pve.totalWaves);
  if (pve.waveNumber >= pve.totalWaves) delete pve.nextWaveAt;
  const player = next.players![playerId]!;
  const completed = player.technologies?.completed ?? [];
  const taken = (save.boons ?? []).filter(
    (id, i, all) => allowedBoons.includes(id) && !completed.includes(id) && all.indexOf(id) === i,
  );
  player.technologies = { ...player.technologies, completed: [...completed, ...taken] };
  return next;
}
