/**
 * Лента о СВОИХ героях: гибель и возвращение в строй (AUD-16).
 *
 * Ядро давно издаёт `hero.died` и `hero.respawned`, но клиент их не слушал: герой, в
 * которого игрок вложил дерево навыков и слоты, погибал МОЛЧА — узнать об этом можно было,
 * только открыв штаб и наткнувшись на «погиб». Правила строки собраны здесь, в `main.ts`
 * остаётся вызов, по образцу `fleetNews.ts`.
 *
 * 1. **Только свои.** В сети геройские события строго адресны владельцу
 *    (`MatchRoom.eventVisibleTo`: «Hero events are strictly owner-only» — их нагрузка несёт
 *    узел и флот героя, которые туман прячет от всех остальных). Соло обязано повторять
 *    тот же фильтр (доктрина `eventVisibility.ts`, пункт 5): иначе локальная симуляция
 *    показала бы гибель чужого героя за туманом, которой сетевой игрок не увидит никогда.
 *
 * 2. **Срок — честный: «не раньше чем через».** Ядро назначает ПОПЫТКУ возрождения на
 *    `cooldowns.respawn`, но попытка может не состояться: занят потолок выставленных
 *    героев или подняться негде (`hero.respawn` в `hero.ts` тогда молча выходит, и путь
 *    игрока — ручной подъём из штаба). Сказать «вернётся через сутки» значило бы пообещать
 *    то, чего ядро не обещает.
 *
 * 3. **Прошедший срок не печатается.** Перемотка времени отдаёт одной пачкой и гибель, и
 *    возвращение, а строки собираются по состоянию ПОСЛЕ пачки — там срок уже истёк.
 *    «Вернётся через 0 ч» читалось бы как ошибка; строка без срока — нет, а о самом
 *    возвращении скажет следующая строка.
 *
 * 4. **Якорь — туда, где это случилось.** Гибель привязана к последнему подтверждённому
 *    узлу героя (`Hero.location` — его ведёт `followShip`, пока корабль жив), возвращение —
 *    к миру, где поднялся новый корабль. Тап по тосту ведёт камеру туда. Узла нет на
 *    карте — строка без якоря, а не якорь в пустоту.
 */

/** Что нужно от героя в состоянии — ровно столько, чтобы тест не собирал целую партию. */
export interface HeroNewsHero {
  owner: string;
  location?: string;
  cooldowns?: Record<string, number>;
}

/** Строка ленты о герое: ключ, чей герой, якорь и — для гибели — сколько ждать. */
export type HeroNews =
  | { key: 'log.hero.died'; heroId: string; at?: string; leftMs: number }
  | { key: 'log.hero.died.bare'; heroId: string; at?: string }
  | { key: 'log.hero.respawned'; heroId: string; at?: string };

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Гибель героя. `hero` — он же в состоянии ПОСЛЕ пачки событий: из него берутся узел
 * и срок попытки возрождения (правила 2–4). Чужой герой, неизвестный герой или битая
 * нагрузка — `null`: молчание честнее строки ни о чём.
 */
export function heroDiedNews(
  payload: { owner?: unknown; heroId?: unknown },
  hero: HeroNewsHero | undefined,
  me: string,
  now: number,
  onMap: (node: string) => boolean,
): HeroNews | null {
  const heroId = str(payload.heroId);
  if (payload.owner !== me || heroId === undefined || !hero || hero.owner !== me) return null;
  const at = hero.location !== undefined && onMap(hero.location) ? hero.location : undefined;
  const respawnAt = hero.cooldowns?.respawn;
  const leftMs = typeof respawnAt === 'number' ? respawnAt - now : 0;
  return leftMs > 0
    ? { key: 'log.hero.died', heroId, at, leftMs }
    : { key: 'log.hero.died.bare', heroId, at };
}

/** Возвращение героя в строй — якорь на мир, где он поднялся (правило 4). */
export function heroRespawnedNews(
  payload: { owner?: unknown; heroId?: unknown; at?: unknown },
  me: string,
  onMap: (node: string) => boolean,
): HeroNews | null {
  const heroId = str(payload.heroId);
  if (payload.owner !== me || heroId === undefined) return null;
  const node = str(payload.at);
  return { key: 'log.hero.respawned', heroId, at: node !== undefined && onMap(node) ? node : undefined };
}
