/**
 * Сохранение ЗАБЕГА — форма снимка и его разбор (PVR-0.3). Чистое решение обоих клиентов.
 *
 * Два правила задают здесь всё.
 *
 * **1. Хранилище — чужое и асинхронное.** Писать в `localStorage` напрямую нельзя: у
 * платформенной сборки сохранение это облако игрока площадки, а `localStorage` внутри
 * iframe бывает партиционирован и вычищается. Поэтому забег знает только интерфейс
 * {@link RunSaveStore} — три асинхронных метода, — а какой бэкенд за ним, решает сборка.
 * Асинхронность не «на будущее»: у площадки сохранение асинхронно ПО API, и синхронный
 * интерфейс пришлось бы ломать при подстановке, то есть переделывать код забега — ровно
 * то, чего кирпич требует избежать.
 *
 * **2. Снимок — ВНЕШНИЙ вход.** Он полежал в хранилище, которое правит кто угодно с
 * консолью, и мог приехать из другой версии игры. Поэтому {@link parseRunSave} ничего не
 * доверяет: любой мусор — это `null` («сохранения нет»), а не исключение и не полусобранный
 * мир. Форма проверяется ровно настолько, насколько её читает восстановление.
 *
 * Здесь НЕТ ни `localStorage`, ни SDK, ни таймеров — только форма и разбор.
 */

/** Версия формата. Снимок другой версии читается как отсутствующий: восстановить мир
 *  по чужой форме нельзя, а молча восстановить половину — хуже, чем начать заново. */
export const RUN_SAVE_VERSION = 1;

/**
 * Что нужно от хранилища. Ровно три метода, все асинхронные — так его подменяет и тест,
 * и платформенная сборка.
 */
export interface RunSaveStore {
  /** Сырой снимок или `null`, если его нет. Провал чтения — тоже `null`. */
  load(): Promise<string | null>;
  /** Записать снимок. Провал записи НЕ ошибка забега: игра продолжается в памяти. */
  save(blob: string): Promise<void>;
  /** Забыть снимок (забег кончился). */
  clear(): Promise<void>;
}

/**
 * Снимок забега.
 *
 * `state` — целиком `GameState` (он JSON-сериализуем по инварианту №2), поэтому мир
 * возвращается точно, включая расписание волн: оно живёт в `state.scheduled`, а не
 * пересобирается по номеру волны.
 *
 * ⚠️ Это форма ЛОКАЛЬНОГО бэкенда, и причина, по которой она локальная, ИЗМЕНИЛАСЬ.
 * Здесь стояло «в облако не поместится: лимит 10 КБ, а состояние 29–31 КБ». **Сверка с
 * первоисточником (`YAG-0.1`/`YAG-0.2`, 2026-09-22) это опровергла:** 10 КБ — квота
 * `setStats`, а у `setData` 200 КБ, то есть состояние влезает с шестикратным запасом.
 * В облако всё равно едет компактный дескриптор ({@link ./portableRun}), но уже по
 * другим доводам — частота записи, сеть на телефоне и совместимость версий, — и они
 * переживут любой рост квоты. Граница для него, как и планировалось, уже есть: менять
 * надо бэкенд и сериализацию, а не код забега.
 */
export interface RunSave<TState = unknown> {
  v: number;
  /** Режим, под которым забег вооружён (`data.modes` id). */
  mode: string;
  /** Сложность, выбранная на запуске. */
  difficulty: string;
  state: TState;
  /** Sector Zero's persistent attempt serial and prepared ship blueprints. Older
   * saves omit these; the host adopts them without changing their live world. */
  sectorZeroAttempt?: number;
  shipLoadouts?: Record<string, string[]>;
}

/** Снимок → строка для хранилища. */
export function serializeRunSave<T>(save: RunSave<T>): string {
  return JSON.stringify(save);
}

/**
 * Строка из хранилища → снимок или `null`.
 *
 * `null` возвращается на ВСЁ сомнительное: пусто, не JSON, не объект, чужая версия, нет
 * режима/состояния. Вызывающий трактует `null` одинаково — «сохранения нет», — и никогда
 * не получает мир, собранный наполовину.
 */
export function parseRunSave(raw: string | null | undefined): RunSave | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const save = parsed as Partial<RunSave>;
  if (save.v !== RUN_SAVE_VERSION) return null;
  if (typeof save.mode !== 'string' || save.mode === '') return null;
  if (typeof save.difficulty !== 'string' || save.difficulty === '') return null;
  if (typeof save.state !== 'object' || save.state === null) return null;
  const shipLoadouts: Record<string, string[]> = {};
  if (save.shipLoadouts && typeof save.shipLoadouts === 'object' && !Array.isArray(save.shipLoadouts)) {
    for (const [id, modules] of Object.entries(save.shipLoadouts)) {
      if (Array.isArray(modules) && modules.every(m => typeof m === 'string')) shipLoadouts[id] = modules;
    }
  }
  return {
    v: save.v, mode: save.mode, difficulty: save.difficulty, state: save.state,
    ...(Number.isSafeInteger(save.sectorZeroAttempt) && save.sectorZeroAttempt! > 0
      ? { sectorZeroAttempt: save.sectorZeroAttempt } : {}),
    ...(save.shipLoadouts ? { shipLoadouts } : {}),
  };
}
