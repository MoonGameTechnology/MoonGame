import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, data } from './game';
import { buildingLevel, type GameState } from '../../packages/shared-core/src/index';
import {
  buildingDossier,
  unitDossier,
  producesLine,
  taskDossier,
  cxRow,
  createDossiers,
  type DossierHost,
} from './dossiers';
import type { ActiveBuild, PlanetBuildQueue } from './buildQueue';

// REFM-4: first tests over the dossier/codex corpus. Locale pinned RU for the same
// reason as format.test.ts — under Node there is no browser language, so the runtime
// would fall back to EN and every name assertion would read the wrong string.
beforeAll(() => setLocale('ru'));

/** A live state with one owned world we can stage buildings on. */
function homeState(): { s: GameState; homeId: string } {
  const s = newGame();
  const home = Object.values(s.planets).find((p) => p.owner === 'p1')!;
  return { s, homeId: home.id };
}

/** A host whose live-state hooks are all explicit — the point of the REFM shape. */
function hostOf(over: Partial<DossierHost> = {}): DossierHost {
  return {
    state: () => newGame(),
    me: () => 'p1',
    pcUi: () => true,
    youColor: () => '#3ad17a',
    queueOf: () => ({ buildings: [], units: [] }) as PlanetBuildQueue,
    activeConstruction: () => null,
    progressPct: () => 0,
    ...over,
  };
}

describe('dossiers — здания', () => {
  it('незнакомое здание не роняет панель, а отдаёт null', () => {
    expect(buildingDossier('ministry_of_silly_walks', 1)).toBeNull();
  });

  it('число в тексте — ЖИВОЕ: у второго уровня шахты добыча выше', () => {
    const l1 = buildingDossier('mine', 1)!;
    const l2 = buildingDossier('mine', 2)!;
    expect(l1.name).toBe('Металлодобыча');
    const num = (d: { body: string }): number => Number(/(\d+)/.exec(d.body)?.[1] ?? 0);
    expect(num(l2)).toBeGreaterThan(num(l1));
    expect(l2.body).toContain('<em class="hl">'); // живое число подсвечено
  });

  it('уровень ниже первого подтягивается к первому (нулевой не запрашивается)', () => {
    expect(buildingDossier('mine', 0)).toEqual(buildingDossier('mine', 1));
  });

  it('здание без своего абзаца получает общий — но со своим именем', () => {
    const d = buildingDossier('hospital', 1);
    if (d) expect(d.name).not.toBe('');
  });
});

describe('dossiers — юниты', () => {
  it('незнакомый юнит → null', () => {
    expect(unitDossier('space_whale', true)).toBeNull();
  });

  it('у юнита без своего абзаца тело зависит от раскладки', () => {
    // ПК: тултип пропускает пустое тело и показывает одно имя; мобайл держит заглушку.
    expect(unitDossier('militia', true)!.body).toBe('');
    expect(unitDossier('militia', false)!.body).not.toBe('');
    expect(unitDossier('militia', true)!.name).toBe(unitDossier('militia', false)!.name);
  });

  it('у прописанного юнита раскладка на текст не влияет', () => {
    expect(unitDossier('scout', true)).toEqual(unitDossier('scout', false));
  });
});

describe('dossiers — строка выработки', () => {
  it('нули и пустой мешок дают пустую строку (разделитель « · » схлопывается)', () => {
    expect(producesLine({})).toBe('');
    expect(producesLine({ metal: 0 })).toBe('');
  });

  it('перечисляет только положительные ресурсы, по одному знаку после запятой', () => {
    expect(producesLine({ metal: 10.44, credits: 0 })).toBe('+10.4 металл/ч');
  });
});

describe('dossiers — карточка стройки (порог 50%)', () => {
  const { s, homeId } = homeState();

  it('новое здание до половины срока не даёт НИЧЕГО, после — растёт', () => {
    const at = (progress: number) =>
      taskDossier(s, homeId, 'building', 'mine', undefined, undefined, undefined, progress, 2).body;
    expect(at(0.4)).toContain('<em class="hl">0</em>/ч сейчас');
    expect(at(0.8)).not.toContain('<em class="hl">0</em>/ч сейчас');
  });

  it('АПГРЕЙД считает от текущего уровня, а не от нуля — старая добыча уже идёт', () => {
    const st = newGame();
    const p = st.planets[homeId]!;
    p.buildings.push({ type: 'mine', level: 1, hp: 20 });
    const now1 = buildingLevel(data.buildings.mine!, 1).produces.metal ?? 0;
    // progress 0: вклад дельты ещё нулевой, но БАЗА (уровень 1) уже работает целиком
    const d = taskDossier(st, homeId, 'upgrade', 'mine', undefined, undefined, 2, 0, 5);
    expect(d.name).toContain('→ L2');
    expect(d.body).toContain(`<em class="hl">${now1}</em>/ч сейчас`);
    expect(d.body).not.toContain('<em class="hl">0</em>/ч сейчас');
  });

  it('заказ в очереди не врёт про ETA', () => {
    const d = taskDossier(s, homeId, 'building', 'mine', undefined, undefined, undefined, 0, null);
    expect(d.body).toContain('В очереди');
    expect(d.body).not.toContain('Осталось');
  });

  it('заказ юнитов озаглавлен «сколько× кого»', () => {
    const d = taskDossier(s, homeId, 'unit', undefined, 'cruiser', 3, undefined, 0, 1);
    expect(d.name).toContain('3×');
    expect(d.name).toContain('крейсер');
  });

  it('незнакомое здание и пустой заказ отдают заголовок, а не падают', () => {
    expect(
      taskDossier(s, homeId, 'building', 'nonesuch', undefined, undefined, undefined, 0, 1).name,
    ).toBe('nonesuch');
    expect(
      taskDossier(s, homeId, 'building', undefined, undefined, undefined, undefined, 0, 1).name,
    ).toBe('Стройка');
  });
});

