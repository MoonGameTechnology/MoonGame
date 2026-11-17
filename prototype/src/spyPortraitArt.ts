/**
 * Десять нарисованных портретов шпионов (заказ владельца 2026-11-17: «нарисуй портреты
 * для шпионов, штук 10»). Каждый — бюст в кадре 96×96 на своём тёмном фоне, в плоской
 * векторной манере под «cyan-on-void glass» окон. Позывной берёт лицо по номеру
 * (`spyPortrait.ts`), так что один и тот же шпион везде выглядит одинаково.
 *
 * Без градиентов и `id`: портрет вставляется в разметку inline, иногда дважды на одной
 * странице (список и окно заданий), и общие `id` в SVG ломали бы друг друга.
 */

/** Голова и плечи общей формы: кожа, шея, линия плеч под одеждой. */
function bust(skin: string, coat: string, y = 0): string {
  return (
    `<path d="M8 96c2-16 14-24 32-27l8-1 8 1c18 3 30 11 32 27z" fill="${coat}"/>` +
    `<path d="M40 ${58 + y}h16v12l-8 5-8-5z" fill="${skin}" opacity="0.92"/>`
  );
}

/** Лицо: овал + тень от скул. */
function face(skin: string, cx = 48, cy = 40, rx = 15, ry = 18): string {
  return (
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${skin}"/>` +
    `<path d="M${cx - rx} ${cy}c0 ${ry * 0.6} ${rx * 0.5} ${ry} ${rx} ${ry}s${rx}-${ry * 0.4} ${rx}-${ry}" fill="#000" opacity="0.12"/>`
  );
}

/** Два глаза: белок, радужка цвета `iris`, веко. */
function eyes(iris: string, cx = 48, cy = 40, gap = 6, w = 4): string {
  let out = '';
  for (const x of [cx - gap, cx + gap]) {
    out +=
      `<ellipse cx="${x}" cy="${cy}" rx="${w}" ry="${w * 0.55}" fill="#f2f6f7"/>` +
      `<circle cx="${x}" cy="${cy}" r="${w * 0.5}" fill="${iris}"/>` +
      `<circle cx="${x}" cy="${cy}" r="${w * 0.22}" fill="#06090b"/>` +
      `<path d="M${x - w} ${cy}q${w} -${w * 0.9} ${w * 2} 0" fill="none" stroke="#1a1214" stroke-width="1.1"/>`;
  }
  return out;
}

/** Нос и рот — тонкой линией, чтобы читались и в 48 px. */
function mouthNose(cx = 48, cy = 40, tone = '#4a2a28', smile = 0): string {
  return (
    `<path d="M${cx} ${cy + 2}l-2 6h4" fill="none" stroke="${tone}" stroke-width="1.1" stroke-linejoin="round" opacity="0.75"/>` +
    `<path d="M${cx - 5} ${cy + 12}q5 ${smile} 10 0" fill="none" stroke="${tone}" stroke-width="1.4" stroke-linecap="round"/>`
  );
}

/** Брови одной дугой каждая. */
function brows(tone: string, cx = 48, cy = 40, tilt = 0): string {
  return (
    `<path d="M${cx - 10} ${cy - 6 + tilt}q4 -3 8 -1" fill="none" stroke="${tone}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="M${cx + 2} ${cy - 7}q4 -2 8 ${1 + tilt}" fill="none" stroke="${tone}" stroke-width="1.8" stroke-linecap="round"/>`
  );
}

const CYAN = '#35d6e6';

/**
 * 0 · Классический силуэт: федора с широкими полями, поднятый воротник плаща, половина
 * лица в тени от шляпы.
 */
function fedora(): string {
  const skin = '#d9a98a';
  return (
    `<rect width="96" height="96" fill="#1d3b4f"/>` +
    bust(skin, '#0f1a20') +
    `<path d="M30 70l18 10 18-10-4-6h-28z" fill="#182830"/>` +
    face(skin) +
    `<path d="M33 37c0-6 6-11 15-11s15 5 15 11z" fill="#120d0b" opacity="0.45"/>` +
    eyes('#5a7f8c') +
    brows('#2a1b16') +
    mouthNose(48, 40, '#4a2a28', -1) +
    `<ellipse cx="48" cy="30" rx="24" ry="4.5" fill="#0c1013"/>` +
    `<path d="M35 30c0-11 5-16 13-16s13 5 13 16z" fill="#131a1e"/>` +
    `<rect x="35" y="25" width="26" height="3" fill="#2d3f48"/>`
  );
}

