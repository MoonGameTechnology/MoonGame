/**
 * «Космический хаос» под картой (заказ владельца 2026-09-25): «карта какая-то стерильная,
 * прослеживается топология». Мозаика провинций, тонкие границы и дороги лежали на ровном
 * тёмном фоне, а сам фон — картинка, прибитая к ЭКРАНУ: карта ехала над ним, и между
 * линиями было пусто. Этот слой прибит к МИРУ — туманности неровной формы, тёмные
 * пылевые рукава, звёздные скопления и россыпь звёзд едут вместе с картой.
 *
 * Только украшение: ни правил, ни попаданий, ни тумана войны. Поэтому
 *
 * 1. **Сцена детерминирована по ключу карты.** Тот же ключ — та же сцена: перепечка слоя
 *    на каждом кадре панорамы не должна перетасовывать облака.
 * 2. **Облака и рукава рисуются СПРАЙТАМИ.** Каждое облако — пачка радиальных градиентов,
 *    их печать один раз в свой холст; кадр только масштабирует картинку. Иначе панорама,
 *    которая перепекает статик-слой каждый кадр, платила бы за десятки градиентов.
 * 3. **Вуаль поверх границ — тонкая.** Второй проход тех же облаков над провинциями
 *    размывает идеальные линии, но цвет владельца и дороги должны читаться.
 */

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Puff {
  /** Смещение от центра облака в долях его радиуса. */
  dx: number;
  dy: number;
  /** Радиус пуфа в долях радиуса облака. */
  r: number;
  alpha: number;
}

export interface Cloud {
  x: number;
  y: number;
  /** Радиус в единицах карты. */
  r: number;
  color: string;
  /** Вторая краска — облако переливается, а не заливается одним цветом. */
  tint: string;
  puffs: Puff[];
  /** Вытянутость и поворот — туманность не круг. */
  stretch: number;
  angle: number;
  /** Зерно фактуры: сгустки, волокна и прорехи внутри облака. */
  grain: number;
}

export interface Lane {
  x: number;
  y: number;
  length: number;
  width: number;
  angle: number;
  alpha: number;
}

export interface Star {
  x: number;
  y: number;
  /** Размер точки в пикселях экрана — звёзды не растут с зумом. */
  size: number;
  alpha: number;
  color: string;
  /** Яркая звезда с лучами. */
  glint: boolean;
}

export interface ChaosScene {
  clouds: Cloud[];
  lanes: Lane[];
  stars: Star[];
}

/** Краски туманностей: бирюза карты плюс то, чего на ней не было, — фиолет, маджента,
 *  янтарь и глубокий синий. */