describe('dossiers — разбор ключа стройки', () => {
  const { homeId } = homeState();
  const active: ActiveBuild = {
    at: 0,
    seq: 7,
    payload: { kind: 'building', planetId: homeId, building: 'mine' },
  };

  it('активный заказ находится по seq — чужой seq не показывается', () => {
    const { constructionDossier } = createDossiers(
      hostOf({ activeConstruction: () => active, progressPct: () => 80 }),
    );
    expect(constructionDossier(`c:${homeId}:buildings:active:7`)).not.toBeNull();
    // очередь уже уехала вперёд: тот же слот, другой заказ — показывать нечего
    expect(constructionDossier(`c:${homeId}:buildings:active:6`)).toBeNull();
  });

  it('заказ из очереди берётся по индексу; выход за край → null', () => {
    const { constructionDossier } = createDossiers(
      hostOf({
        queueOf: () => ({ buildings: [{ kind: 'building', id: 'mine', count: 1 }], units: [] }),
      }),
    );
    expect(constructionDossier(`c:${homeId}:buildings:queued:0`)?.body).toContain('В очереди');
    expect(constructionDossier(`c:${homeId}:buildings:queued:1`)).toBeNull();
  });

  it('битый ключ не роняет панель', () => {
    const { constructionDossier } = createDossiers(hostOf());
    expect(constructionDossier('c:')).toBeNull();
    expect(constructionDossier(`c:${homeId}:buildings:levitating:0`)).toBeNull();
  });
});

describe('dossiers — маршрутизация objDossier', () => {
  const { objDossier } = createDossiers(hostOf());

  it('ключи-чипы отдают свои статьи', () => {
    expect(objDossier('fleet')?.name).toBeTruthy();
    expect(objDossier('tab:ground')?.name).toBeTruthy();
    expect(objDossier('division')?.name).toBeTruthy();
    expect(objDossier('act:divdesign')?.name).toBeTruthy();
  });

  it('stat: подставляет живую константу лимита стека', () => {
    expect(objDossier('stat:cap')?.body).toContain('10'); // COMBAT_UNIT_CAP
    expect(objDossier('stat:такого-нет')).toBeNull();
  });

  it('res: даёт только имя ресурса — тело пустое', () => {
    expect(objDossier('res:metal')).toEqual({ name: 'металл', body: '' });
  });

  it('b:/u: уходят в свои досье, голый и незнакомый ключ → null', () => {
    expect(objDossier('b:mine:2')).toEqual(buildingDossier('mine', 2));
    expect(objDossier('u:scout')).toEqual(unitDossier('scout', true));
    expect(objDossier('b')).toBeNull();
    expect(objDossier('что-то')).toBeNull();
  });
});

describe('codex — карточка полной информации', () => {
  const { codexHtml } = createDossiers(hostOf());

  it('незнакомый id отдаёт пустую строку, а не сломанную карточку', () => {
    expect(codexHtml('b', 'nonesuch')).toBe('');
    expect(codexHtml('u', 'nonesuch')).toBe('');
    expect(codexHtml('m', 'nonesuch')).toBe('');
    expect(codexHtml('md', 'nonesuch')).toBe('');
    expect(codexHtml('hf', 'nonesuch')).toBe('');
  });

  it('карточка здания: имя, цена, срок и уровни', () => {
    const html = codexHtml('b', 'mine');
    expect(html).toContain('Металлодобыча');
    expect(html).toContain('cx-stats');
    expect(html).toContain(cxRow('Уровни', '1').slice(0, 20)); // строка-ряд той же формы
    expect(html).toContain(buildingDossier('mine', 1)!.body); // описание = тело досье
  });

  it('карточка юнита несёт свой домен тегом и силуэт стороны', () => {
    const ship = codexHtml('u', 'cruiser');
    expect(ship).toContain('cx-tag');
    expect(ship).toContain('#3ad17a'); // цвет стороны пришёл из хоста, не из main.ts
    const ground = codexHtml('u', 'militia');
    expect(ground).not.toBe('');
    expect(ground).not.toContain('#3ad17a'); // наземные держат текстовый глиф
  });

  it('строка «Класс» не повторяет один тег дважды (domain и трейт делят ключ)', () => {
    // У наземных юнитов domain: 'ground' И трейт 'ground' — два разных механических
    // флага (fleetLaunch читает трейт, fleetOps — домен), но игроку это одна «земля».
    // До фикса танк показывал «земля, передняя линия, земля».
    const html = codexHtml('u', 'tank');
    const classRow = /Класс<\/span><span class="cx-v">([^<]*)</.exec(html)?.[1] ?? '';
    expect(classRow).not.toBe('');
    const parts = classRow.split(', ');
    expect(new Set(parts).size).toBe(parts.length); // ни один тег не встречается дважды
    expect(parts.filter((p) => p === 'земля')).toHaveLength(1);
  });

  it('статья глоссария экранируется и помечена как механика', () => {
    const html = codexHtml('m', 'fog');
    expect(html).toContain('cx-desc');
    expect(html).not.toContain('<script');
  });
});
