import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import type { CorpInfrastructureState, CorpStanding } from '../../packages/protocol/src/corpInfrastructure';
import { updateCorpInfrastructure } from '../../packages/server/src/corpConstruction';
import type { CorpMembership, CorpRole } from './corp';
import { corpArt } from './corpArt';
import { corpHubHtml, corpHubSheetHtml, type CorpHubPaint } from './corpHubView';
import { CORP_LOTS } from './corpSprites';

beforeAll(() => setLocale('ru'));

const H = 3_600_000;

/** База так, как её отдаёт сервер: тем же кодом, каким он её собирает. */
function base(
  levels: Record<string, number>,
  influence: number,
  role: CorpRole = 'head',
  construction: CorpInfrastructureState['construction'] = null,
  standing: CorpStanding = { members: 3, battles: 0 },
) {
  const saved: CorpInfrastructureState = { levels, construction, accruedAt: 0, remainder: 0 };
  const result = updateCorpInfrastructure('c1', 'a1', role, influence, saved, 0, undefined, standing).result;
  if (!result.ok) throw new Error(result.code);
  return result.infrastructure;
}

const member = (accountId: string, login: string, role: CorpRole): CorpMembership => ({
  corpId: 'c1',
  accountId,
  login,
  role,
});
const HEAD = member('a1', 'Арго', 'head');
const ROSTER = [HEAD, member('a2', 'Вега', 'officer'), member('a3', 'Лира', 'member'), member('a4', 'Рысь', 'recruit')];

function paint(over: Partial<CorpHubPaint> = {}): CorpHubPaint {
  return {
    state: 'corp',
    section: 'base',
    corp: { corpId: 'c1', name: 'Звёздный штиль', influence: 500 },
    me: HEAD,
    members: ROSTER,
    view: base({ headquarters: 1 }, 500),
    style: null,
    elapsedMs: 0,
    rank: 3,
    journal: [],
    browse: [],
    busy: false,
    armed: null,
    badges: { members: 1, battles: 0 },
    battles: '',
    canSignIn: false,
    now: Date.UTC(2026, 9, 21, 12),
    ...over,
  };
}

const buttons = (html: string): string[] => [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);

describe('вкладка «Корпорация»: что стоит вместо разделов', () => {
  it('гость: приглашение войти, кнопка входа — только когда вход есть', () => {
    const open = corpHubHtml(paint({ state: 'guest', canSignIn: true }));
    expect(open).toContain(t('corp.hub.guest.title'));
    expect(open).toContain('data-corphub="signin"');
    expect(corpHubHtml(paint({ state: 'guest' }))).not.toContain('data-corphub="signin"');
  });

  it('до ответа — загрузка; сбой без ответа — «нет связи» с кнопкой «Обновить»', () => {
    expect(corpHubHtml(paint({ state: 'loading' }))).toContain(t('corp.hub.loading'));
    const offline = corpHubHtml(paint({ state: 'offline' }));
    expect(offline).toContain(t('corp.hub.offline'));
    expect(offline).toContain('data-corphub="refresh"');
    expect(offline).not.toContain('corp-hub-name');
  });

  it('без корпорации: поле названия с кнопкой и корпорации, куда подать заявку', () => {
    const html = corpHubHtml(
      paint({ state: 'none', me: null, corp: null, browse: [{ corpId: 'c9', name: 'Рой', influence: 40, members: 3 }] }),
    );
    expect(html).toContain('id="corp-hub-name"');
    expect(html).toContain('data-corpact="create" data-corpinput="corp-hub-name"');
    expect(html).toContain('data-corpact="apply" data-corparg="c9"');
  });

  it('заявка: ожидание с названием корпорации и отзывом', () => {
    const html = corpHubHtml(paint({ state: 'pending', me: member('a1', 'Арго', 'recruit') }));
    expect(html).toContain(t('corp.hub.pending.title', { name: 'Звёздный штиль' }));
    expect(html).toContain('data-corpact="cancel"');
  });

  it('приказ в пути гасит кнопки приказов', () => {
    const html = corpHubHtml(paint({ state: 'none', me: null, corp: null, busy: true }));
    expect(html).toMatch(/data-corpact="create"[^>]*disabled/);
  });
});

