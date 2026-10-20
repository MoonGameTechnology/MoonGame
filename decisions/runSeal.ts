/**
 * Печать сохранений забега Sector Zero. Снимок мира может выплатить победу и награду,
 * поэтому проверка одной формы JSON не делает его доверенным: правленый мир выглядел
 * бы честно завершённым. Дескриптор тоже запечатывается — он восстанавливает попытку,
 * волну и усиления.
 *
 * Привязка к seed профиля не даёт перенести сохранение в другой профиль. Раздельные
 * домены не дают подставить профиль или дескриптор вместо точного снимка. Как и печать
 * профиля, это защита от простой правки хранилища, а не серверная проверка игры.
 *
 * Старые неподписанные сохранения не принимаются: отличить честное от подделки по
 * содержимому невозможно. После проверки печати существующие разборщики проверяют
 * версию и форму и возвращают сохранение без служебного поля `seal`.
 */
import { parsePortableRun, type PortableRunSave } from './portableRun';
import { checkSeal, sealProgress } from './profileSeal';
import { parseRunSave, type RunSave } from './runSave';

const runBinding = (seed: string): string => `sector-zero.run.v1:${seed}`;
const portableBinding = (seed: string): string => `sector-zero.portable.v1:${seed}`;

/** Точный снимок для хранилища, запечатанный для профиля этого забега. */
export function serializeSealedRunSave<T>(save: RunSave<T>, seed: string): string {
  return sealProgress(save, runBinding(seed));
}

/** Только целый снимок этого профиля; неподписанное или сомнительное — `null`. */
export function parseSealedRunSave(raw: string | null | undefined, seed: string): RunSave | null {
  return checkSeal(raw ?? null, runBinding(seed)) === 'sealed' ? parseRunSave(raw) : null;
}

/** Переносимый дескриптор для хранилища с отдельным доменом печати. */
export function serializeSealedPortableRun(save: PortableRunSave, seed: string): string {
  return sealProgress(save, portableBinding(seed));
}

/** Только целый дескриптор этого профиля; неподписанное или сомнительное — `null`. */
export function parseSealedPortableRun(
  raw: string | null | undefined,
  seed: string,
): PortableRunSave | null {
  return checkSeal(raw ?? null, portableBinding(seed)) === 'sealed' ? parsePortableRun(raw) : null;
}
