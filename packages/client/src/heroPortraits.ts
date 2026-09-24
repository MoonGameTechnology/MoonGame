/** One transparent atlas shared by the offline client and the PWA. No per-frame decoding. */
import atlasUrl from './art/heroes/portraits.webp';
import scientistUrl from './art/heroes/scientist.svg';
import {
  heroGradeGlyph,
  heroIdentity,
  type PortraitHit,
} from '../../../decisions/heroIdentity';
import type { Hero } from '../../shared-core/src/index';

/** Portraits outside the atlas — one square file per archetype. Today it is the vector
 *  draft of the fifth hero (owner's decision 2026-09-24) until real art replaces it. */
const LOOSE_ART: Readonly<Record<string, string>> = { scientist: scientistUrl };

const images = new Map<string, HTMLImageElement>();
function portraitImage(url: string): HTMLImageElement | undefined {
  let img = images.get(url);
  if (!img && typeof Image !== 'undefined') {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  return img?.complete && img.naturalWidth > 0 ? img : undefined;
}

/** Where the hero's face lives: an atlas cell, or a whole loose file. */
function portraitSource(
  archetype: string | undefined,
): { url: string; cell?: number } | undefined {
  const identity = heroIdentity(archetype);
  if (!identity) return undefined;
  if (identity.cell !== undefined) return { url: atlasUrl, cell: identity.cell };
  const loose = archetype !== undefined ? LOOSE_ART[archetype] : undefined;
  return loose !== undefined ? { url: loose } : undefined;
}

export function heroPortraitHtml(archetype: string | undefined): string {
  const src = portraitSource(archetype);
  return src ? portraitMarkup(src.url, src.cell) : '';
}

/**
 * The portrait's markup for a source URL: an atlas cell (a quarter of the sheet) or a
 * whole loose file. The URL is escaped for the attribute: the one-file builds inline an
 * SVG as a `data:` URL that keeps its double quotes, and a raw `"` would end `src` early —
 * the image arrives broken while every string check still passes.
 */
export function portraitMarkup(url: string, cell?: number): string {
  const frame =
    cell === undefined
      ? 'width:100%;max-width:none;height:100%;left:0;top:0'
      : `width:200%;max-width:none;height:200%;left:-${(cell % 2) * 100}%;top:-${Math.floor(cell / 2) * 100}%`;
  const src = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<span class="hero-portrait" aria-hidden="true" style="display:inline-block;overflow:hidden;position:relative;aspect-ratio:1"><img src="${src}" alt="" draggable="false" decoding="async" style="position:absolute;${frame}"></span>`;
}

/** Returns exactly the screen-space box used for clicks. Portraits stay upright. */
export function drawHeroPortrait(
  cx: CanvasRenderingContext2D,
  hero: Hero,
  anchor: { x: number; y: number },
  color: string,
  occupied: readonly PortraitHit[] = [],
): PortraitHit | null {
  const src = portraitSource(hero.archetype);
  const img = src ? portraitImage(src.url) : undefined;
  if (!src || !img) return null;
  const width = 58,
    height = 68;
  const box: PortraitHit = {
    heroId: hero.id,
    x: anchor.x - width / 2,
    y: anchor.y - 98,
    width,
    height,
  };
  // At most three own heroes are deployed. Stack overlapping portraits, not faces.
  for (let attempt = 0; attempt < occupied.length; attempt++) {
    const overlap = occupied.find(
      (r) =>
        box.x < r.x + r.width + 4 &&
        box.x + width + 4 > r.x &&
        box.y < r.y + r.height + 4 &&
        box.y + height + 4 > r.y,
    );
    if (!overlap) break;
    box.y = overlap.y - height - 6;
  }
  cx.save();
  cx.globalAlpha = 1;
  cx.lineWidth = 1;
  cx.strokeStyle = color;
  cx.beginPath();
  cx.moveTo(anchor.x, anchor.y - 14);
  cx.lineTo(box.x + width / 2, box.y + height);
  cx.stroke();
  // An atlas cell is a quarter of the sheet; a loose portrait is the whole image.
  const cells = src.cell === undefined ? 1 : 2;
  const cell = src.cell ?? 0;
  const sw = img.naturalWidth / cells,
    sh = img.naturalHeight / cells;
  cx.drawImage(
    img,
    (cell % cells) * sw,
    Math.floor(cell / cells) * sh,
    sw,
    sh,
    box.x,
    box.y,
    width,
    width,
  );
  // Рамки вокруг портрета на карте НЕТ (заказ владельца 2026-09-23 снял обводку HERO-12):
  // редкость читается значком на щитке ниже. Выноска и щиток — цвета ВЛАДЕЛЬЦА.
  cx.fillStyle = '#081823';
  cx.beginPath();
  cx.moveTo(box.x + 15, box.y + 53);
  cx.lineTo(box.x + 43, box.y + 53);
  cx.lineTo(box.x + 43, box.y + 64);
  cx.lineTo(box.x + 29, box.y + 68);
  cx.lineTo(box.x + 15, box.y + 64);
  cx.closePath();
  cx.fill();
  cx.stroke();
  cx.font = 'bold 13px sans-serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.fillStyle = '#f4f7fa';
  cx.fillText(heroGradeGlyph(hero.grade), box.x + width / 2, box.y + 59);
  cx.restore();
  return box;
}