describe('вкладка «Корпорация»: база', () => {
  it('у каждого здания на панораме свой участок, а в списке — карточка', () => {
    const p = paint();
    const html = corpHubHtml(p);
    for (const id of Object.keys(CORP_LOTS)) expect(html).toMatch(new RegExp(`class="cb-lot [^"]*" style="[^"]*" data-corpbld="${id}"`));
    const cards = [...html.matchAll(/class="cb-bc [^"]*" data-corpbld="([\w-]+)"/g)].map((m) => m[1]);
    expect(cards).toEqual(p.view!.buildings.map((b) => b.id));
  });

  it('шапка несёт уровень корпорации, казну и место; ярлык «Состава» — число заявок', () => {
    const html = corpHubHtml(paint());
    expect(html).toContain(t('corp.hub.level', { n: 1 }));
    expect(html).toContain('500 ⟡');
    expect(html).toContain(t('corp.head.rank', { n: 3 }));
    expect(html).toMatch(/data-corpsec="members" aria-selected="false">[^<]*<small>1<\/small>/);
  });

  it('стройка: полоса и остаток там, где их обновляет тик', () => {
    const job = { buildingId: 'supply_center', level: 1, startedAt: 0, completesAt: H, cost: 60 };
    const html = corpHubHtml(paint({ view: base({ headquarters: 1 }, 500, 'head', job), elapsedMs: H / 2 }));
    expect(html).toContain('data-corp-bar');
    expect(html).toContain('data-corp-left');
    expect(html).toMatch(/class="cb-lot build /);
  });

  it('нет базы — «не удалось прочитать» с кнопкой «Обновить», а не пустая панорама', () => {
    const html = corpHubHtml(paint({ view: null }));
    expect(html).toContain(t('corp.buildings.unavailable'));
    expect(html).not.toContain('cb-pano');
  });

  it('лист здания: глава строит, участник читает, что стройки заказывает глава', () => {
    const head = paint();
    const sheet = corpHubSheetHtml(head, { kind: 'building', id: 'supply_center' }, '');
    expect(sheet).toContain('data-corpact="build" data-corparg="supply_center"');
    expect(sheet).toContain('role="dialog"');
    const view = base({ headquarters: 1 }, 500, 'member');
    const asMember = corpHubSheetHtml(
      paint({ me: member('a3', 'Лира', 'member'), view }),
      { kind: 'building', id: 'supply_center' },
      '',
    );
    expect(asMember).not.toContain('data-corpact="build"');
    expect(asMember).toContain(t('corp.buildings.lead-only'));
  });

  it('стройку не оплатить — кнопка серая, рядом причина', () => {
    const sheet = corpHubSheetHtml(paint({ view: base({ headquarters: 1 }, 10) }), { kind: 'building', id: 'supply_center' }, '');
    expect(sheet).not.toContain('data-corpact="build"');
    expect(sheet).toMatch(/class="btn-main" aria-disabled="true" disabled/);
    expect(sheet).toContain('cb-note warn');
  });

  it('штаб 4: участники и сыгранные битвы — в карточке уровня, в листе штаба и в таблице (CORP-6)', () => {
    const few = base({ headquarters: 3 }, 2000, 'head', null, { members: 7, battles: 3 });
    const members = t('corp.hub.req.members', { n: 15, have: 7 });
    const html = corpHubHtml(paint({ view: few }));
    expect(html).toContain(`<li class="no">${members}</li>`);
    expect(html).toContain(`<li class="no">${t('corp.hub.req.battles', { n: 10, have: 3 })}</li>`);
    expect(html).toContain(`🔒 ${members}`);
    const sheet = corpHubSheetHtml(paint({ view: few }), { kind: 'building', id: 'headquarters' }, '');
    expect(sheet).toContain(`<li class="no">${members}</li>`);
    expect(sheet).not.toContain('data-corpact="build"');
    const levels = corpHubSheetHtml(paint({ view: few }), { kind: 'levels' }, '');
    expect(levels).toContain(
      `<span class="cb-lv-cond">${t('corp.hub.levels.members', { n: 20 })} · ${t('corp.hub.levels.battles', { n: 25 })}</span>`,
    );
    expect(levels.match(/class="cb-lv-cond"/g)).toHaveLength(2);

    const ready = base({ headquarters: 3 }, 2000, 'head', null, { members: 15, battles: 10 });
    const go = corpHubSheetHtml(paint({ view: ready }), { kind: 'building', id: 'headquarters' }, '');
    expect(go).toContain('data-corpact="build" data-corparg="headquarters"');
    expect(go).toContain(`<li class="ok">${t('corp.hub.req.battles', { n: 10, have: 10 })}</li>`);
  });

  it('оперативный центр: карточка и лист называют, до какого формата он открывает битвы (CORP-7)', () => {
    const open = corpHubHtml(paint({ view: base({ headquarters: 2 }, 500) }));
    expect(open).toContain('data-corpbld="operations_center"');
    expect(open).toContain(t('corp.hub.gives', { what: t('corp.buildings.format', { n: 5 }) }));
    const built = base({ headquarters: 2, operations_center: 1 }, 500);
    const sheet = corpHubSheetHtml(paint({ view: built }), { kind: 'building', id: 'operations_center' }, '');
    expect(sheet).toContain(`<b>${t('corp.buildings.format', { n: 5 })}</b>`); // сейчас
    expect(sheet).toContain(`<b>${t('corp.buildings.format', { n: 7 })}</b>`); // следующий уровень
    expect(sheet).toContain(`<b>3</b>${t('corp.buildings.format', { n: 10 })}`); // таблица уровней
  });

  it('ответ сервера в шторке — над её содержимым', () => {
    const sheet = corpHubSheetHtml(paint(), { kind: 'levels' }, '✖ отказ');
    expect(sheet.indexOf('cb-notice')).toBeLessThan(sheet.indexOf('cb-lvtable'));
    expect(sheet).toContain('✖ отказ');
  });
});

describe('вкладка «Корпорация»: состав', () => {
  it('глава управляет всеми, кроме себя; заявки — с «Принять» и «Отклонить»', () => {
    const html = corpHubHtml(paint({ section: 'members' }));
    const manage = [...html.matchAll(/data-corphub="member" data-corparg="(\w+)"/g)].map((m) => m[1]);
    expect(manage).toEqual(['a2', 'a3']);
    expect(html).toContain('data-corpact="accept" data-corparg="a4"');
    expect(html).toContain('data-corpact="decline" data-corparg="a4"');
    expect(html).toContain('data-corpconfirm="disband"');
  });

  it('участник управлять не может и заявок не видит, а уйти — может', () => {
    const html = corpHubHtml(paint({ section: 'members', me: member('a3', 'Лира', 'member') }));
    expect(html).not.toContain('data-corphub="member"');
    expect(html).not.toContain('data-corpact="accept"');
    expect(html).toContain(t('corp.hub.apps.lead'));
    expect(html).toContain('data-corpconfirm="leave"');
  });

  it('необратимый приказ просит второго нажатия: взведённая кнопка задаёт вопрос', () => {
    const calm = corpHubHtml(paint({ section: 'members' }));
    expect(calm).toContain(`>${t('corp.disband')}</button>`);
    const armed = corpHubHtml(paint({ section: 'members', armed: 'disband' }));
    expect(armed).toMatch(/class="btn-second danger armed" data-corpact="disband"/);
    expect(armed).toContain(t('corp.hub.disband.confirm'));
  });

  it('лист участника: роль, передача и исключение; исключение тоже переспрашивает', () => {
    const sheet = corpHubSheetHtml(paint(), { kind: 'member', accountId: 'a3' }, '');
    expect(sheet).toContain('data-corprole="officer"');
    expect(sheet).toContain('data-corpconfirm="transfer:a3"');
    expect(sheet).toContain('data-corpconfirm="kick:a3"');
    const armed = corpHubSheetHtml(paint({ armed: 'kick:a3' }), { kind: 'member', accountId: 'a3' }, '');
    expect(armed).toContain(t('corp.hub.kick.confirm', { name: 'Лира' }));
  });

  it('шторка, чьей цели больше нет, не рисуется', () => {
    expect(corpHubSheetHtml(paint(), { kind: 'member', accountId: 'gone' }, '')).toBe('');
    expect(corpHubSheetHtml(paint(), { kind: 'member', accountId: 'a4' }, '')).toBe(''); // заявка — не участник
    expect(corpHubSheetHtml(paint(), { kind: 'building', id: 'gone' }, '')).toBe('');
    expect(corpHubSheetHtml(paint({ view: null }), { kind: 'levels' }, '')).toBe('');
  });
});

describe('вкладка «Корпорация»: казна', () => {
  it('движение влияния со знаком; журнал закрыт — так и сказано', () => {
    const journal = [
      { corpId: 'c1', at: Date.UTC(2026, 9, 21, 11), actor: 'Арго', action: 'building_income', detail: '7' },
      {
        corpId: 'c1',
        at: Date.UTC(2026, 9, 21, 10),
        actor: 'Арго',
        action: 'building_start',
        target: 'supply_center',
        detail: '{"level":1,"cost":60}',
      },
    ];
    const html = corpHubHtml(paint({ section: 'treasury', journal }));
    expect(html).toContain('<b class="p">+7 ⟡</b>');
    expect(html).toContain('<b class="m">−60 ⟡</b>');
    const closed = corpHubHtml(paint({ section: 'treasury', journal: null }));
    expect(closed).toContain(t('corp.history.private'));
  });
});

const styles = (head: boolean, active = 'standard', owned: string[] = ['high_tech']) => ({ head, active, owned });

describe('вкладка «Корпорация»: стиль базы (CORP-14)', () => {
  it('шапка называет стиль, и здания рисуются в нём', () => {
    const html = corpHubHtml(paint({ style: styles(true, 'high_tech') }));
    expect(html).toContain(
      `data-corphub="style">${t('corp.style.current', { name: t('corp.style.high-tech') })}</button>`,
    );
    expect(html).toContain(`href="${corpArt('headquarters', 1, 'high_tech')!.src}"`);
    expect(html).not.toContain(`href="${corpArt('headquarters', 1)!.src}"`);
  });

  it('стиль не прочитан — здания стандартные, кнопки стиля нет', () => {
    const html = corpHubHtml(paint());
    expect(html).not.toContain('data-corphub="style"');
    expect(html).toContain(`href="${corpArt('headquarters', 1)!.src}"`);
    expect(corpHubSheetHtml(paint(), { kind: 'style' }, '')).toBe('');
  });

  it('шторка: глава применяет купленный и идёт в магазин за остальными, участник смотрит', () => {
    const head = corpHubSheetHtml(paint({ style: styles(true, 'high_tech') }), { kind: 'style' }, '');
    expect(head).toContain('data-corpstyle="standard"');
    expect(head).not.toContain('data-corpstyle="high_tech"');
    expect(head).toContain('data-corpshop="imperial_gothic"');
    expect(head).toContain(t('corp.style.applied'));
    const asMember = corpHubSheetHtml(
      paint({ me: member('a3', 'Лира', 'member'), style: styles(false, 'high_tech') }),
      { kind: 'style' },
      '',
    );
    expect(asMember).not.toMatch(/data-corp(style|shop)=/);
    expect(asMember).toContain(t('corp.style.owned'));
    expect(asMember).toContain(t('corp.style.locked'));
  });
});

describe('вкладка «Корпорация»: текст и кнопки', () => {
  const all = (): string[] => {
    const sections = (['base', 'battles', 'members', 'treasury'] as const).map((section) =>
      corpHubHtml(paint({ section, battles: '<p class="chint">—</p>', style: styles(true) })),
    );
    const states = (['guest', 'loading', 'offline', 'none', 'pending'] as const).map((state) =>
      corpHubHtml(paint({ state, canSignIn: true })),
    );
    const sheets = [
      corpHubSheetHtml(paint(), { kind: 'building', id: 'headquarters' }, ''),
      corpHubSheetHtml(paint(), { kind: 'levels' }, ''),
      corpHubSheetHtml(paint(), { kind: 'member', accountId: 'a2' }, ''),
      corpHubSheetHtml(paint({ style: styles(true, 'high_tech') }), { kind: 'style' }, ''),
      corpHubSheetHtml(paint({ style: styles(false) }), { kind: 'style' }, ''),
    ];
    return [...sections, ...states, ...sheets];
  };

  it.each(['ru', 'en'] as const)('%s: сырых ключей игрок не видит', (locale) => {
    setLocale(locale);
    try {
      for (const html of all()) expect(html).not.toMatch(/\bcorp\.[a-z][a-z.-]*/);
    } finally {
      setLocale('ru');
    }
  });

  it('у каждой кнопки приказа — один из трёх стилей или крестик', () => {
    const own = /class="(cb-tab|cb-lvl|cb-lot|cb-bc)\b/;
    const bare = all()
      .flatMap(buttons)
      .filter((tag) => !own.test(tag) && !/class="[^"]*\b(btn-main|btn-second|btn-quiet|btn-x)\b/.test(tag));
    expect(bare).toEqual([]);
  });
});
