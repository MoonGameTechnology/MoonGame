/**
 * Печать профиля Sector Zero (`YAG-4.4`): замки 1–3 решения владельца `YAG-4.3` — «Пускай
 * будет на клиенте, но под семью замками».
 *
 * Профиль — открытый JSON в хранилище браузера. Без печати Суверены в нём выписывались за
 * минуту в инструментах разработчика, а у вошедшего игрока правка следующим сохранением
 * уезжала в облако. Печать — отпечаток `hashJson` ядра над профилем, ключом сборки и
 * привязкой. Правка любого поля руками её ломает, а новую без ключа не подобрать.
 *
 * **Правка не приживается (замок 2).** Профиль со сломанной печатью игра не берёт, а берёт
 * последнюю целую копию — теневую, которая пишется рядом с основной. Наказаний нет:
 * подделка исчезает, честный прогресс до неё остаётся.
 *
 * **Профиль старой версии принимается один раз.** Сборка без печати пишет профиль без
 * неё. Так же пишет и откат площадки на такую сборку (AUD-31), и заодно снимает флаг
 * `sealed` с отметки сверки (`cloudSync.ts`): старый разбор отметки незнакомых полей не
 * хранит. Поэтому профиль без печати на устройстве без флага — честный профиль старой
 * версии: он принимается и сразу запечатывается. Если флаг стоит, печать сняли руками —
 * это та же сломанная печать.
 *
 * **Облако не разносит подделку (замок 3).** Облачная копия запечатана с привязкой к id
 * игрока площадки. Сломанная, чужая или снятая печать — копия не принимается, и облако
 * получает целый локальный профиль. Облако — лишь копия чьего-то локального профиля. А
 * локальный профиль старой версии принимается на своём устройстве и доезжает в облако уже
 * запечатанным, поэтому строгость облака честному игроку ничего не стоит.
 *
 * **Почему у локальной копии нет привязки.** Имя устройства лежит в том же хранилище, что
 * и профиль, и копируется вместе с ним — привязка к нему ничего не запирает. Зато потеря
 * отметки с этим именем сделала бы чужим каждый профиль устройства, и честный игрок
 * остался бы без прогресса.
 *
 * **Предел.** Ключ лежит в сборке: кто её разберёт, тот вскроет и печать. Печать поднимает
 * цену накрутки с «минуты в инструментах разработчика» до «разобрать сборку» и не даёт
 * накрутке уехать в облако. Полную защиту даёт только сервер (`YAG-4.6`).
 */

import { hashJson } from '../packages/shared-core/src/index';
import type { CloudProfile } from './cloudSync';

/** Теневая копия — последний целый профиль, рядом с основным (`SECTOR_ZERO_PROGRESS_KEY`). */
export const SECTOR_ZERO_SHADOW_KEY = 'sector-zero.progress.shadow.v1';

/**
 * Ключ сборки. ⚠️ Смена ключа или правила отпечатка ломает печать КАЖДОГО сохранённого
 * профиля: игроки, у которых нет облака, потеряют прогресс. Золотой тест держит и ключ, и
 * правило — меняй их только осознанно, вместе с переходом со старой печати.
 */
const SEAL_KEY = 'sector-zero.seal.v1:78ee1104cd7d7cbe308a04e5';

/** Привязка локальной копии — пустая (почему — в шапке). */
export const LOCAL_SEAL = '';

/** Привязка облачной копии — id игрока площадки: чужая копия в этом облаке не пройдёт. */
export const cloudSeal = (playerId: string): string => `player:${playerId}`;

type Body = Record<string, unknown>;

const stamp = (body: Body, binding: string): string => hashJson([SEAL_KEY, binding, body]);

/**
 * Профиль строкой для хранилища — с печатью. Отпечаток снимается с того, что восстановит
 * JSON, а не с объекта в памяти: иначе поле со значением `undefined` ломало бы печать
 * честного профиля. Прежняя печать на входе отбрасывается.
 */
export function sealProgress(progress: object, binding: string): string {
  const { seal: _old, ...body } = JSON.parse(JSON.stringify(progress)) as Body;
  return JSON.stringify({ ...body, seal: stamp(body, binding) });
}

/**
 * Что с печатью у записи: `sealed` — цела; `unsealed` — печати нет (запись старой версии);
 * `broken` — не сходится (правка, чужая привязка) или запись не читается; `empty` — записи
 * нет.
 */
export type SealCheck = 'sealed' | 'unsealed' | 'broken' | 'empty';

export function checkSeal(raw: string | null, binding: string): SealCheck {
  if (!raw) return 'empty';
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return 'broken';
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'broken';
  const { seal, ...body } = value as Body;
  if (seal === undefined) return 'unsealed';
  return typeof seal === 'string' && seal === stamp(body, binding) ? 'sealed' : 'broken';
}

/** Откуда взят профиль на старте. */
export type LocalSource =
  /** Основная копия цела. */
  | 'main'
  /** Основная сломана или пропала — взята теневая. */
  | 'shadow'
  /** Профиль старой версии без печати: принят один раз. */
  | 'legacy'
  /** Целой копии нет: профиль начинается заново (вошедшему его вернёт облако). */
  | 'none';

export interface LocalProfile {
  /** Что разбирать; `null` — свежий профиль. */
  raw: string | null;
  from: LocalSource;
  /** Записать профиль заново, с печатью в обе копии: подделка стирается из хранилища,
   *  старый профиль запечатывается, отставшая тень догоняет основную. */
  rewrite: boolean;
}

/**
 * Какой профиль взять из хранилища. `sealedBefore` — флаг отметки сверки: это устройство
 * уже запечатывало профиль, и профиль без печати здесь — снятая печать, а не старая версия.
 */
export function pickLocalProfile(
  main: string | null,
  shadow: string | null,
  sealedBefore: boolean,
): LocalProfile {
  const mainSeal = checkSeal(main, LOCAL_SEAL);
  if (mainSeal === 'sealed') return { raw: main, from: 'main', rewrite: shadow !== main };
  if (mainSeal === 'unsealed' && !sealedBefore) return { raw: main, from: 'legacy', rewrite: true };
  if (checkSeal(shadow, LOCAL_SEAL) === 'sealed')
    return { raw: shadow, from: 'shadow', rewrite: true };
  return { raw: null, from: 'none', rewrite: false };
}

/**
 * Облачная копия, которую можно принять, — только запечатанная для ЭТОГО игрока. Иначе
 * `null`, как «облака нет»: сверка отправит туда целый локальный профиль.
 */
export function wholeCloud(cloud: CloudProfile | null, playerId: string): CloudProfile | null {
  return cloud && checkSeal(cloud.progress, cloudSeal(playerId)) === 'sealed' ? cloud : null;
}
