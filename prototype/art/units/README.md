# Наземные юниты, пиратский флот и мины

## Мина на космической дороге (SHIPART-6, 2026-09-27)

`road-mine.webp`: встроенный imagegen, генерация `6cccd76f-8771-4701-b02e-eab81b7319d2`.
Исходник 1536×1024 → WebP 768×512, quality 83, effort 6, 37348 байт.
По уточнению владельца космическая мина напоминает морскую: сферический бронированный
корпус и выступающие во все стороны датчики. Двигателей и опор нет. Нативный вектор
той же формы — `packages/client/src/mineShape.ts`: круглый корпус, восемь выступов
и дуги панелей, передающие объём. При низкой детализации остаётся тот же силуэт.
Прежний плоский диск (генерация `caadd4e4-655a-4edf-8a25-3992069d369d`, версия
файла в `f658867`) заменён; он служил референсом материалов, освещения и фона.
Портрет подготовлен для кодекса модуля `mine_layer`; без записи модуля в данных
`catalogPortraitHtml` ничего не показывает. Шахта `mine` — другой объект.

**Подключение карты ещё не выполнено.** На момент подготовки ресурса механика находится
в черновике PR #1320, не в `main`. Перед завершением нужны установка на дороге с
затратой времени и надетым модулем, а также обнаружение только вблизи (заказ владельца).
Вектор вызывается только после серверной фильтрации видимости; скрытые поля нельзя
раскрывать ни маркером, ни счётчиком, ни кликом. Радиус и время этот арт не задаёт.

Промпт редактирования прежнего портрета:

> Use case: stylized-concept.
> Asset type: revised realistic game portrait of a stationary SPACE MINE for Averion: Sector Zero.
> Input image: the old mine portrait is the EDIT TARGET. Keep its realistic dark gunmetal materials, restrained cyan indicator lights, plain navy-black background, landscape 3:2 framing and polished game-asset rendering. Completely replace the flat disc geometry.
> Primary request: a space mine whose form is immediately reminiscent of a classic spherical naval sea mine floating in three dimensions. A bulky near-perfect SPHERE made of curved segmented steel armor plates, with eight to ten stout projecting sensor horns distributed radially around the whole sphere in 3D. Horns have flanged bases, short tapered metal stems and small blunt sensor caps. Several horns point sideways around the silhouette, others toward or away from the camera. The spherical core must read as deep and round, with clearly curved latitude and longitude seams; absolutely no flattened base or platter silhouette. Small recessed sensor apertures and tiny cyan status LEDs fit this fleet's technological style.
> Composition: ONE full floating device, elevated three-quarter view, centered, occupies about 75% of image height; all horns fully within frame with generous margin. Realistic dramatic soft illumination showing spherical volume, cool rim light and fine metal wear; background #071018. Mine is unmanned and stationary, no engines, exhaust, cockpit, fins or wings.
> No ground, land, water, sea, anchor, tether, chain, stand, pedestal, pressure plate, circular flat disc, landmine shape, bright central button, explosions, smoke, stars, planets, text, numbers, logo, watermark, UI, frame or alternate views. This is a SPACE NAVAL MINE, not a terrestrial anti-tank mine.

## Наземные войска и пираты

Дополнение SHIPART-5, 2026-09-27. Все 13 портретов созданы встроенным imagegen по
отдельному запросу на каждый тип; чужие изображения не использовались. Люди —
индустриальная серо-графитовая броня, Рой — органическая форма, пираты — трофейная
техника с ржаво-красными панелями и янтарными огнями. Названия рисует локализованный UI.

Исходники 1536×1024 уменьшены до 768×512 (Lanczos) и закодированы WebP quality 83,
effort 6. Суммарно 734474 байта. Изображения встроены в автономный HTML/APK:
`shipArt.ts` использует их в производстве, карточках и наземных плитках состава.
На карте пиратские корабли используют геометрию `shipShapes.ts`, без растров.

