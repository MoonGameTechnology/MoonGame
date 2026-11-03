/**
 * Правила профиля Sector Zero, которые нужны не только самому профилю, но и витрине
 * (`sectorZeroShop.ts`), жетонам героев (`heroTokens.ts`) и найму (`heroRecruits.ts`).
 *
 * Лист без значимых импортов из соседей — так он рвёт круг импорта: профиль зовёт витрину
 * и жетоны, а те раньше тянули эти правила обратно из `sectorZeroProgress.ts` (SLIM-7).
 * Публичные имена `sectorZeroProgress.ts` по-прежнему реэкспортирует.
 */
import { knownSkillNodes, type GameData } from '../packages/shared-core/src/index';
import type { SectorHero, SectorZeroProgress } from './sectorZeroProgress';

/** Множитель награды за забег, переведённый в Варранты (§2 роадмапа экономики: вторая
 *  половина награды). **v0**: забег с четырьмя волнами и победой даёт 40 ⌖, первая звезда
 *  стоит 20, полная лестница одного модуля — 695. Числа калибруются телеметрией. */
export const WARRANTS_PER_REWARD = 5;

/** Варранты последнего засчитанного забега — вся сумма, с уничтоженными. Итог без разбивки
 *  (засчитан до неё) — по старому правилу, от данных. */
export function lastRunWarrants(progress: SectorZeroProgress): number {
  return progress.lastRun?.attempt === progress.settledThrough
    ? progress.lastRun.warrants
    : progress.lastReward * WARRANTS_PER_REWARD;
}

/** Герой, только что пришедший в отряд: первая ступень, без навыков, с одной стартовой
 *  способностью (призывы — не в счёт). Один рецепт на все пути прихода: стартовый герой,
 *  покупка за данные и награда за главу (`heroRecruits.ts`). */
export function newSectorHero(id: string, data: GameData): SectorHero {
  return {
    level: 1,
    skills: [],
    equipped: (data.heroes[id]?.startAbilities ?? [])
      .filter((key) => !data.heroAbilities[key]?.type.startsWith('spawn_'))
      .slice(0, 1),
  };
}

/** Сколько раз в сутки витрину можно обновить за ролик — резолюция владельца (§0.7
 *  роадмапа экономики): «1 раз в сутки + 1 раз за рекламу». */
export const SHOP_AD_REFRESHES_PER_DAY = 1;

/** Может ли ВЫБРАННЫЙ герой изучить узел прямо сейчас: ветка его, узел не изучен,
 *  предпосылки взяты. Правила каталога, и деньги их не отменяют — поэтому проверка
 *  вынесена сюда, а не продублирована в магазине второй копией. */
export function sectorSkillLegal(
  progress: SectorZeroProgress,
  id: string,
  data: GameData,
): boolean {
  const hero = own(progress.heroes, progress.selectedHero);
  return hero !== undefined && skillLearnable(progress.selectedHero, hero.skills, id, data);
}

/**
 * Одно правило «можно изучить» для Академии, магазина и чтения профиля. Изученным
 * считается и купленный узел, и ВРОЖДЁННЫЙ — тот, чья награда у архетипа со старта
 * (AUD-22, решение владельца 2026-09-24): его не продают, а узлы за ним открыты. Набор
 * известных узлов считает ядро (`knownSkillNodes`), тот же, что в `hero.skill.unlock`.
 */
export function skillLearnable(
  heroId: string,
  skills: readonly string[],
  id: string,
  data: GameData,
): boolean {
  const node = own(data.heroSkillTrees, id);
  if (!node || !sectorSkillOpenTo(node, heroId, data)) return false;
  const known = knownSkillNodes(skills, heroId, data);
  return !known.has(id) && node.requires.every((r) => known.has(r));
}

/**
 * Узел открыт герою? Правило ровно то же, что в ядре (`hero.skill.unlock`): узел БЕЗ
 * ветки — общий и доступен любому, узел с веткой — только своей.
 *
 * Здесь раньше стояло строгое равенство `node.branch === def.branch`, и оно тихо
 * расходилось с ядром: безветочный узел (`undefined !== 'transhuman'`) в подготовке
 * Sector Zero НЕ покупался, хотя на настоящей карте то же ядро его пускало. Восемь из
 * девятнадцати узлов каталога были общими — то есть треть дерева на экране подготовки
 * была недостижима, и выглядело это как «узла просто нет».
 *
 * Парковка веток (HERO-11) сделала дефект невидимым: сейчас обе стороны `undefined`, и
 * строгое равенство случайно даёт верный ответ. Именно поэтому правило приведено к
 * ядерному СЕЙЧАС, а не «когда понадобится»: иначе распарковка вернула бы вместе с
 * ветками и эту дыру, и искать её пришлось бы заново.
 */
export function sectorSkillOpenTo(
  node: { branch?: string },
  archetype: string | undefined,
  data: GameData,
): boolean {
  return (
    node.branch === undefined ||
    node.branch === (archetype !== undefined ? data.heroes[archetype]?.branch : undefined)
  );
}

/**
 * Запись таблицы по id — только СОБСТВЕННЫЙ ключ (AUD-30). `data.modules['constructor']`
 * находит не запись каталога, а наследство `Object.prototype`, и профиль из `localStorage`
 * или облака принимал такие «модули» и «героев»: «Новый забег» падал на
 * `selectedHero: "constructor"`, Мастерская — на модуле `constructor`, а действие с id
 * `__proto__` дописывало поле прямо в `Object.prototype` — все объекты игры получали
 * `level: NaN`. `hasOwnProperty.call`, а не `Object.hasOwn`: клиент идёт и в старые WebView.
 */
export function own<T>(table: Readonly<Record<string, T>>, id: unknown): T | undefined {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(table, id)
    ? table[id]
    : undefined;
}
