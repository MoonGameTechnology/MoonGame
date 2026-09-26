# Портреты кораблей Void Dominion

Базовые портреты — производные от одобренных владельцем концептов. Встроенный imagegen подготовил
отдельные портреты без типографики и дополнительных ракурсов; дизайн корпусов
сохранён. Для игровых файлов выполнены только уменьшение до 768×512 (Lanczos)
и кодирование WebP, quality 83, method 6. Названия рисует локализованный UI.

| Файл | Игровые id | Исходный концепт, id генерации |
| --- | --- | --- |
| fighter.webp | scout_drone, interceptor | c7a3dacf-39c4-45dd-854d-5e7f57f8f350 |
| strike-craft.webp | bomber | 7209a6bf-2341-4fdd-aefa-0dbf1a343daf |
| frigate.webp | frigate | 57819bfc-efbc-492c-b8a1-e2aa552c5281 |
| cruiser.webp | cruiser | a7b515a9-4d12-44c3-81f6-8f0e12c09ca0 |
| dreadnought.webp | siege, siege_lance, hero | 07beebbd-997f-46de-8b0a-901e691ef16b |
| transport.webp | shuttle_carrier | de184b15-ab06-42a1-8711-c48c030796da |
| dropship.webp | landing_shuttle | ee5b6c0f-638b-491b-96b8-d04ebc7993d5 |
| station.webp | здания starfort, metal_station | 35d9c5c5-27aa-4928-b202-6d2e0be2ea56 |

## Дополнение Sector Zero (SHIPART-4, 2026-09-26)

Четыре новых портрета созданы встроенным imagegen по стилю соседних базовых корпусов.
Исходники 1536×1024 уменьшены до 768×512 (Lanczos) и записаны в WebP quality 83, method 6.
Суммарно 175700 байт. Все десять типов кораблей и челноков меню производства теперь
имеют разные портреты; на карте у этих четырёх юнитов отдельные векторные контуры.
Игровые id и текущие названия сохранены: тяжёлый ударный страйкер, разведчик,
дозорный фрегат и усиленный крейсер.

| Файл | Игровой id | Референс | Генерация |
| --- | --- | --- | --- |
| heavy-striker.webp | heavy_striker | strike-craft.webp | f8f2a871-4074-4b31-bf0b-6b878ca0b769 |
| scout.webp | scout | fighter.webp | 8b689fb5-ff4d-400d-b3da-5fe0c59b5abe |
| picket-frigate.webp | picket_frigate | frigate.webp | 7a891598-8245-4e5c-b985-8a773524b7e2 |
| heavy-cruiser.webp | heavy_cruiser | cruiser.webp | 8880a7cc-5f29-4612-a597-69bc1b7f5c81 |

Общая часть промпта (к ней добавлялась спецификация соответствующего корпуса):

