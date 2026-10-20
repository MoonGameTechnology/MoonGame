/**
 * Когда перепекать статический слой карты (REFM-60).
 *
 * Дорогая часть карты — заливка провинций и сеть лейнов — рисуется один раз в
 * закадровый холст и потом просто копируется каждый кадр. Значит нужен признак «а
 * изменилось ли что-нибудь», и составлен он должен быть честно.
 *
 * 1. **Признак строится по ЗНАНИЮ игрока, а не по правде.** Владельца и местность мира в
 *    него кладёт вызывающий, и класть он обязан то, что игроку ИЗВЕСТНО. Читай признак
 *    сырое состояние — карта перепекалась бы на скрытом захвате, и по одному факту
 *    перерисовки игрок узнал бы то, ради сокрытия чего туман и существует.
 * 2. **Знание о мирах — номер, а не строка по всем мирам.** Признак сверяется каждым
 *    кадром, и строка по всем мирам большой карты была мусором каждого кадра — на слабом
 *    телефоне и временем кадра. Номер сверяет факты о каждом мире с прошлой сверкой и
 *    растёт при любом расхождении. К прежнему значению он не возвращается, поэтому
 *    устаревшая выпечка свежей не притворится: захват туда и обратно стоит лишней выпечки,
 *    но никогда — пропущенной.
 * 3. **Размер вьюпорта и плотность пикселей — часть подписи.** После поворота экрана
 *    запеканка не того размера: её надо переснять, а не растянуть.
 *
 * Камеры в подписи нет. Когда камера сдвинулась или приблизилась, старую выпечку
 * показывают преобразованием, пока она покрывает экран, — это решает
 * `decisions/mapLayerView.ts`; подпись отвечает только на вопрос «то ли на ней
 * нарисовано».
 */

/** Что игрок знает о местности мира (`terrainEnvironmentView.ts`); `undefined` — ничего. */
export type KnownEnvironment = { kind?: string; terrain?: string } | undefined;

/** Фактов о мире в сверке: владелец, знание местности, её вид и тип. */
const FACTS = 4;

/** Номер знания игрока о мирах карты (правила 1 и 2). */
export class KnowledgeRevision {
  private facts: Array<string | boolean | null | undefined> = [];
  private revision = 0;

  /**
   * Сверить знание о мирах с прошлой сверкой. `owner` и `environment` отдают то, что игроку
   * ИЗВЕСТНО (правило 1). Номер растёт, если сменился хоть один факт или число миров.
   */
  check(
    nodes: readonly { id: string }[],
    owner: (id: string) => string | null,
    environment: (id: string) => KnownEnvironment,
  ): number {
    const facts = this.facts;
    let changed = facts.length !== nodes.length * FACTS;
    if (changed) facts.length = nodes.length * FACTS;
    for (let n = 0, i = 0; n < nodes.length; n++, i += FACTS) {
      const id = nodes[n]!.id;
      const who = owner(id);
      const env = environment(id);
      const known = env !== undefined;
      const kind = env?.kind;
      const terrain = env?.terrain;
      if (facts[i] === who && facts[i + 1] === known && facts[i + 2] === kind && facts[i + 3] === terrain) continue;
      facts[i] = who;
      facts[i + 1] = known;
      facts[i + 2] = kind;
      facts[i + 3] = terrain;
      changed = true;
    }
    if (changed) this.revision++;
    return this.revision;
  }
}

/** Из чего складывается подпись содержимого запеканки. */
export interface BakeContent {
  vw: number;
  vh: number;
  dpr: number;
  /** Чьими глазами смотрим — у другого игрока другая политическая карта. */
  me: string;
  /** Номер знания о мирах (`KnowledgeRevision`). */
  knowledge: number;
  /** Включён ли звёздный фон — графическая настройка меняет саму запеканку. */
  starfield: boolean;
}

/** Подпись содержимого: всё, от чего зависит картинка, кроме положения камеры. */
export function bakeSignature(c: BakeContent): string {
  return `${c.vw}x${c.vh}:${c.dpr.toFixed(2)}|${c.me}|${c.knowledge}|${c.starfield ? 1 : 0}`;
}