| Файл | Игровой id | Генерация |
| --- | --- | --- |
| militia.webp | militia | 8fb1b23d-bd7b-44cd-b8f1-3694016bbe56 |
| drop-infantry.webp | drop_infantry | d2dc3887-0a20-40bf-a8f5-aa4fd1a5a4ee |
| heavy-infantry.webp | heavy_infantry | 5611d960-871e-4dc8-a1b6-9d8912c51a74 |
| special-forces.webp | special_forces | 51a36f0d-b8a3-4ccd-b95f-c3333977be9a |
| tank.webp | tank | 0ca64942-0307-44ca-86e8-9a95892b252e |
| garrison.webp | garrison | c771daae-fd4b-478a-89b5-d9de53f4bdcf |
| swarm-lander.webp | swarm_lander | ee23e688-e201-4e69-9579-25598dc20ee4 |
| pirate-skiff.webp | pirate_skiff | fde47b27-0228-47d5-9313-a499ee180393 |
| pirate-frigate.webp | pirate_frigate | d2476056-9fbc-4270-8052-37788fa7cfb1 |
| pirate-cruiser.webp | pirate_cruiser | 0a3f8319-fe3b-465b-a2ac-73c143f6a473 |
| pirate-boarder.webp | pirate_boarder | 51f138f1-70aa-4d28-b624-e0f8bce966d9 |
| pirate-marauder.webp | pirate_marauder | 2f2eaeec-223c-49d2-8ffb-1438da7a7d4b |
| pirate-tank.webp | pirate_tank | 198b97c2-1204-4a59-a419-601e347d3928 |

## Промпты

### militia.webp

> Use case: stylized-concept. Asset type: finished realistic unit portrait for a dark-space strategy game Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. Industrial hard-surface military science fiction, photorealistic cinematic 3D concept render, plausible functional construction, restrained fine surface wear. A SINGLE primary unit centered, fills 75 percent of frame, complete important silhouette comfortably inside image, clear silhouette at tiny card size. Matte graphite/steel-gray materials, tiny restrained cyan instrument lights. Background nearly black blue, minimal out-of-focus hangar or bunker, readable rim and soft key lighting. No text, logos, letters, UI, frame, watermark, badges or extra people. No cartoon, fantasy ornament, floating equipment, collage or multiple views.
> Subject: A human colony militia infantry trooper, three-quarter view from mid-thigh up, plain practical armored pressure suit and modest helmet with narrow dark visor, exposed fabric joints, one basic compact rifle held safely across chest with exactly two natural hands. Light asymmetrical shoulder padding, utilitarian local-defense kit. Clearly an inexpensive regular soldier, not elite powered armor.

### drop-infantry.webp

> Use case: stylized-concept. Asset type: finished realistic unit portrait for a dark-space strategy game Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. Industrial hard-surface military science fiction, photorealistic cinematic 3D concept render, plausible functional construction, restrained fine surface wear. A SINGLE primary unit centered, fills 75 percent of frame, complete important silhouette comfortably inside image, clear silhouette at tiny card size. Matte graphite/steel-gray materials, tiny restrained cyan instrument lights. Background nearly black blue, minimal out-of-focus hangar or bunker, readable rim and soft key lighting. No text, logos, letters, UI, frame, watermark, badges or extra people. No cartoon, fantasy ornament, floating equipment, collage or multiple views.
> Subject: A human orbital assault infantry trooper, three-quarter view from knees up, fully enclosed compact pressure armor with helmet and narrow cyan visor, compact descent harness and visibly folded thruster pack integrated behind shoulders, rugged boots, one short carbine held with two natural hands across torso. Athletic functional silhouette, medium armor, professional boarding and planetary landing specialist.

### heavy-infantry.webp