/** 1 · Женщина с каре и тёмными очками, высокий воротник. */
function bobGlasses(): string {
  const skin = '#f0c9a8';
  return (
    `<rect width="96" height="96" fill="#3b2a4f"/>` +
    bust(skin, '#1c1424') +
    `<path d="M34 68l14 8 14-8-3-7h-22z" fill="#2a1f36"/>` +
    `<path d="M30 42c-2-16 7-24 18-24s20 8 18 24l-2 16h-32z" fill="#17100f"/>` +
    face(skin, 48, 41, 14, 17) +
    `<path d="M31 32c2-9 8-14 17-14s15 5 17 14l-3 1c-3-6-8-9-14-9s-11 3-14 9z" fill="#17100f"/>` +
    `<path d="M34 24l-4 30h4z M62 24l4 30h-4z" fill="#17100f"/>` +
    brows('#2a1b16', 48, 41) +
    `<rect x="32" y="37" width="13" height="7" rx="3" fill="#0b1316" stroke="#6ad7e6" stroke-width="1"/>` +
    `<rect x="51" y="37" width="13" height="7" rx="3" fill="#0b1316" stroke="#6ad7e6" stroke-width="1"/>` +
    `<path d="M45 40h6" stroke="#6ad7e6" stroke-width="1"/>` +
    `<path d="M35 39l4 1M54 39l4 1" stroke="#9fe9f2" stroke-width="1" opacity="0.6"/>` +
    mouthNose(48, 41, '#8a3a46', 1)
  );
}

/** 2 · Капюшон, лицо скрыто, вместо глаз — светящаяся полоса визора. */
function hoodVisor(): string {
  return (
    `<rect width="96" height="96" fill="#2e4648"/>` +
    bust('#c9a083', '#111a1c') +
    `<path d="M26 60c-4-24 6-40 22-40s26 16 22 40l-5 8h-34z" fill="#141f22"/>` +
    `<path d="M32 58c-3-18 5-30 16-30s19 12 16 30l-3 6h-26z" fill="#070b0d"/>` +
    `<path d="M36 40h24" stroke="${CYAN}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M36 40h24" stroke="#d8fbff" stroke-width="1" stroke-linecap="round" opacity="0.8"/>` +
    `<path d="M40 52h16" stroke="${CYAN}" stroke-width="1" opacity="0.35"/>` +
    `<path d="M30 60c6-4 12-6 18-6s12 2 18 6" fill="none" stroke="#243336" stroke-width="2"/>`
  );
}

/** 3 · Бритый, борода, повязка на глазу — ветеран. */
function eyepatch(): string {
  const skin = '#b47a5a';
  return (
    `<rect width="96" height="96" fill="#4f3424"/>` +
    bust(skin, '#1f1812') +
    `<path d="M36 66h24v10l-12 6-12-6z" fill="#3a2a1c"/>` +
    face(skin, 48, 40, 16, 18) +
    `<path d="M33 44c0 10 6 16 15 16s15-6 15-16c-3 8-8 11-15 11s-12-3-15-11z" fill="#2b1d14"/>` +
    `<path d="M34 24c5-5 23-5 28 0" fill="none" stroke="#000" opacity="0.15" stroke-width="2"/>` +
    eyes('#6f8f73', 48, 40, 6, 4) +
    `<path d="M48 40l12 0" fill="none"/>` +
    `<path d="M49 36l12-1" stroke="#15100d" stroke-width="1.4"/>` +
    `<ellipse cx="54" cy="40" rx="5.5" ry="4" fill="#15100d"/>` +
    brows('#2b1d14', 48, 40, 1) +
    `<path d="M48 42l-2 6h4" fill="none" stroke="#4a2a28" stroke-width="1.1" opacity="0.75"/>` +
    `<path d="M37 44l3 6" stroke="#8d4f4a" stroke-width="1.4" stroke-linecap="round"/>`
  );
}

