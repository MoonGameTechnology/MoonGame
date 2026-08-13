/**
 * Метки провинций — витрина: композер, список меток и попап маркера (REFM-25).
 *
 * Права на метку живут в чистой модели (`pingPanel.ts`, PING-PANEL): свой пинг правится
 * и снимается У ВСЕХ, чужой — только прячется У МЕНЯ. Здесь только форма: три окна,
 * их разметка и обработчики. Разметка чистая, поэтому проверяется без браузера.
 *
 * Одна вещь, которую легко потерять при перекладывании: **правка метки — это снять и
 * поставить заново.** Пинг является СООБЩЕНИЕМ, отдельного «изменить текст» нет ни у
 * ленты, ни у сервера; изобретать его ради интерфейса значило бы завести второй путь
 * записи метки — с сетевым эхом это разошлось бы у союзников.
 *
 * Сеть против соло: в сетевом матче метку ставит и снимает СЕРВЕР (он же штампует id и
 * рассылает эхо), в одиночном — метка просто ложится строкой в ленту коалиции.
 */
import { t } from '../../localization/runtime';
import { COALITION, type SessionMsg } from './conversations';
import { esc } from './format';
import { canEditPing, canRemovePing, pingRows, toggleHidden, type PingRow } from './pingPanel';
import { stickToPoint } from './screenAnchor';

/** Длина описания метки — столько же стоит в `maxlength` поля ввода. */
export const PING_DESC_MAX = 80;

/** Адресат метки в композере: коалиция целиком или один игрок в личку. */
export interface PingDest {
  id: string;
  color: string;
  icon: string;
  name: string;
  /** Короткая пометка места (роль/сторона) — то же, что в списке дипломатии. */
  tag: string;
}

/** Окно «куда отправить метку». Чистая функция — ни DOM, ни состояния. */
export function pingMenuHtml(loc: string, coalitionSize: number, dms: readonly PingDest[]): string {
  const btn = (d: PingDest, cls = ''): string =>
    `<button class="pm-dst${cls}" data-pmdest="${esc(d.id)}">` +
    `<span class="pm-ic" style="color:${d.color}">${d.icon}</span>${esc(d.name)}` +
    (d.tag ? `<em>${esc(d.tag)}</em>` : '') +
    `</button>`;
  const coal = btn(
    {
      id: COALITION,
      color: 'var(--amber)',
      icon: '⚡',
      name: t('chat.tab.coalition'),
      tag: t('chat.members', { n: coalitionSize }),
    },
    ' coal',
  );
  return (
    `<div class="pm-box">` +
    `<div class="pm-head">📍 ${t('ping.title')} · <b>${esc(loc)}</b></div>` +
    `<div class="pm-sub">${t('ping.note')}</div>` +
    `<input id="pm-text" class="pm-text" maxlength="${PING_DESC_MAX}" placeholder="${t('ping.desc.ph')}" autocomplete="off">` +
    `<div class="pm-lbl">${t('ping.to.coalition')}</div>${coal}` +
    (dms.length
      ? `<div class="pm-lbl">${t('ping.to.player')}</div>${dms.map((d) => btn(d)).join('')}`
      : '') +
    `<button class="pm-cancel" data-pmcancel>${t('ping.cancel')}</button>` +
    `</div>`
  );
}

/** Как показать строку списка: имя провинции, имя автора и его цвет. */
export interface PingRowView {
  where: string;
  who: string;
  color: string;
}

/** Список меток коалиции — свои и союзные вперемешку, порядок задаёт модель.
 *  Шапка СТАНДАРТНАЯ (`.lw-head` + ✕), как у лога, технологий и «Хранителя». */
