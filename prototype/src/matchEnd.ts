/**
 * Конец матча и награда за него (REFM-27).
 *
 * Исход берётся из АВТОРИТЕТНОГО состояния `match` — его считает модуль победы в ядре,
 * и локальная симуляция с сетевым сервером гоняют один и тот же код. Клиент не
 * додумывает победу сам и не переранжирует таблицу.
 *
 * Главное, что здесь стоит теста, — **идемпотентность награды**. Флаг «уже выдано» живёт
 * в памяти вкладки и переживает уход в хаб, но переподключение к уже законченному матчу
 * его сбрасывает: без второго рубежа обновление страницы фармило бы опыт бесконечно.
 * Поэтому награда помечается ДОЛГОВЕЧНОЙ меткой, привязанной к моменту конца матча и
 * нику; повторный конец того же матча не начисляет ничего, а показывает ТУ ЖЕ квитанцию
 * вместо обманчивого «+0». Счётчики карьеры едут на той же метке — их тоже нельзя
 * фармить перезаходом.
 */
import { t } from '../../localization/runtime';
import type { GameState } from '../../packages/shared-core/src/index';
import type { MatchEnd } from './endScreen';
import { matchXp, metaLevel, recordMatch, type MetaState } from './meta';

/** Долговечная метка выдачи: за какой конец матча и сколько уже заплачено. */
export interface AwardMarker {
  /** Момент конца матча — он и делает метку уникальной для КАЖДОГО матча. */
  at: string;
  xp: number;
}

/** Причина конца матча простыми словами (чья это победа — говорит заголовок). */
export function endReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'domination':
      return t('ai.end.domination');
    case 'elimination':
      return t('ai.end.elimination');
    case 'score':
      return t('ai.end.score');
    case 'timeout':
      return t('ai.end.timeout');
    // PVE-4. Без этих двух веток кооп-финал уезжал бы к игроку невнятным «матч
    // завершён» — деградация есть, но она врёт про то, чем всё кончилось.
    case 'pve-cleared':
      return t('ai.end.pve-cleared');
    case 'pve-failed':
      return t('ai.end.pve-failed');
    default:
      return t('ai.end.over');
  }
}

/**
 * Исход глазами игрока. Коалиция побеждает ВМЕСТЕ (SES-1): победитель — каждый в
 * `winners`, а не только верхний по очкам в `winner`. Ничья — конец без победителя.
 */
export function outcomeOf(
  match: { winner?: string | null; winners?: string[] } | undefined,
  me: string,
): { won: boolean; draw: boolean } {
  const won = match?.winner === me || (match?.winners?.includes(me) ?? false);
  return { won, draw: !won && (match?.winner ?? null) === null };
}

/** Прочитать метку выдачи. Испорченная метка НЕ блокирует ход дела — читается как
 *  «выдачи не было» (fail-open: игрок не должен терять награду из-за мусора в хранилище). */
export function parseAwardMarker(raw: string | null): AwardMarker | null {
  try {
    const v = JSON.parse(raw ?? 'null') as AwardMarker | null;
    return v && typeof v.at === 'string' && typeof v.xp === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** Ключ метки: у каждого ника своя история наград. */
export function awardKeyFor(nick: string): string {
  return 'vd.xpawarded.' + (nick.trim() || 'guest');
}

/** Момент конца матча как метка. Дев-хук завершения матча его не проставляет — тогда
 *  метка общая, и повторный конец в той же вкладке заслуженно считается тем же. */
export function endStampOf(match: { endedAt?: number } | undefined): string {
  return String(match?.endedAt ?? 'ended');
}

/** Что даёт конкретный конец матча: сколько опыта и не поднялся ли уровень. */
export interface Award {
  xp: number;
  levelUp: number | null;
  /** Новая мета для записи; `null` — записывать нечего (это повтор). */
  meta: MetaState | null;
  /** Новая метка для записи; `null` — повтор, метка уже стоит. */
  marker: AwardMarker | null;
}

/**
 * Посчитать награду ОДИН раз за матч. Совпала метка — это повтор: возвращаем ту же
 * сумму и ничего не пишем. Иначе считаем опыт, прогоняем счётчики карьеры и отдаём
 * новое состояние меты вместе с меткой.
 */
export function awardOnce(
  prior: AwardMarker | null,
  endStamp: string,
  meta: MetaState,
  result: { won: boolean; score: number; place?: number },
): Award {
  if (prior?.at === endStamp) return { xp: prior.xp, levelUp: null, meta: null, marker: null };
  const xp = matchXp({ won: result.won, score: result.score });
  const before = metaLevel(meta.xp);
  // Место приходит из таблицы наград ЯДРА (модуль победы считает стандартное
  // соревновательное ранжирование) — клиент таблицу не переранжирует. У дев-хука
  // завершения матча места нет, и `recordMatch` считает такой матч, не давая ему
  // испортить среднее.
  const next = recordMatch(
    { ...meta, xp: meta.xp + xp },
    {
      won: result.won,
      score: result.score,
      ...(result.place !== undefined ? { place: result.place } : {}),
    },
  );
  const after = metaLevel(next.xp);
  return { xp, levelUp: after > before ? after : null, meta: next, marker: { at: endStamp, xp } };
}

/** Что витрина конца матча берёт у клиента. */
export interface MatchEndHost {
  state(): GameState;
  me(): string;
  /** Ник для ключа метки: история наград у каждого своя. */
  nick(): string;
  /** Экран итогов уже на месте — второй раз считать нечего. */
  endShown(): boolean;
  readMarker(key: string): string | null;
  writeMarker(key: string, value: string): void;
  loadMeta(): MetaState;
  saveMeta(m: MetaState): void;
}

export interface MatchEndWatch {
  /** Матч закончился — вернуть итог для экрана; иначе `null`. Зовётся каждый кадр. */
  check(): MatchEnd | null;
  /** Новый матч (или переподключение к нему) — считать заново. */
  reset(): void;
}

export function initMatchEnd(host: MatchEndHost): MatchEndWatch {
  // Флаг вкладки: он переживает уход в хаб (иначе «Победа!» всплыла бы над меню), но
  // сам по себе не спасает от перезагрузки страницы — за это отвечает метка.
  let handled = false;

  function check(): MatchEnd | null {
    if (handled || host.endShown()) return null;
    const s = host.state();
    if (s.match?.status !== 'ended') return null;
    handled = true;
    const { won, draw } = outcomeOf(s.match, host.me());
    const key = awardKeyFor(host.nick());
    const stamp = endStampOf(s.match);
    const award = awardOnce(parseAwardMarker(host.readMarker(key)), stamp, host.loadMeta(), {
      won,
      score: s.match.scores?.[host.me()]?.total ?? 0,
      ...(s.match.rewards?.[host.me()]?.place !== undefined
        ? { place: s.match.rewards[host.me()]!.place }
        : {}),
    });
    if (award.meta) host.saveMeta(award.meta);
    if (award.marker) host.writeMarker(key, JSON.stringify(award.marker));
    return {
      won,
      draw,
      why: endReasonText(s.match.reason),
      xp: award.xp,
      levelUp: award.levelUp,
      dismissed: false,
    };
  }

  return {
    check,
    reset: () => {
      handled = false;
    },
  };
}