/** 4 · Женщина с косой через плечо и гарнитурой в ухе. */
function braidHeadset(): string {
  const skin = '#8d5a3c';
  return (
    `<rect width="96" height="96" fill="#24384f"/>` +
    bust(skin, '#121b24') +
    `<path d="M30 40c-1-14 7-22 18-22s19 8 18 22h-4c-1-9-6-14-14-14s-13 5-14 14z" fill="#1a0f0a"/>` +
    `<path d="M32 44c-2 10-4 24-2 40h8c-2-12-1-24 2-36z" fill="#1a0f0a"/>` +
    `<path d="M33 54l5 3M32 64l5 3M31 74l5 3" stroke="#3a2419" stroke-width="1.6" stroke-linecap="round"/>` +
    face(skin, 48, 41, 14, 17) +
    `<path d="M34 34c2-8 7-12 14-12s12 4 14 12l-3 0c-2-5-6-8-11-8s-9 3-11 8z" fill="#1a0f0a"/>` +
    eyes('#5c3a2e', 48, 41, 6, 4) +
    brows('#1a0f0a', 48, 41) +
    mouthNose(48, 41, '#5a2a2c', 1) +
    `<circle cx="63" cy="42" r="2.5" fill="#101518" stroke="${CYAN}" stroke-width="1"/>` +
    `<path d="M63 44l1 8-6 4" fill="none" stroke="${CYAN}" stroke-width="1.2"/>` +
    `<circle cx="58" cy="56" r="1.4" fill="${CYAN}"/>`
  );
}

/** 5 · Кепка-восьмиклинка, очки-гогглы на лбу, щетина. */
function capGoggles(): string {
  const skin = '#e0b394';
  return (
    `<rect width="96" height="96" fill="#2f4a32"/>` +
    bust(skin, '#1a2219') +
    `<path d="M38 66h20l4 10-14 6-14-6z" fill="#2c3a2a"/>` +
    face(skin) +
    `<path d="M33 44c3 7 8 10 15 10s12-3 15-10c-3 4-8 6-15 6s-12-2-15-6z" fill="#3b2a22" opacity="0.5"/>` +
    eyes('#4e6e45') +
    brows('#3b2a22') +
    mouthNose(48, 40, '#4a2a28', 0) +
    `<path d="M31 29c0-9 7-15 17-15s17 6 17 15z" fill="#2a3326"/>` +
    `<path d="M29 29h38l-3 4h-32z" fill="#1c241a"/>` +
    `<rect x="36" y="24" width="10" height="7" rx="3" fill="#0f1a1c" stroke="#7fb6a8" stroke-width="1"/>` +
    `<rect x="50" y="24" width="10" height="7" rx="3" fill="#0f1a1c" stroke="#7fb6a8" stroke-width="1"/>` +
    `<path d="M46 27h4" stroke="#7fb6a8" stroke-width="1"/>` +
    `<path d="M38 26l5 1M52 26l5 1" stroke="#c6f0ea" stroke-width="1" opacity="0.5"/>`
  );
}

/** 6 · Маска-респиратор на всё лицо, два линзовых глаза, тёмный капюшон-воротник. */
function maskLenses(): string {
  return (
    `<rect width="96" height="96" fill="#4a2a35"/>` +
    bust('#2a2426', '#1a1114') +
    `<path d="M30 60c0-20 8-32 18-32s18 12 18 32l-3 8h-30z" fill="#252024"/>` +
    `<path d="M34 46c0-10 6-16 14-16s14 6 14 16v14h-28z" fill="#0d0b0d"/>` +
    `<circle cx="41" cy="42" r="5" fill="#0b1316" stroke="#6a6168" stroke-width="1.6"/>` +
    `<circle cx="55" cy="42" r="5" fill="#0b1316" stroke="#6a6168" stroke-width="1.6"/>` +
    `<circle cx="41" cy="42" r="2.4" fill="#e8584d"/><circle cx="55" cy="42" r="2.4" fill="#e8584d"/>` +
    `<circle cx="40" cy="41" r="0.8" fill="#ffd9d4"/><circle cx="54" cy="41" r="0.8" fill="#ffd9d4"/>` +
    `<rect x="40" y="50" width="16" height="8" rx="3" fill="#2b2629" stroke="#4a4248" stroke-width="1"/>` +
    `<path d="M43 52v4M46 52v4M49 52v4M52 52v4" stroke="#0d0b0d" stroke-width="1.2"/>` +
    `<path d="M34 46l-4 2M62 46l4 2" stroke="#4a4248" stroke-width="1.6"/>`
  );
}