export function pingPanelHtml(
  rows: readonly PingRow[],
  view: (row: PingRow) => PingRowView,
): string {
  const body = rows.length
    ? rows
        .map((r) => {
          const v = view(r);
          return (
            `<div class="pp-row${r.hidden ? ' off' : ''}" data-ploc="${esc(r.loc)}">` +
            `<i class="pp-dot" style="background:${v.color}"></i>` +
            `<span class="pp-txt"><b>${esc(v.where)}</b><span>${esc(r.text || '—')} · ${esc(v.who)}</span></span>` +
            `<button data-pact="go" title="${t('ping.panel.go')}">🎯</button>` +
            `<button data-pact="hide" title="${t(r.hidden ? 'ping.panel.show' : 'ping.panel.hide')}">${r.hidden ? '🙈' : '👁'}</button>` +
            // Кнопки правки и снятия ставит ПРАВО из модели, а не разметка: у чужой
            // метки их просто нет.
            (canEditPing(r)
              ? `<button data-pact="edit" title="${t('ping.panel.edit')}">✎</button>`
              : '') +
            (canRemovePing(r)
              ? `<button data-pact="del" title="${t('ping.panel.del')}">✕</button>`
              : '') +
            `</div>`
          );
        })
        .join('')
    : `<div class="pp-empty">${t('ping.panel.empty')}</div>`;
  return (
    `<div class="lw-head"><b>${t('ping.panel.title')}</b>` +
    `<button class="lw-close" data-pact="close" aria-label="${t('card.close')}">✕</button></div>` +
    body
  );
}

/** Попап тапнутого маркера: кто поставил, что написал, куда прыгнуть. Кнопка снятия —
 *  только у СВОЕЙ метки (чужую снять нельзя, её можно лишь спрятать в списке). */
export function pingPopHtml(
  loc: string,
  who: string,
  color: string,
  text: string,
  mine: boolean,
): string {
  return (
    `<div class="pp-top"><b style="color:${color}">📍 ${esc(who)}</b><span>${esc(loc)}</span></div>` +
    `<div class="pp-desc">${text ? esc(text) : `<i>${t('ping.no-desc')}</i>`}</div>` +
    `<div class="pp-act"><button class="pp-jump" data-loc="${esc(loc)}">${t('chat.jump')}</button>` +
    (mine ? `<button class="pp-del" data-loc="${esc(loc)}">${t('ping.remove')}</button>` : '') +
    `</div>`
  );
}

/** Активные метки коалиции: одна на провинцию, последняя побеждает. Карта и список
 *  берут метки ОТСЮДА — иначе они разошлись бы между собой. */
export function activePings(messages: readonly SessionMsg[]): SessionMsg[] {
  const byLoc = new Map<string, SessionMsg>();
  for (const m of messages) if (m.to === COALITION && m.ping) byLoc.set(m.ping, m);
  return [...byLoc.values()];
}

/** Сетевой путь метки: сервер штампует id и рассылает эхо всем союзникам. */
export interface PingNet {
  placePing(p: { kind: 'mark'; target: { node: string }; label: string }): void;
  clearPing(pingId: string): void;
}

/** Что витрина берёт у клиента. Ни лентой сообщений, ни камерой она не владеет. */
export interface PingHost {
  /** Окна: композер (`#pingmenu`), список (`#pingpanel`), попап маркера (`#pingpop`). */
  menuRoot(): HTMLElement | null;
  panelRoot(): HTMLElement | null;
  popRoot(): HTMLElement | null;
  me(): string;
  /** Провинция, выбранная в панели: по ней открывается композер. */
  selected(): string | null;
  /** Существует ли такая провинция (метка на пустоту не ставится). */
  hasProvince(loc: string): boolean;
  /** Лента сессии — единственный носитель меток. */
  messages(): SessionMsg[];
  /** Локальное снятие своей метки в одиночном матче. */
  setMessages(next: SessionMsg[]): void;
  /** Положить строку в ленту (соло-путь метки). */
  push(to: string, text: string, loc: string): void;
  /** Сеть, если матч сетевой. */
  net(): PingNet | null;
  /** Собеседники для личных меток (себя отфильтрует модуль) и размер коалиции. */
  seats(): string[];
  coalitionSize(): number;
  name(id: string): string;
  color(id: string): string;
  badge(id: string): { icon: string; tag: string };
  provinceName(loc: string): string;
  note(text: string): void;
  /** Камера — к метке. `focus` из списка, `jump` из попапа: у клиента это разные пути. */
  focus(loc: string): void;
  jump(loc: string): void;
  /** Экранная позиция узла для попапа (уже в координатах страницы). */
  anchor(loc: string): { left: number; top: number } | null;
  /** Ширина окна: по ней всплывашка зажимается, чтобы не уехать за край (REFM-133). */
  viewportW(): number;
  /** Спросить новый текст метки (в клиенте — `prompt`). `null` = передумал. */
  ask(current: string): string | null;
  /** Лента видна — перерисовать её после снятия метки. */
  onFeedChanged(): void;
}