> Use case: stylized-concept. Project asset: a single realistic human spacecraft portrait for the build menu and codex of Averion: Sector Zero / Void Dominion. The supplied image is a STYLE AND RELATED HULL reference; create a distinct specialized sibling ship. Match its realistic gunmetal gray angular plating, believable machinery, restrained tiny cyan engine lights, black/navy studio-space background (#071018), contrast and modeling quality. Entire ship visible with 8% clear margins, centered in a landscape 3:2 frame, three-quarter view from above, full bow and engines visible. No text, labels, insignia, border, diagram, extra angles, stars, planet, laser fire, explosions, people or UI. Single art-only portrait. The specialized silhouette must remain obvious when very small.

**heavy-striker.webp:**

> Heavy strike shuttle / heavy bomber. A heavier wider sibling of the referenced twin-pronged strike craft: retain its two distinct long forward weapon booms and rear engine housings, but add two bulky external armored ordnance pods projecting outside the main body beside the midpoint, thicker central armor, and four rear engine exhausts (two main and two auxiliary). Low flattened broad hull. Visually about one and a half times the mass of the ordinary strike craft, still a shuttle rather than a giant capital ship. The nose points toward the lower left, engines toward upper right as in the reference. Functional restrained design; do not merely copy the reference.

**scout.webp:**

> Compact scout reconnaissance ship, clearly distinct from the broad-winged fighter reference. Slender needle-like single central hull, narrow clipped swept fins, two small low-profile rear engine pods close to the body, tiny paired sensor whiskers at the shoulders, no large weapons. The whole hull is narrow and nimble with a clear tapered single nose. Nose points upper right, engines lower left as in the reference. Fine panel detail consistent with this fleet; not a civilian aircraft, not a copy of the fighter wings.

**picket-frigate.webp:**

> Sensor/picket frigate. Preserve the recognizable long twin-pronged bow and twin rear engine arrangement of this frigate family, but add a very prominent transverse crescent-shaped phased-array antenna on the upper central hull, wider than the slender body, with two shorter rectangular side sensor panels projecting left and right. Array is gunmetal with thin cyan illuminated sensor cells, not a holographic circle. Minimal guns; visually an electronic reconnaissance support ship. Twin forward prongs point upper right, rear engines lower left as reference. Keep whole hull and full antenna visible; not merely the ordinary frigate with more fine details.

**heavy-cruiser.webp:**

> Reinforced heavy cruiser, the armored battleship-like human line ship of this catalog. A visibly heavier sibling of the cruiser reference: much broader layered armored shoulders, thick stepped double armor belt along both sides, wide chisel-shaped prow, paired large dorsal gun turrets, four large rectangular rear engine housings. Keep the industrial angular common family design, but add about fifty percent visual mass and heavier armor. Nose points upper right, engines lower left as reference. Distinct broad fortress-like silhouette, not the ordinary cruiser copied or recolored.

## Рой (SHIPART-3, 2026-09-25)

Восемь форм Роя вырезаны из листа владельца «Рой» (карточки 01–08, 1254×1254): только
область арта внутри рамки карточки, без заголовка, номера, текста и чертежей. Кадр 3:2
292×195 из листа → 576×384 (Lanczos + лёгкая нерезкая маска), WebP quality 83, method 6.
В двух левых карточках убрана еле заметная направляющая линия рамки (+2..3 яркости) —
только по пикселям фона, щупальца не тронуты. У листа фон светлее рамки портрета, поэтому
`ship-art.css` гасит края картинки Роя в фон рамки.

| Файл | Форма (`SWARM_SHAPES`) | Карточка листа |
| --- | --- | --- |
| swarm-scout.webp | swarmScout | 01 Разведчик |
| swarm-flock.webp | swarmFlock | 02 Стая |
| swarm-hunter.webp | swarmHunter | 03 Охотник |
| swarm-devourer.webp | swarmDevourer | 04 Поглотитель |
| swarm-spore-carrier.webp | swarmSporeCarrier | 05 Носитель спор |
| swarm-destroyer.webp | swarmDestroyer | 06 Разрушитель |
| swarm-matriarch.webp | swarmMatriarch | 07 Матка |
| swarm-leviathan.webp | swarmLeviathan | 08 Левиафан |

Какой корпус какой формой рисуется — `SWARM_UNIT_SHAPE` (тот же выбор, что у силуэтов на
карте): семью выбирает фракция владельца, у записи каталога без владельца — `def.faction`.

Это соответствие визуальных семейств существующему ростеру, без добавления классов
или изменения механик. Авианосец и десантный корабль по решению владельца 2026-09-26 — один корабль, «Носитель»
(`shuttle_carrier`): ему грузовик, а картинка челнока — только десантному челноку. Карта использует отдельные настоящие векторы из
`packages/client/src/shipShapes.ts`, а не растровые изображения голограмм.

Общий промпт редактирования, по одному вызову на каждое имя из таблицы:

> Use case: precise-object-edit. Project asset: {name} portrait for Void Dominion's
> build menu and codex. The supplied image is the APPROVED EDIT TARGET, not a loose
> inspiration. Extract and reframe ONLY the large primary realistic three-quarter
> spacecraft from the upper portion of the supplied concept poster. Preserve that
> exact spacecraft's hull design, proportions, materials, engines, lighting,
> orientation, and fine detailing. Remove all typography, logos, page borders,
> numbering, separator lines, secondary views, and holographic diagram insets.
> Do not redesign the spacecraft. Do not include any lettering. Center the entire
> primary spacecraft in a landscape 3:2 frame on a plain very dark navy-black
> background (#071018), with 8% clear margin around every extremity and its full bow
> and engines visible. Realistic gunmetal ship and restrained cyan engine light,
> same materials as the reference. The result must be a single art-only in-game portrait.

Дополнение для dropship:

> Preserve the broad blunt troop bay, open forward landing ramp, two massive upper
> engine housings and landing struts; this is the short wide trailer dropship,
> never a pointed fighter.