/** 7 · Женщина с короткими взъерошенными волосами и шрамом через бровь. */
function spikyScar(): string {
  const skin = '#f3d4bb';
  return (
    `<rect width="96" height="96" fill="#45402a"/>` +
    bust(skin, '#22231a') +
    `<path d="M32 70l16 8 16-8-2-6h-28z" fill="#2f3124"/>` +
    face(skin, 48, 41, 14, 17) +
    `<path d="M33 36c0-9 6-14 15-14 4 0 7 1 9 3l4-5 1 6 5-2-2 6 4 1-4 3c1 2 1 4 1 6l-3 1c-1-6-6-10-15-10-7 0-11 2-12 7z" fill="#e8ead0"/>` +
    eyes('#8c7a5a', 48, 41, 6, 4) +
    brows('#b9bb9f', 48, 41) +
    `<path d="M51 31l3 10" stroke="#c87a6e" stroke-width="1.4" stroke-linecap="round"/>` +
    mouthNose(48, 41, '#8a3a46', -2)
  );
}

/** 8 · Седой, усы, монокль-линза с подсветкой — старый резидент. */
function monocle(): string {
  const skin = '#d1a68c';
  return (
    `<rect width="96" height="96" fill="#2e3a44"/>` +
    bust(skin, '#1b1f26') +
    `<path d="M36 64h24l2 8-14 8-14-8z" fill="#2e333d"/>` +
    `<path d="M44 66h8l-4 10z" fill="#7a2f3b"/>` +
    face(skin, 48, 40, 15, 18) +
    `<path d="M33 35c0-8 6-12 15-12s15 4 15 12l-3 0c-2-5-6-8-12-8s-10 3-12 8z" fill="#c8ccd0"/>` +
    `<path d="M31 36c-1 4 0 8 1 10l3-1c-1-3-1-6 0-9z M65 36c1 4 0 8-1 10l-3-1c1-3 1-6 0-9z" fill="#c8ccd0"/>` +
    eyes('#6a7f93', 48, 40, 6, 4) +
    brows('#aeb3b8', 48, 40) +
    `<circle cx="54" cy="40" r="5.5" fill="none" stroke="#d4b25e" stroke-width="1.2"/>` +
    `<circle cx="54" cy="40" r="4.5" fill="${CYAN}" opacity="0.2"/>` +
    `<path d="M58 44l4 10" stroke="#d4b25e" stroke-width="0.8"/>` +
    `<path d="M48 42l-2 6h4" fill="none" stroke="#4a2a28" stroke-width="1.1" opacity="0.75"/>` +
    `<path d="M39 50c3-3 6-3 9-1 3-2 6-2 9 1-3 2-6 2-9 1-3 1-6 1-9-1z" fill="#c8ccd0"/>`
  );
}

/** 9 · Молодой, шапка-бини, наушники на шее, веснушки. */
function beanieHeadphones(): string {
  const skin = '#c98b6b';
  return (
    `<rect width="96" height="96" fill="#1f3a3f"/>` +
    bust(skin, '#162226') +
    `<path d="M36 64h24l3 8-15 7-15-7z" fill="#28383c"/>` +
    `<path d="M30 68c6-4 30-4 36 0" fill="none" stroke="#0f1517" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="31" cy="70" r="4" fill="#0f1517" stroke="${CYAN}" stroke-width="1"/>` +
    `<circle cx="65" cy="70" r="4" fill="#0f1517" stroke="${CYAN}" stroke-width="1"/>` +
    face(skin, 48, 42, 14, 17) +
    `<path d="M31 36c0-12 7-19 17-19s17 7 17 19l-2 2c-1-9-6-13-15-13s-14 4-15 13z" fill="#3c5a8c"/>` +
    `<path d="M32 33h32v6h-32z" fill="#2c4470"/>` +
    `<path d="M36 20h24" stroke="#3c5a8c" stroke-width="0"/>` +
    eyes('#4b3a2c', 48, 42, 6, 4) +
    brows('#3a2416', 48, 42) +
    mouthNose(48, 42, '#6a3a34', 3) +
    `<g fill="#8f5a40" opacity="0.7"><circle cx="38" cy="47" r="0.7"/><circle cx="41" cy="49" r="0.7"/><circle cx="36" cy="50" r="0.7"/>` +
    `<circle cx="58" cy="47" r="0.7"/><circle cx="55" cy="49" r="0.7"/><circle cx="60" cy="50" r="0.7"/></g>`
  );
}

/** Портреты по номеру; позывной `n` берёт `SPY_FACES[n % SPY_FACES.length]`. */
export const SPY_FACES: readonly (() => string)[] = [
  fedora,
  bobGlasses,
  hoodVisor,
  eyepatch,
  braidHeadset,
  capGoggles,
  maskLenses,
  spikyScar,
  monocle,
  beanieHeadphones,
];