export interface PingUi {
  /** Композер. */
  openMenu(): void;
  closeMenu(): void;
  menuOpen(): boolean;
  /** Отправить составленную метку адресату (`COALITION` или id игрока). */
  createTo(dest: string): void;
  /** Список меток. */
  openPanel(): void;
  closePanel(): void;
  togglePanel(): void;
  panelOpen(): boolean;
  renderPanel(): void;
  /** Попап маркера. */
  openPop(loc: string): void;
  closePop(): void;
  /** Метки для карты: активные минус спрятанные локально. */
  drawable(): SessionMsg[];
  /** Снять СВОЮ метку (сеть — через сервер, соло — из ленты). */
  remove(loc: string): void;
}

/** Собрать витрину меток. Обработчики окон вешаются здесь же, один раз. */
export function initPingUi(host: PingHost): PingUi {
  let menuLoc: string | null = null;
  let panelOpen = false;
  let hidden: ReadonlySet<string> = new Set();

  const rows = (): PingRow[] => pingRows(host.messages(), host.me(), hidden);
  const rowAt = (loc: string): PingRow | undefined => rows().find((r) => r.loc === loc);

  function closeMenu(): void {
    menuLoc = null;
    host.menuRoot()?.classList.remove('show');
  }

  function openMenu(): void {
    const loc = host.selected();
    if (!loc || !host.hasProvince(loc)) {
      host.note(t('chat.ping.need-province.short')); // метку ставят НА провинцию
      return;
    }
    menuLoc = loc;
    const el = host.menuRoot();
    if (el) {
      el.innerHTML = pingMenuHtml(
        loc,
        host.coalitionSize(),
        host
          .seats()
          .filter((id) => id !== host.me())
          .map((id) => ({
            id,
            color: host.color(id),
            icon: host.badge(id).icon,
            name: host.name(id),
            tag: host.badge(id).tag,
          })),
      );
      el.classList.add('show');
      (el.querySelector('#pm-text') as HTMLInputElement | null)?.focus();
    }
  }

  /** Текст из поля композера, обрезанный до предела поля ввода. */
  const draftText = (): string => {
    const input = host.menuRoot()?.querySelector('#pm-text') as HTMLInputElement | null;
    return (input?.value.trim() ?? '').slice(0, PING_DESC_MAX);
  };

  /** Поставить метку: коалиции (сеть → сервер, соло → лента) или игроку в личку. */
  function createTo(dest: string): void {
    const loc = menuLoc;
    if (!loc || !host.hasProvince(loc)) {
      closeMenu();
      return;
    }
    const desc = draftText();
    const fallback = t('ping.mark', { loc });
    if (dest === COALITION) {
      const net = host.net();
      if (net) net.placePing({ kind: 'mark', target: { node: loc }, label: desc });
      else host.push(COALITION, desc || fallback, loc);
      host.note(t('ping.sent.coalition'));
    } else {
      host.push(dest, desc || fallback, loc);
      host.note(t('ping.sent.player', { who: host.name(dest) }));
    }
    closeMenu();
  }

  function renderPanel(): void {
    const el = host.panelRoot();
    if (!el) return;
    el.innerHTML = pingPanelHtml(rows(), (r) => ({
      where: host.hasProvince(r.loc) ? host.provinceName(r.loc) : r.loc,
      who: host.name(r.from),
      color: host.color(r.from),
    }));
  }

  function openPanel(): void {
    panelOpen = true;
    renderPanel();
    host.panelRoot()?.classList.add('show');
  }
  function closePanel(): void {
    panelOpen = false;
    host.panelRoot()?.classList.remove('show');
  }

  function closePop(): void {
    host.popRoot()?.classList.remove('show');
  }

  function openPop(loc: string): void {
    const m = activePings(host.messages()).find((p) => p.ping === loc);
    const at = host.anchor(loc);
    const el = host.popRoot();
    if (!m || !at || !el) return;
    const mine = m.from === host.me();
    el.innerHTML = pingPopHtml(
      loc,
      mine ? t('chat.you') : host.name(m.from),
      host.color(m.from),
      m.text,
      mine,
    );
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
    el.classList.add('show');
    // Всплывашка висит над точкой так же, как меню «Приказа», значит и поправки у неё те
    // же (`screenAnchor.ts`, REFM-133): без них у края экрана её срезало, а под верхним
    // хромом она пряталась за ним. Считать можно только по ПОКАЗАННОЙ коробке — у скрытой
    // ширина нулевая.
    const b = el.getBoundingClientRect();
    const at2 = stickToPoint(
      { x: at.left, y: at.top },
      { width: b.width, top: b.top },
      host.viewportW(),
    );
    el.style.left = `${at2.x}px`;
    el.style.top = `${at2.y}px`;
  }

  /** Снять СВОЮ метку. В сети это делает сервер (эхо `ping.removed` уберёт её у всех),
   *  в одиночном — вычёркиваем свои строки из ленты. */
  function remove(loc: string): void {
    const mine = activePings(host.messages()).find((p) => p.ping === loc && p.from === host.me());
    const net = host.net();
    if (net && mine?.pingId) {
      net.clearPing(mine.pingId);
      closePop();
      return;
    }
    host.setMessages(
      host
        .messages()
        .filter((m) => !(m.to === COALITION && m.ping === loc && m.from === host.me())),
    );
    closePop();
    host.onFeedChanged();
  }

  // --- обработчики окон ------------------------------------------------------
  const menuEl = host.menuRoot();
  menuEl?.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    const dest = (tg.closest('.pm-dst') as HTMLElement | null)?.dataset.pmdest;
    if (dest) return createTo(dest);
    if (tg.closest('[data-pmcancel]') || tg === menuEl) closeMenu();
  });
  menuEl?.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' && (ke.target as HTMLElement).id === 'pm-text') {
      e.preventDefault();
      createTo(COALITION); // Enter в поле — метка коалиции, самый частый адресат
    } else if (ke.key === 'Escape') {
      closeMenu();
    }
  });

  host.panelRoot()?.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('[data-pact]') as HTMLElement | null;
    if (!btn) return;
    const act = btn.dataset.pact;
    if (act === 'close') return void closePanel();
    const id = (btn.closest('[data-ploc]') as HTMLElement | null)?.dataset.ploc;
    if (!id) return;
    if (act === 'go') {
      host.focus(id); // камера — к любой метке: смотреть не запрещено никому
      closePanel();
      return;
    }
    if (act === 'hide') {
      hidden = toggleHidden(hidden, id); // ЛОКАЛЬНО — у союзника метка цела
      renderPanel();
      return;
    }
    if (act === 'edit') {
      const row = rowAt(id);
      if (!row || !canEditPing(row)) return; // право проверяет модель, не разметка
      const next = host.ask(row.text);
      if (next === null) return;
      const text = next.trim();
      // Правка = снять и поставить заново (см. шапку модуля).
      remove(id);
      const net = host.net();
      if (net) net.placePing({ kind: 'mark', target: { node: id }, label: text });
      else host.push(COALITION, text || t('ping.mark', { loc: id }), id);
      renderPanel();
      return;
    }
    if (act === 'del') {
      const row = rowAt(id);
      if (row && canRemovePing(row)) remove(id);
      renderPanel();
    }
  });

  host.popRoot()?.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    const jump = (tg.closest('.pp-jump') as HTMLElement | null)?.dataset.loc;
    if (jump) {
      closePop();
      host.jump(jump);
      return;
    }
    const del = (tg.closest('.pp-del') as HTMLElement | null)?.dataset.loc;
    if (del) remove(del);
  });

  return {
    openMenu,
    closeMenu,
    menuOpen: () => menuLoc !== null,
    createTo,
    openPanel,
    closePanel,
    togglePanel: () => (panelOpen ? closePanel() : openPanel()),
    panelOpen: () => panelOpen,
    renderPanel,
    openPop,
    closePop,
    drawable: () => activePings(host.messages()).filter((m) => !hidden.has(m.ping!)),
    remove,
  };
}