const NEBULA = ['#2fb8c4', '#7b5cff', '#c0469a', '#d98a3a', '#3a6bd8', '#45c49a'];
const STAR = ['#ffffff', '#cfe8ff', '#ffe7c4', '#bfeee6', '#ffd0e6'];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — маленький детерминированный поток для раскладки (правило 1). */
function stream(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Раскладка сцены в координатах карты (правило 1). Поле шире карты на четверть: у края
 *  карты космос не обрывается. */
export function chaosScene(key: string, b: Bounds): ChaosScene {
  const rnd = stream(hash(key));
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const span = Math.max(w, h);
  const pad = 0.25;
  const at = () => ({
    x: b.minX - w * pad + rnd() * w * (1 + 2 * pad),
    y: b.minY - h * pad + rnd() * h * (1 + 2 * pad),
  });
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;

  const clouds: Cloud[] = [];
  // Облака раскладываются по сетке со случайным сдвигом: чистая случайность сбивала их
  // в кучи и оставляла середину карты пустой — ту самую стерильность.
  const COLS = 4;
  const ROWS = 3;
  const cells: Array<{ x: number; y: number }> = [];
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) {
      if (rnd() < 0.2) continue;
      cells.push({
        x: b.minX - w * pad + ((col + 0.15 + rnd() * 0.7) / COLS) * w * (1 + 2 * pad),
        y: b.minY - h * pad + ((row + 0.15 + rnd() * 0.7) / ROWS) * h * (1 + 2 * pad),
      });
    }
  for (const cell of cells) {
    const puffs: Puff[] = [];
    // Пуфы идут случайным блужданием — край облака рваный, а не круглый.
    let px = 0;
    let py = 0;
    const n = 5 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      puffs.push({ dx: px, dy: py, r: 0.35 + rnd() * 0.45, alpha: 0.5 + rnd() * 0.5 });
      px = Math.max(-0.55, Math.min(0.55, px + (rnd() - 0.5) * 0.6));
      py = Math.max(-0.55, Math.min(0.55, py + (rnd() - 0.5) * 0.6));
    }
    clouds.push({
      ...cell,
      r: span * (0.07 + rnd() * 0.13),
      color: pick(NEBULA),
      tint: pick(NEBULA),
      puffs,
      stretch: 1.2 + rnd() * 1.3,
      angle: rnd() * Math.PI,
      grain: Math.floor(rnd() * 2 ** 31),
    });
  }

  // Второй ярус — мелкие клочья газа между большими облаками: при приближении камеры
  // промежутки иначе снова пустели.
  const cloudOf = (x: number, y: number, r: number): Cloud => {
    const puffs: Puff[] = [];
    let px = 0;
    let py = 0;
    for (let k = 0; k < 4; k++) {
      puffs.push({ dx: px, dy: py, r: 0.35 + rnd() * 0.45, alpha: 0.5 + rnd() * 0.5 });
      px = Math.max(-0.55, Math.min(0.55, px + (rnd() - 0.5) * 0.6));
      py = Math.max(-0.55, Math.min(0.55, py + (rnd() - 0.5) * 0.6));
    }
    return {
      x,
      y,
      r,
      color: pick(NEBULA),
      tint: pick(NEBULA),
      puffs,
      stretch: 1.3 + rnd() * 1.8,
      angle: rnd() * Math.PI,
      grain: Math.floor(rnd() * 2 ** 31),
    };
  };
  for (let i = 0; i < 16; i++) {
    const p = at();
    clouds.push(cloudOf(p.x, p.y, span * (0.025 + rnd() * 0.04)));
  }

  const lanes: Lane[] = [];
  const laneCount = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < laneCount; i++)
    lanes.push({
      ...at(),
      length: span * (0.3 + rnd() * 0.35),
      width: span * (0.03 + rnd() * 0.05),
      angle: rnd() * Math.PI,
      alpha: 0.35 + rnd() * 0.3,
    });

  const stars: Star[] = [];
  // Скопления: звёзды гуще вокруг нескольких центров, остальное — редкая россыпь.
  const hubs = Array.from({ length: 4 }, () => ({ ...at(), r: span * (0.05 + rnd() * 0.08) }));
  for (let i = 0; i < 520; i++) {
    const hub = i < 220 ? hubs[i % hubs.length]! : null;
    const p = hub
      ? (() => {
          const a = rnd() * Math.PI * 2;
          const d = hub.r * Math.sqrt(rnd());
          return { x: hub.x + Math.cos(a) * d, y: hub.y + Math.sin(a) * d };
        })()
      : at();
    const bright = rnd();
    stars.push({
      ...p,
      size: bright > 0.97 ? 2.2 : bright > 0.85 ? 1.4 : 0.9,
      alpha: 0.25 + bright * 0.6,
      color: pick(STAR),
      glint: bright > 0.985,
    });
  }
  return { clouds, lanes, stars };
}

/** Спрайт облака (правило 2). Холст квадратный; вытянутость даёт отрисовка. */
const SPRITE = 256;
const cloudSprites = new WeakMap<Cloud, HTMLCanvasElement | null>();
const laneSprites = new Map<number, HTMLCanvasElement | null>();

