/** Official Phosphor regular assets, vendored with their MIT license and source pin. */
import icons from './art/phosphor/icons.json';

export type HoloIcon = keyof typeof icons;

export function holoIcon(name: HoloIcon): string {
  return `<span class="holo-icon" aria-hidden="true">${icons[name].replace('<svg ', '<svg focusable="false" aria-hidden="true" ')}</span>`;
}

/** Both skins keep the same button, label, tooltip, disabled state and handler. */
export function skinIcon(name: HoloIcon, fallback: string): string {
  return `<span class="simple-icon" aria-hidden="true">${fallback}</span>${holoIcon(name)}`;
}

const COMMAND_ICONS: Record<string, HoloIcon> = {
  move: 'arrow-bend-up-right',
  engage: 'crosshair',
  attack: 'sword',
  target: 'target',
  cast: 'sparkle',
  merge: 'arrows-merge',
  split: 'arrows-split',
  troops: 'arrows-down-up',
  more: 'list',
  pick: 'plus-circle',
  boost: 'lightning',
  qauto: 'sword',
  stop: 'square',
};

export function commandIcon(command: string, fallback: string): string {
  const name = COMMAND_ICONS[command];
  return name ? skinIcon(name, fallback) : fallback;
}
