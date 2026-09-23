/** One transparent atlas shared by the offline client and the PWA. No per-frame decoding. */
import atlasUrl from './art/heroes/portraits.webp';
import {
  heroGradeGlyph,
  heroIdentity,
  type PortraitHit,
} from '../../../decisions/heroIdentity';
import type { Hero } from '../../shared-core/src/index';

let atlas: HTMLImageElement | undefined;
function portraitImage(): HTMLImageElement | undefined {
  if (!atlas && typeof Image !== 'undefined') {
    atlas = new Image();
    atlas.src = atlasUrl;
  }
  return atlas?.complete && atlas.naturalWidth > 0 ? atlas : undefined;
}

export function heroPortraitHtml(archetype: string | undefined): string {
  const identity = heroIdentity(archetype);
  if (!identity) return '';
  const col = identity.cell % 2,
    row = Math.floor(identity.cell / 2);
  return `<span class="hero-portrait" aria-hidden="true" style="display:inline-block;overflow:hidden;position:relative;aspect-ratio:1"><img src="${atlasUrl}" alt="" draggable="false" decoding="async" style="position:absolute;width:200%;max-width:none;height:200%;left:-${col * 100}%;top:-${row * 100}%"></span>`;
}

/** Returns exactly the screen-space box used for clicks. Portraits stay upright. */
export function drawHeroPortrait(
  cx: CanvasRenderingContext2D,
  hero: Hero,
  anchor: { x: number; y: number },
  color: string,
  occupied: readonly PortraitHit[] = [],
): PortraitHit | null {
  const identity = heroIdentity(hero.archetype);
  const img = portraitImage();
  if (!identity || !img) return null;
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
  const sw = img.naturalWidth / 2,
    sh = img.naturalHeight / 2;
  cx.drawImage(
    img,
    (identity.cell % 2) * sw,
    Math.floor(identity.cell / 2) * sh,
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