function canvas(size: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function cloudSprite(cloud: Cloud): HTMLCanvasElement | null {
  if (cloudSprites.has(cloud)) return cloudSprites.get(cloud)!;
  const c = canvas(SPRITE);
  const g = c?.getContext('2d');
  if (c && g) {
    const half = SPRITE / 2;
    g.globalCompositeOperation = 'lighter';
    for (const [i, puff] of cloud.puffs.entries()) {
      const x = half + puff.dx * half * 0.8;
      const y = half + puff.dy * half * 0.8;
      const r = puff.r * half;
      const color = i % 2 ? cloud.tint : cloud.color;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, rgba(color, 0.11 * puff.alpha));
      grd.addColorStop(0.5, rgba(color, 0.045 * puff.alpha));
      grd.addColorStop(1, rgba(color, 0));
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Фактура: без неё облако — ровное пятно света, та же стерильность другого цвета.
    const rnd = stream(cloud.grain);
    const inside = () => {
      const a = rnd() * Math.PI * 2;
      const d = half * 0.72 * Math.sqrt(rnd());
      return { x: half + Math.cos(a) * d, y: half + Math.sin(a) * d };
    };
    // Сгустки — мелкие яркие узлы.
    for (let i = 0; i < 26; i++) {
      const p = inside();
      const r = half * (0.05 + rnd() * 0.14);
      const color = rnd() < 0.5 ? cloud.color : cloud.tint;
      const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grd.addColorStop(0, rgba(color, 0.07 + rnd() * 0.08));
      grd.addColorStop(1, rgba(color, 0));
      g.fillStyle = grd;
      g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
    // Волокна — изогнутые пряди газа: цепочка мягких пятен вдоль кривой, а не линия —
    // штрих читался бы нарисованным.
    for (let i = 0; i < 7; i++) {
      const a = inside();
      const b = inside();
      const c1 = inside();
      const color = rnd() < 0.5 ? cloud.color : cloud.tint;
      const alpha = 0.03 + rnd() * 0.04;
      const width = half * (0.03 + rnd() * 0.05);
      for (let k = 0; k <= 16; k++) {
        const u = k / 16;
        const x = (1 - u) ** 2 * a.x + 2 * (1 - u) * u * c1.x + u ** 2 * b.x;
        const y = (1 - u) ** 2 * a.y + 2 * (1 - u) * u * c1.y + u ** 2 * b.y;
        const r = width * (0.6 + Math.sin(u * Math.PI) * 0.8);
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, rgba(color, alpha));
        grd.addColorStop(1, rgba(color, 0));
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    // Прорехи — тёмные карманы, облако рвётся.
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 12; i++) {
      const p = inside();
      const r = half * (0.06 + rnd() * 0.16);
      const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grd.addColorStop(0, `rgba(0,0,0,${0.5 + rnd() * 0.4})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
  }
  cloudSprites.set(cloud, c && g ? c : null);
  return c && g ? c : null;
}

function laneSprite(alphaKey: number): HTMLCanvasElement | null {
  if (laneSprites.has(alphaKey)) return laneSprites.get(alphaKey)!;
  const c = canvas(SPRITE);
  const g = c?.getContext('2d');
  if (c && g) {
    const half = SPRITE / 2;
    const grd = g.createRadialGradient(half, half, 0, half, half, half);
    grd.addColorStop(0, `rgba(0,2,5,${alphaKey / 100})`);
    grd.addColorStop(0.6, `rgba(0,2,5,${(alphaKey / 100) * 0.45})`);
    grd.addColorStop(1, 'rgba(0,2,5,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, SPRITE, SPRITE);
  }
  laneSprites.set(alphaKey, c && g ? c : null);
  return c && g ? c : null;
}

/** Перевод карты в экран: точка и длина. */
export interface ChaosView {
  toScreen: (p: { x: number; y: number }) => { x: number; y: number };
  toPx: (d: number) => number;
  width: number;
  height: number;
}

function visible(v: ChaosView, x: number, y: number, r: number): boolean {
  return x + r >= 0 && y + r >= 0 && x - r <= v.width && y - r <= v.height;
}

function drawClouds(g: CanvasRenderingContext2D, scene: ChaosScene, v: ChaosView): void {
  for (const cloud of scene.clouds) {
    const at = v.toScreen(cloud);
    const r = v.toPx(cloud.r);
    const reach = r * cloud.stretch;
    if (!visible(v, at.x, at.y, reach)) continue;
    const sprite = cloudSprite(cloud);
    if (!sprite) continue;
    g.save();
    g.translate(at.x, at.y);
    g.rotate(cloud.angle);
    g.scale(cloud.stretch, 1);
    g.drawImage(sprite, -r, -r, r * 2, r * 2);
    g.restore();
  }
}

/** Слой ПОД провинциями: пылевые рукава, туманности, звёзды. */
export function drawChaosUnder(g: CanvasRenderingContext2D, scene: ChaosScene, v: ChaosView): void {
  for (const lane of scene.lanes) {
    const at = v.toScreen(lane);
    const len = v.toPx(lane.length) / 2;
    const wid = v.toPx(lane.width) / 2;
    if (!visible(v, at.x, at.y, len)) continue;
    const sprite = laneSprite(Math.round(lane.alpha * 100));
    if (!sprite) continue;
    g.save();
    g.translate(at.x, at.y);
    g.rotate(lane.angle);
    g.drawImage(sprite, -len, -wid, len * 2, wid * 2);
    g.restore();
  }
  g.save();
  g.globalCompositeOperation = 'lighter';
  drawClouds(g, scene, v);
  g.restore();
  for (const star of scene.stars) {
    const at = v.toScreen(star);
    if (at.x < -4 || at.y < -4 || at.x > v.width + 4 || at.y > v.height + 4) continue;
    g.fillStyle = rgba(star.color, star.alpha);
    const s = star.size;
    g.fillRect(at.x - s / 2, at.y - s / 2, s, s);
    if (star.glint) {
      g.fillStyle = rgba(star.color, star.alpha * 0.35);
      g.fillRect(at.x - 5, at.y - 0.4, 10, 0.8);
      g.fillRect(at.x - 0.4, at.y - 5, 0.8, 10);
    }
  }
}

/** Вуаль ПОВЕРХ провинций (правило 3): те же облака, еле видно. */
export function drawChaosVeil(g: CanvasRenderingContext2D, scene: ChaosScene, v: ChaosView, alpha: number): void {
  g.save();
  g.globalAlpha *= alpha;
  g.globalCompositeOperation = 'screen';
  drawClouds(g, scene, v);
  g.restore();
}