> Use case: stylized-concept. Asset type: finished realistic unit portrait for a dark-space strategy game Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. Industrial hard-surface military science fiction, photorealistic cinematic 3D concept render, plausible functional construction, restrained fine surface wear. A SINGLE primary unit centered, fills 75 percent of frame, complete important silhouette comfortably inside image, clear silhouette at tiny card size. Matte graphite/steel-gray materials, tiny restrained cyan instrument lights. Background nearly black blue, minimal out-of-focus hangar or bunker, readable rim and soft key lighting. No text, logos, letters, UI, frame, watermark, badges or extra people. No cartoon, fantasy ornament, floating equipment, collage or multiple views.
> Subject: A human heavy defensive infantry trooper, three-quarter view from knees up, broad layered steel armored exoskeleton with thick chest plates and shoulder protection, reinforced legs, sealed small helmet recessed in armored collar, one heavy short support gun held with exactly two hands. The armored soldier is clearly more massive and squat than a regular trooper; convincing joints, bracing and weight, no oversize fantasy spikes.

### special-forces.webp

> Use case: stylized-concept. Asset type: finished realistic unit portrait for a dark-space strategy game Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. Industrial hard-surface military science fiction, photorealistic cinematic 3D concept render, plausible functional construction, restrained fine surface wear. A SINGLE primary unit centered, fills 75 percent of frame, complete important silhouette comfortably inside image, clear silhouette at tiny card size. Matte graphite/steel-gray materials, tiny restrained cyan instrument lights. Background nearly black blue, minimal out-of-focus hangar or bunker, readable rim and soft key lighting. No text, logos, letters, UI, frame, watermark, badges or extra people. No cartoon, fantasy ornament, floating equipment, collage or multiple views.
> Subject: A human special forces operator, three-quarter view from knees up, lean angular graphite-black sealed armor, small multi-sensor monocular over one side of the helmet visor, compact communications aerial and a few breaching charges neatly secured to chest harness, one suppressed compact rifle held naturally across chest with exactly two hands. Very restrained lights, asymmetric light scout kit. A professional stealth specialist, no cape.

### tank.webp

> Use case: stylized-concept. Asset type: finished realistic unit portrait for a dark-space strategy game Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. Industrial hard-surface military science fiction, photorealistic cinematic 3D concept render, plausible functional construction, restrained fine surface wear. A SINGLE primary unit centered, fills 75 percent of frame, complete important silhouette comfortably inside image, clear silhouette at tiny card size. Matte graphite/steel-gray materials, tiny restrained cyan instrument lights. Background nearly black blue, minimal out-of-focus hangar or bunker, readable rim and soft key lighting. No text, logos, letters, UI, frame, watermark, badges or extra people. No cartoon, fantasy ornament, floating equipment, collage or multiple views.
> Subject: A single futuristic human main battle tank, whole vehicle visible with generous margin, camera slightly above at front three-quarter view. Low broad chassis, exactly two continuous caterpillar tracks with side skirts, one central rotating low-profile angular turret and one substantial cannon, visible tow hooks and functional modular armored plates, compact sensors. Heavy squat clean geometrical steel-gray hull matching industrial warships, no soldiers, no wheels instead of tracks, no muzzle flash, no smoke obscuring the unit.

### garrison.webp

> Use case: stylized-concept. Asset type: finished realistic unit portrait for a dark-space strategy game Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. Industrial hard-surface military science fiction, photorealistic cinematic 3D concept render, plausible functional construction, restrained fine surface wear. A SINGLE primary unit centered, fills 75 percent of frame, complete important silhouette comfortably inside image, clear silhouette at tiny card size. Matte graphite/steel-gray materials, tiny restrained cyan instrument lights. Background nearly black blue, minimal out-of-focus hangar or bunker, readable rim and soft key lighting. No text, logos, letters, UI, frame, watermark, badges or extra people. No cartoon, fantasy ornament, floating equipment, collage or multiple views.
> Subject: A single human fortress sentry infantry trooper stationed at a fixed defensive gun, waist-up three-quarter view with gun mounting visible. Sturdy charcoal armored pressure suit, enclosed helmet, broad protective collar, segmented shoulders; exactly two gloved hands at the handles of a compact permanently pedestal-mounted twin-barrel bunker weapon, tiny cyan range sensor. Concrete-and-metal bunker wall softly blurred behind, strong readable silhouette of human and stationary gun together. Not a tank, no extra personnel.

