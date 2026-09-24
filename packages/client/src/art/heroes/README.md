# Hero portrait atlas

Four realistic portraits generated from the owner's accepted concept sheet on
2026-09-21. Original artwork for this project; no third-party character art.

`portraits.webp` is a 1254 × 1254 image with alpha, arranged in equal 2 × 2 cells:

| Cell | Archetype | Concept identity |
| --- | --- | --- |
| Top left | commander | Mark Weir (the main hero retains the player's callsign) |
| Top right | ravager | Lyra Sain |
| Bottom left | vanguard | Darian Cross |
| Bottom right | warden | Elena Mor |

The same natural-color cutouts serve dossier cards and map markers. The interface
adds frames and grade glyphs separately. There is no baked-in text or level.
`heroPortraits.ts` loads the atlas once; the prototype embeds it as a data URL.
Names and biographies live in the RU/EN locale files, keyed by `decisions/heroIdentity.ts`.

## Outside the atlas

`scientist.svg` — a vector draft of the fifth hero, the Scientist (owner's decision
2026-09-24), until real art replaces it. Same framing as an atlas cell: a square bust on
a transparent background, no text. It shows no implant and no glow on the skin — that is
a spoiler of the Sector Zero finale (`docs/sector-zero-roadmap.md` §3.1.4).
`heroPortraits.ts` maps it by archetype (`LOOSE_ART`); a hero whose identity has no atlas
`cell` takes its portrait from there. When the final art arrives, either replace this file
or give the hero an atlas cell and drop the entry.
