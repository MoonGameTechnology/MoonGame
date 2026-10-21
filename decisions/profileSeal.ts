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
 * **Профиль без печати не принимается.** Отсутствие флага `sealed` не доказывает старую
 * версию: игрок может удалить и печать, и флаг, и тень. Такой профиль не попадает в игру
 * и облако; владелец хранилища сохраняет исходную запись отдельно для восстановления.
 * Откат площадки на сборку без печати возвращает последнюю запечатанную копию, если она
 * сохранилась: отличить новые записи старой сборки от ручной правки нельзя.
 *
 * **Облако не разносит подделку (замок 3).** Облачная копия запечатана с привязкой к id
 * игрока площадки. Полный конверт тоже запечатан: мир, дескриптор и родословную нельзя
 * заменить независимо от профиля. Старый конверт без внешней печати возвращает только
 * профиль, чья собственная печать цела; его неподписанные забеги не восстанавливаются.
 * Сломанная или чужая печать — копия не принимается. Облако — лишь копия локального
 * профиля; неподписанный локальный профиль не становится доверенным через отправку туда.
 *
 * **Почему у локальной копии нет привязки.** Имя устройства лежит в том же хранилище, что
 * и профиль, и копируется вместе с ним — привязка к нему ничего не запирает. Зато потеря
 * отметки с этим именем сделала бы чужим каждый профиль устройства, и честный игрок
 * остался бы без прогресса.
 *
 * **Предел.** Ключ лежит в сборке: кто её разберёт, тот вскроет и печать. Печать поднимает
 * цену накрутки с «минуты в инструментах разработчика» до «разобрать сборку». Целые старые
 * копии всё ещё можно повторить. Полную защиту даёт только сервер (`YAG-4.6`).
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

/** Конверт и профиль — разные домены: печати нельзя переставить между ними. */
const cloudEnvelopeSeal = (playerId: string): string => `cloud-envelope:${cloudSeal(playerId)}`;

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
 * Что с печатью у записи: `sealed` — цела; `unsealed` — печати нет;
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
  /** Целой копии нет: профиль начинается заново (вошедшему его вернёт облако). */
  | 'none';

export interface LocalProfile {
  /** Что разбирать; `null` — свежий профиль. */
  raw: string | null;
  from: LocalSource;
  /** Записать целый профиль заново в обе копии: подделка заменяется целой копией,
   *  отставшая тень догоняет основную. */
  rewrite: boolean;
}

/**
 * Какой профиль взять из хранилища: только целую основную или теневую копию.
 * `_sealedBefore` оставлен для совместимости вызовов: флаг хранится рядом с профилем,
 * удаляется вместе с печатью и больше не служит доказательством доверия.
 */
export function pickLocalProfile(
  main: string | null,
  shadow: string | null,
  _sealedBefore?: boolean,
): LocalProfile {
  const mainSeal = checkSeal(main, LOCAL_SEAL);
  if (mainSeal === 'sealed') return { raw: main, from: 'main', rewrite: shadow !== main };
  if (checkSeal(shadow, LOCAL_SEAL) === 'sealed')
    return { raw: shadow, from: 'shadow', rewrite: true };
  return { raw: null, from: 'none', rewrite: false };
}

/**
 * Печать всего облачного конверта, включая наличие снимка и дескриптора. Вызывающий
 * запечатывает каждый кандидат до проверки лимита площадки: удаление тяжёлого мира
 * меняет подписанное тело и требует новой печати.
 */
export function sealCloudProfile(
  cloud: CloudProfile,
  playerId: string,
): CloudProfile & { seal: string } {
  return JSON.parse(sealProgress(cloud, cloudEnvelopeSeal(playerId))) as CloudProfile & {
    seal: string;
  };
}

/**
 * Облачная копия, которую можно принять, — только с целой печатью ЭТОГО игрока.
 * Старая версия запечатывала лишь профиль: её прогресс сохраняется, но мир и дескриптор
 * отбрасываются, поскольку их целостность ничто не подтверждает. Внешняя печать есть,
 * но сломана — отклоняется весь конверт, без понижения до старой версии.
 */
export function wholeCloud(cloud: CloudProfile | null, playerId: string): CloudProfile | null {
  if (!cloud || checkSeal(cloud.progress, cloudSeal(playerId)) !== 'sealed') return null;
  // Сид внутри профиля запечатан и определяет владельца его забега. В старом конверте
  // внешний сид подписи не имел и не должен подменять эту привязку.
  if ((JSON.parse(cloud.progress) as Body).seed !== cloud.seed) return null;
  if ('seal' in cloud) {
    return checkSeal(JSON.stringify(cloud), cloudEnvelopeSeal(playerId)) === 'sealed'
      ? cloud
      : null;
  }
  const { run: _unsignedRun, state: _unsignedState, ...progressOnly } = cloud;
  return progressOnly;
}
