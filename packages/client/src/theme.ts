/**
 * Void Dominion visual tokens — the cyan-on-void glass palette every screen shares.
 * The prototype inlines these as CSS custom properties; this is the typed source of
 * truth the React Native client binds to, so the look stays identical across the one
 * TS engine (docs/main-menu.md §5.4 — "один TS-движок → одно меню").
 *
 * Pure data: no platform APIs, no colour maths — a renderer maps these to CSS vars
 * (web) or a StyleSheet theme (RN).
 */
export interface Theme {
  /** Primary accent — links, focus rings, the diamond crest. */
  cyan: string;
  /** Muted accent — idle borders. Not for text: on the void it reads 3.4:1 (UIX-1.2). */
  cyanDim: string;
  /** Danger / destructive. */
  red: string;
  /** Warning / transient status. */
  amber: string;
  /** Body text on the void. */
  ink: string;
  /** De-emphasised text: hints, captions, section labels (at least 4.5:1 on the glass). */
  dim: string;
  /** Hairline divider. */
  line: string;
  /** Brighter hairline (panel edges, inputs). */
  lineHi: string;
  /** Translucent panel fill (glass). */
  glass: string;
}

export const theme: Theme = {
  cyan: '#35d6e6',
  cyanDim: '#1c6f78',
  red: '#ff5a4d',
  amber: '#ffb43a',
  ink: '#bfeee6',
  dim: '#5f8f8c',
  line: '#0e3b40',
  lineHi: '#1d6b70',
  glass: 'rgba(3,14,18,0.82)',
};

/** Optional flagship glass skin; resource/owner colours keep their existing meaning. */
export const holographicTheme: Theme & { void: string; surface: string; reflection: string } = {
  ...theme,
  cyan: '#8ce9f2',
  cyanDim: '#609daa',
  ink: '#d0e4ed',
  dim: '#94b0bd',
  line: '#233d49',
  lineHi: '#477381',
  glass: 'rgba(3,13,21,0.94)',
  void: '#030810',
  surface: '#0a202d',
  reflection: '#b9f5ff',
};

/**
 * Menu screens — match setup, seat pick and the rest of the hub's family (UIX-15, owner's
 * order 2026-10-01: «те же цвета, что на главном»). One palette in both skins: the phone
 * skin's `dim` reads 3.4:1 on a card and the holographic one repaints the accent, so a
 * screen drawn from `theme` looked different on the phone and on the PC. Text tokens keep
 * at least 4.5:1 on `card` (WCAG 1.4.3). The accent stays `theme.cyan`; selection fills,
 * the primary button and its glow are that cyan at partial opacity, so they need no token.
 */
export interface SurfaceTheme {
  /** Body text on cards and windows. */
  text: string;
  /** Secondary text: hints and captions. */
  textDim: string;
  /** Section headings inside a window. */
  textHead: string;
  /** Titles and the chosen option. */
  textHi: string;
  /** Card fill. */
  card: string;
  /** A card that cannot be chosen right now. */
  cardOff: string;
  /** Input fields and segmented tracks: a well below the card. */
  inset: string;
  /** Card border. */
  edge: string;
  /** Card border under the pointer. */
  edgeHi: string;
  /** Window fill, a diagonal gradient from `panelFrom` to `panelTo`. */
  panelFrom: string;
  panelTo: string;
  /** Window border. */
  panelEdge: string;
}

export const surfaceTheme: SurfaceTheme = {
  text: '#e2f1f6',
  textDim: '#a9c6d1',
  textHead: '#b4d3dd',
  textHi: '#f2fdff',
  card: 'rgba(8,26,38,0.72)',
  cardOff: 'rgba(6,18,27,0.5)',
  inset: 'rgba(4,16,25,0.9)',
  edge: 'rgba(118,206,229,0.32)',
  edgeHi: 'rgba(140,233,242,0.7)',
  panelFrom: 'rgba(10,30,43,0.985)',
  panelTo: 'rgba(3,12,23,0.985)',
  panelEdge: 'rgba(118,206,229,0.45)',
};

/**
 * Text scale (UIX-1.2): four sizes in CSS px, nothing smaller than `caption`. `caption` is for
 * labels that must fit a narrow slot (a phone tab, a resource chip, a tile); `body` is the
 * text a player reads; `heading` titles a section inside a window; `title` titles a window.
 * Sizes are before the PC zoom (UIX-2.1), which grows the whole interface with the window.
 */
export interface TypeScale {
  caption: number;
  body: number;
  heading: number;
  title: number;
}

export const typeScale: TypeScale = { caption: 12, body: 14, heading: 16, title: 20 };
