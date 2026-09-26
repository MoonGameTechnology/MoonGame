# Портреты кораблей Void Dominion

Производные от одобренных владельцем концептов. Встроенный imagegen подготовил
отдельные портреты без типографики и дополнительных ракурсов; дизайн корпусов
сохранён. Для игровых файлов выполнены только уменьшение до 768×512 (Lanczos)
и кодирование WebP, quality 83, method 6. Названия рисует локализованный UI.

| Файл | Игровые id | Исходный концепт, id генерации |
| --- | --- | --- |
| fighter.webp | scout, scout_drone, interceptor | c7a3dacf-39c4-45dd-854d-5e7f57f8f350 |
| strike-craft.webp | bomber | 7209a6bf-2341-4fdd-aefa-0dbf1a343daf |
| frigate.webp | frigate | 57819bfc-efbc-492c-b8a1-e2aa552c5281 |
| cruiser.webp | cruiser | a7b515a9-4d12-44c3-81f6-8f0e12c09ca0 |
| dreadnought.webp | siege, siege_lance, hero | 07beebbd-997f-46de-8b0a-901e691ef16b |
| transport.webp | shuttle_carrier | de184b15-ab06-42a1-8711-c48c030796da |
| dropship.webp | landing_shuttle | ee5b6c0f-638b-491b-96b8-d04ebc7993d5 |
| station.webp | здания starfort, metal_station | 35d9c5c5-27aa-4928-b202-6d2e0be2ea56 |

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
