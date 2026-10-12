/**
 * Линейные значки нижней панели телефона, её листа «Ещё» и редактора панели в настройках
 * (UIX-3.3): 24×24, штрих цветом подписи. Одно окно выглядит одинаково везде, куда игрок
 * его поставит.
 */
import type { PhoneMoreId, PhoneSection } from '../../decisions/phoneNav';

const PATHS: Record<PhoneSection | PhoneMoreId, string> = {
  map: '<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5L9 4Z"/><path d="M9 4v13M15 6.5v13"/>',
  production:
    '<path d="M4 20h16M6 20V10l4 2.5V10l4 2.5V10l4 2.5V20"/><path d="M8 16h1.5M12 16h1.5M16 16h1.5"/>',
  science:
    '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/>' +
    '<ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/>' +
    '<ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/>',
  events: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  diplomacy:
    '<circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/>' +
    '<path d="M3 19.5c.6-3.4 2.8-5.5 5.5-5.5s4.9 2.1 5.5 5.5"/><path d="M15 14.1a5 5 0 0 1 1.5-.2c2.3 0 4.1 1.8 4.6 4.6"/>',
  mail: '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/><path d="m4 7 8 6 8-6"/>',
  pings:
    '<path d="M12 21s6-5.6 6-11a6 6 0 0 0-12 0c0 5.4 6 11 6 11Z"/><circle cx="12" cy="10" r="2.2"/>',
  market: '<path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/>',
  trader:
    '<path d="M12 4v16M8 20h8M5 7h14"/>' +
    '<path d="M5 7 2.5 13a2.5 2.5 0 0 0 5 0L5 7ZM19 7l-2.5 6a2.5 2.5 0 0 0 5 0L19 7Z"/>',
  corporation:
    '<path d="M5 20V5.5L12 3v17M12 9l7 2v9M3 20h18"/><path d="M8 8h1M8 12h1M8 16h1M15 14h1M15 17h1"/>',
  steward: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z"/>',
  dossier: '<path d="M6 3.5h8l4 4v13H6Z"/><path d="M14 3.5V8h4M9 13h6M9 16.5h4"/>',
  codex:
    '<path d="M4 5.5c2.5-1 5.5-1 8 .5 2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5Z"/>' +
    '<path d="M12 6v13.5"/>',
  settings:
    '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  save: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  abandon: '<path d="M6 21V4M6 4.5h11l-2.5 4 2.5 4H6"/>',
  exit: '<path d="M4 11 12 4l8 7"/><path d="M6.5 9.5V20h11V9.5M10 20v-5h4v5"/>',
  more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
};

/** Значок раздела или пункта: `<svg>` без подписи, её ставит кнопка. */
export function phoneIcon(id: PhoneSection | PhoneMoreId): string {
  return `<svg class="phone-icon" viewBox="0 0 24 24" aria-hidden="true">${PATHS[id]}</svg>`;
}
