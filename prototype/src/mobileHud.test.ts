/**
 * Лист телефона (`mobileHud.ts`) пишется каждый кадр. Здесь проверено, что кадр без перемен
 * ничего в листе не переписывает: тот же `hidden`, атрибут или текст, записанный заново, браузер
 * заново стилизует, и на слабом телефоне это стоило пересчёта стилей в каждом кадре.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { initMobileHud, type MobileChoice } from './mobileHud';

/** Узел страницы: ровно то, что лист трогает у DOM, и счёт записей в него. */
class FakeEl {
  writes = 0;
  id = '';
  type = '';
  className = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  parentNode: FakeEl | null = null;
  children: FakeEl[] = [];
  /** Что вернёт `querySelector` по селектору. */
  found: Record<string, FakeEl> = {};
  /** Что вернёт `querySelectorAll` по селектору. */
  foundAll: Record<string, FakeEl[]> = {};
  private hide = false;
  private text = '';
  private off = false;
  private readonly attrs = new Map<string, string>();
  private readonly classes = new Set<string>();
  readonly classList = {
    toggle: (name: string, force: boolean) => {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
      return force;
    },
    contains: (name: string) => this.classes.has(name),
  };
  get hidden(): boolean {
    return this.hide;
  }
  set hidden(v: boolean) {
    this.hide = v;
    this.writes++;
  }
  get textContent(): string {
    return this.text;
  }
  set textContent(v: string) {
    this.text = v;
    this.writes++;
  }
  get disabled(): boolean {
    return this.off;
  }
  set disabled(v: boolean) {
    this.off = v;
    this.writes++;
  }
  get firstChild(): FakeEl | null {
    return this.children[0] ?? null;
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    this.writes++;
  }
  appendChild(child: FakeEl): FakeEl {
    return this.insertBefore(child, null);
  }
  insertBefore(child: FakeEl, ref: FakeEl | null): FakeEl {
    const from = child.parentNode?.children;
    from?.splice(from.indexOf(child), 1);
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(child);
    else this.children.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  addEventListener(): void {}
  querySelector(selector: string): FakeEl | null {
    return this.found[selector] ?? null;
  }
  querySelectorAll(selector: string): FakeEl[] {
    return this.foundAll[selector] ?? [];
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Лист над карточкой своего мира: имя в шапке карточки и кнопка метки. */
function boot() {
  const made: FakeEl[] = [];
  const make = (): FakeEl => {
    const el = new FakeEl();
    made.push(el);
    return el;
  };
  const body = make();
  vi.stubGlobal('document', { createElement: make, createComment: make, body });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  const page = make();
  const side = page.appendChild(make());
  const commands = page.appendChild(make());
  side.appendChild(make());
  const name = make();
  name.textContent = 'Деймос';
  side.found['.ptitle > :first-child'] = name;
  side.found['[data-act="ping"]'] = make();
  // Метки шапки карточки: развитость и очки победы мира.
  side.foundAll['.phead .pbadge'] = [
    ['⬢ 98', 'fact:dev'],
    ['✦ 10', 'fact:vp'],
  ].map(([text, key]) => {
    const mark = make();
    mark.textContent = text!;
    mark.dataset.desc = key!;
    return mark;
  });
  const noop = (): void => {};
  const hud = initMobileHud({
    side: side as unknown as HTMLElement,
    commands: commands as unknown as HTMLElement,
    dismiss: noop,
    choose: noop,
    ping: noop,
    summary: noop,
    describe: noop,
    resized: noop,
    tab: noop,
  });
  hud.sync(true);
  const sheet = body.children.find((el) => el.id === 'mobile-sheet')!;
  return { hud, sheet, side, made, writes: () => made.reduce((n, el) => n + el.writes, 0) };
}

it('кадр без перемен ничего не переписывает в листе', () => {
  const { hud, writes } = boot();
  const choice: MobileChoice = { kind: 'fleet', id: 'f1', title: 'Флот', sub: '3' };
  const frames: Array<Parameters<typeof hud.update>> = [
    ['', false, false, []], // ничего не выбрано: лист спрятан
    ['planet:A', false, false, [], 'fleet'], // свой мир со своим флотом: вкладки
    ['planet:A', true, false, []], // режим приказа
    ['planet:A', false, false, [choice]], // выбор из нескольких под пальцем
  ];
  for (const frame of frames) {
    hud.update(...frame);
    const before = writes();
    hud.update(...frame);
    hud.update(...frame);
    expect(writes(), JSON.stringify(frame)).toBe(before);
  }
});

it('перемена по-прежнему доходит до листа', () => {
  const { hud, sheet } = boot();
  hud.update('planet:A', false, false, []);
  expect(sheet.hidden).toBe(false);
  hud.update('', false, false, []);
  expect(sheet.hidden).toBe(true);
});

it('все метки шапки карточки переезжают в лист, каждая своей кнопкой', () => {
  const { hud, made } = boot();
  hud.update('planet:A', false, false, []);
  const badges = made.filter((el) => el.className === 'mobile-badge');
  expect(badges.map((b) => [b.textContent, b.hidden])).toEqual([
    ['⬢ 98', false],
    ['✦ 10', false],
  ]);
});

/** Узел листа по классу: шапка, нижний ряд. */
const part = (sheet: FakeEl, className: string): FakeEl =>
  sheet.children.find((el) => el.className === className)!;

it('«Сведения» — значок в шапке у крестика, а не кнопка нижнего ряда', () => {
  const { hud, sheet } = boot();
  const head = part(sheet, 'mobile-sheet-head');
  expect(head.children.map((el) => el.className)).toEqual([
    'mobile-grab',
    'mobile-badge',
    'mobile-badge',
    'mobile-info btn-second',
    'mobile-close btn-x',
  ]);
  expect(part(sheet, 'mobile-quick').children.map((el) => el.dataset.mobile)).toEqual([
    'summary',
    'lift',
    'lift',
    'ping',
  ]);
  const info = head.children[3]!;
  hud.update('planet:A', false, false, []);
  expect(info.hidden).toBe(false);
  // Выбор из нескольких под пальцем: раскрывать пока нечего.
  hud.update('planet:A', false, false, [{ kind: 'fleet', id: 'f1', title: 'Флот', sub: '3' }]);
  expect(info.hidden).toBe(true);
});

it('нижний ряд виден, только пока в нём есть кнопка', () => {
  const { hud, sheet } = boot();
  const quick = part(sheet, 'mobile-quick');
  hud.update('planet:A', false, false, []); // свой мир: «Метка»
  expect(quick.hidden).toBe(false);
  hud.update('fleet:f1', false, false, []); // свёрнутый флот: ни «Метки», ни «Характеристик»
  expect(quick.hidden).toBe(true);
});

it('свёрнутый лист эскадры в полёте и на стоянке держит ряд её приказов', () => {
  const { hud, sheet, side } = boot();
  // Чужая эскадра: приказов в карточке нет, лист остаётся шапкой.
  hud.update('strike:s1', false, false, []);
  expect(sheet.classList.contains('aloft')).toBe(false);
  side.found['.aloft-acts'] = new FakeEl();
  hud.update('strike:s1', false, false, []);
  expect(sheet.classList.contains('aloft')).toBe(true);
  // Эскадра на стоянке держит свой ряд так же (плитки «как у флота», 2026-11-09).
  hud.update('sq:a', false, false, []);
  expect(sheet.classList.contains('aloft')).toBe(true);
  // Ряд приказов есть только у эскадры: у флота свой ряд команд.
  hud.update('fleet:f1', false, false, []);
  expect(sheet.classList.contains('aloft')).toBe(false);
});

it('«Построить» и ник хозяина мира — в нижнем ряду рядом с «Пингом» (UIX-10.10)', () => {
  const { hud, sheet, side } = boot();
  const lifted = () =>
    part(sheet, 'mobile-quick')
      .children.filter((el) => el.dataset.mobile === 'lift')
      .map((el) => [el.dataset.lift, el.hidden ? null : el.textContent]);
  hud.update('planet:A', false, false, []);
  expect(lifted()).toEqual([
    ['openbuild', null],
    ['seat', null],
  ]);
  const build = new FakeEl();
  build.textContent = 'Построить';
  side.found['.pacts [data-act="openbuild"]'] = build;
  hud.update('planet:A', false, false, []);
  expect(lifted()).toEqual([
    ['openbuild', 'Построить'],
    ['seat', null],
  ]);
  delete side.found['.pacts [data-act="openbuild"]'];
  const owner = new FakeEl();
  owner.textContent = 'Орлан';
  side.found['.pacts [data-act="seat"]'] = owner;
  hud.update('planet:B', false, false, []);
  expect(lifted()).toEqual([
    ['openbuild', null],
    ['seat', 'Орлан'],
  ]);
  // У флота кнопок мира нет, даже если панель ещё держит прежнюю разметку.
  hud.update('fleet:f1', false, false, []);
  expect(part(sheet, 'mobile-quick').hidden).toBe(true);
});