### swarm-lander.webp

> Use case: stylized-concept. Asset type: finished realistic ground-unit portrait for dark-space strategy Averion: Sector Zero, one standalone 3:2 landscape image, 1536x1024. Subject: a single ground assault organism of an artificial biotech Swarm, complete creature seen from slightly above at three-quarter angle, occupying 75 percent of frame with room around its silhouette. A low aggressive six-limbed arthropod, four strong clawed walking legs supporting its body and two raised short grasping forelimbs, wedge-shaped armored head, small deep red sensory nodes, layered dark charcoal chitin over tightly organized wine-red muscle and metallic structural ribs. Plausible consistent bilateral anatomy, its built-in armor grown around scavenged structural metal, threatening mandibles; no human face, no manufactured firearm. Photorealistic biomechanical creature render; matching the fleet's existing charcoal and burgundy organic ships. Dark nearly black-blue out-of-focus alien rock ground, soft neutral key and red rim light. Clean dry carapace, no gore, no dismemberment, no slime, no cute features. No text, logo, frame, UI, watermark, collage, multiple views or extra creatures.

### pirate-skiff.webp

> Use case: stylized-concept. Asset type: finished realistic pirate spaceship portrait for dark-space strategy Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. SINGLE original ship on a nearly black navy background. Full ship in elevated three-quarter view, stern at lower left, nose toward upper right, 10 percent breathing room around every extremity, silhouette fills most of frame. Photorealistic industrial science-fiction miniature render, functional machinery and precise hard-surface detail, gray salvaged steel, mismatched dark and rust-red replacement armor panels, obvious welded patches, restrained amber worklights and cool pale engine exhaust. Pirate vessels are civilian industrial hulls rebuilt for raiding, visibly asymmetrical and repaired. No sails, skull symbols, sea-pirate accessories, people, space stations, extra ships, text, UI, frame, logo, watermark or collage.
> Subject: Small fast scout and smuggler skiff made from a narrow tug fuselage. Long pointed center nose, compact cockpit, two exposed large engines on unequal short outriggers at the rear, offset side sensor mast and a single modest side gun. Slender arrow silhouette, lightly armored, visibly tiny compared with warships, no wing sails.

### pirate-frigate.webp

> Use case: stylized-concept. Asset type: finished realistic pirate spaceship portrait for dark-space strategy Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. SINGLE original ship on a nearly black navy background. Full ship in elevated three-quarter view, stern at lower left, nose toward upper right, 10 percent breathing room around every extremity, silhouette fills most of frame. Photorealistic industrial science-fiction miniature render, functional machinery and precise hard-surface detail, gray salvaged steel, mismatched dark and rust-red replacement armor panels, obvious welded patches, restrained amber worklights and cool pale engine exhaust. Pirate vessels are civilian industrial hulls rebuilt for raiding, visibly asymmetrical and repaired. No sails, skull symbols, sea-pirate accessories, people, space stations, extra ships, text, UI, frame, logo, watermark or collage.
> Subject: Medium patrol frigate converted from an industrial escort cutter. Long narrow armored center keel, blunt split-prong boarding prow with visible docking clamps, asymmetrical external cargo/service pod on the port flank, a small offset gun platform on starboard, two engines at rear. Medium size, recognizably taller and longer than a skiff, not a wedge battleship.

### pirate-cruiser.webp

