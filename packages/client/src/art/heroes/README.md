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