> Use case: stylized-concept. Asset type: finished realistic pirate spaceship portrait for dark-space strategy Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. SINGLE original ship on a nearly black navy background. Full ship in elevated three-quarter view, stern at lower left, nose toward upper right, 10 percent breathing room around every extremity, silhouette fills most of frame. Photorealistic industrial science-fiction miniature render, functional machinery and precise hard-surface detail, gray salvaged steel, mismatched dark and rust-red replacement armor panels, obvious welded patches, restrained amber worklights and cool pale engine exhaust. Pirate vessels are civilian industrial hulls rebuilt for raiding, visibly asymmetrical and repaired. No sails, skull symbols, sea-pirate accessories, people, space stations, extra ships, text, UI, frame, logo, watermark or collage.
> Subject: Heavy pirate raider cruiser converted from an armed salvage barge. Broad squat armored hull with reinforced forward wedge, visible welded slabs, two unequal armored side sponsons carrying heavy salvaged gun turrets, low recessed bridge, large aft engineering block with three engines, tucked cargo/boarding bay. Broad formidable silhouette, practical hardware, no fantasy spikes.

### pirate-boarder.webp

> Use case: stylized-concept. Asset type: finished realistic pirate ground-unit portrait for dark-space strategy Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. SINGLE primary unit centered filling 75 percent of image, clear silhouette at small card size. Photorealistic industrial sci-fi cinematic concept render. Salvaged gray and charcoal steel, mismatched rust-red armor panels, visible repairs and restrained amber lights; dark nearly black navy defocused industrial hideout. Concrete realistic equipment, good functional anatomy and construction. Soft neutral key plus warm practical edge lighting. No text, logo, UI, frame, watermark, decorative skulls, sea-pirate costumes, collage, extra people, gore or combat effects.
> Subject: A single human pirate boarding infantryman from knees up, three-quarter view. Practical old vacuum work suit reinforced with scavenged light armor, compact respirator helmet with dark amber-tinted visor, asymmetrical shoulder plate, utility straps and magnetized boots, one short cut-down industrial-looking carbine across chest held by exactly two natural hands. Lean raider silhouette. Patch repairs feel handmade but functional, not a uniform professional army.

### pirate-marauder.webp

> Use case: stylized-concept. Asset type: finished realistic pirate ground-unit portrait for dark-space strategy Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. SINGLE primary unit centered filling 75 percent of image, clear silhouette at small card size. Photorealistic industrial sci-fi cinematic concept render. Salvaged gray and charcoal steel, mismatched rust-red armor panels, visible repairs and restrained amber lights; dark nearly black navy defocused industrial hideout. Concrete realistic equipment, good functional anatomy and construction. Soft neutral key plus warm practical edge lighting. No text, logo, UI, frame, watermark, decorative skulls, sea-pirate costumes, collage, extra people, gore or combat effects.
> Subject: A single human pirate heavy infantry enforcer from knees up, three-quarter view. A broad salvaged mining exoskeleton rebuilt into armor: strong load-bearing frame, unequal bulky welded shoulder plates, rust-red rectangular chest plate, enclosed recessed industrial helmet and amber visor, reinforced thighs. Exactly two arms holding one thick-barrel support machine gun naturally. Heavy defensive bruiser, broader and slower-looking than a light boarding raider, no fantasy spikes or extra limbs.

### pirate-tank.webp

> Use case: stylized-concept. Asset type: finished realistic pirate ground-unit portrait for dark-space strategy Averion: Sector Zero; one standalone 3:2 landscape image, 1536x1024. SINGLE primary unit centered filling 75 percent of image, clear silhouette at small card size. Photorealistic industrial sci-fi cinematic concept render. Salvaged gray and charcoal steel, mismatched rust-red armor panels, visible repairs and restrained amber lights; dark nearly black navy defocused industrial hideout. Concrete realistic equipment, good functional anatomy and construction. Soft neutral key plus warm practical edge lighting. No text, logo, UI, frame, watermark, decorative skulls, sea-pirate costumes, collage, extra people, gore or combat effects.
> Subject: A single complete pirate assault tank, camera elevated front three-quarter, all extremities comfortably inside frame. Low industrial tracked bulldozer rebuilt into an armored vehicle, exactly two continuous tracks, visible reinforced front plow, improvised offset low turret with one heavy cannon, welded patchwork gray and rust-red armored skirts, externally secured spare track segments, restrained amber lamps. Stable plausible center of mass, compact brutal utilitarian silhouette; clearly a tank, no giant walker legs and no people.
