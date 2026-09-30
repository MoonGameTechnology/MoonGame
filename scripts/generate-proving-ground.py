"""Полигон основной игры (`data/maps/proving-ground.json`).

ЗАЧЕМ. Заказ владельца 2026-09-29: карта, на которой видно ВСЁ — шесть областей концепции
(`docs/map-terrain-regions-concept.md` §5.5), каждая собрана по шаблону «ядро → оболочка →
край» (§5.3), весь каталог провинций, сред и типов миров, все юниты игрока и все враги.
Игрок начинает песочницей (флот из всех кораблей, гарнизон из всех наземных, столица со
всеми постройками — это кладёт карта; технологии и челноки в ангаре —
`provingGroundState` клиента), чтобы сразу пробовать любую механику.

ОБЛАСТИ — ТОЛЬКО ПОДПИСИ (решение владельца 2026-09-29: «Только областей названия. Не
провинций»). В карту область попадает как `regions`: id и список провинций. Ядро поле не
читает; имя живёт в `/localization` под ключом `region.proving-ground.<область>`.
Провинциям имён нет — у них координата.

КАК СОБРАНО. Провинции стоят на шестиугольной решётке с детерминированным дрожанием (без
случайности: карта одна и та же при каждом прогоне). Клетка отходит ближайшему центру
области, а внутри области ядро, оболочку и край задаёт расстояние до ЯКОРЯ ядра. Якорь
смещён от центра — ядро не в середине, оболочка разной ширины (§5.3: «не концентрические
кольца»). У штормового фронта якорь — отрезок: ядро полосой (§5.5). Универсальные объекты
(§5.4: столицы, станция, базы обитателей, перекрёсток, чёрная дыра, разломы) ставятся
штучно, в названную точку, поверх назначенной области.

Соседство выводится из мозаики (M4.3), бюджет проходов — из среды (`maxLinks`). Полноту
держит `data/provingGround.test.ts`: новая запись в каталоге без места здесь роняет тест, и
генератор надо перезапустить.
"""
import collections, json, math

DATA = {name: json.load(open(f'data/{name}.json', encoding='utf-8'))
        for name in ('units', 'buildings', 'factions', 'sectorKinds')}

# ── Решётка ────────────────────────────────────────────────────────────────────────────
STEP = 300
HALF_W, HALF_H = 1950, 1120  # эллипс карты


def jitter(r, c):
    """Детерминированное смещение клетки: карта одна и та же при каждом прогоне."""
    h = (r * 7919 + c * 104729) % 360
    return round(55 * math.cos(math.radians(h))), round(55 * math.sin(math.radians(h * 1.7)))


CELLS = []
GRID = {}  # точка → координата решётки: имя провинции там, где имён нет (как `C0R1` песочницы)
for r in range(-5, 6):
    for c in range(-8, 9):
        x = c * STEP + (STEP / 2 if r % 2 else 0)
        y = r * STEP * math.sqrt(3) / 2
        if (x / HALF_W) ** 2 + (y / HALF_H) ** 2 > 1:
            continue
        dx, dy = jitter(r, c)
        p = (round(x + dx), round(y + dy))
        CELLS.append(p)
        GRID[p] = f'C{c + 8}R{r + 5}'

# ── Области ────────────────────────────────────────────────────────────────────────────
# (центр, вес, якорь ядра). Вес растягивает область: клетка отходит тому, у кого меньше
# расстояние / вес. Якорь — точка или отрезок, от него считается «ядро → оболочка → край».
REGIONS = collections.OrderedDict([
    ('open_expanse', ((0, 0), 1.0, [(-60, 60)])),
    ('asteroid_massif', ((-1350, 150), 1.05, [(-1450, 150)])),
    ('nebula_cloud', ((-950, -800), 1.0, [(-1050, -900)])),
    ('expedition_graveyard', ((850, -800), 1.0, [(950, -880)])),
    ('storm_front', ((1500, 200), 1.05, [(1320, -300), (1500, 650)])),
    ('depleted_node', ((-100, 900), 1.0, [(-200, 950)])),
])


def dist_to_anchor(p, anchor):
    if len(anchor) == 1:
        return math.dist(p, anchor[0])
    (ax, ay), (bx, by) = anchor
    vx, vy = bx - ax, by - ay
    t = max(0, min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / (vx * vx + vy * vy)))
    return math.dist(p, (ax + t * vx, ay + t * vy))


region_of = {}
for p in CELLS:
    region_of[p] = min(REGIONS, key=lambda name: math.dist(p, REGIONS[name][0]) / REGIONS[name][1])

members = collections.OrderedDict((name, []) for name in REGIONS)
for p in CELLS:
    members[region_of[p]].append(p)
for name, cells in members.items():
    cells.sort(key=lambda p: (dist_to_anchor(p, REGIONS[name][2]), p))

# ── Роли внутри области (§5.5) ──────────────────────────────────────────────────────────
# Для каждой области — лестница (kind, terrain) по кольцам: сколько клеток ядра, оболочки,
# остальное — край. Типы миров раздаются ниже, штучно.
LADDER = {
    # Массив с ядром-целью (§5.4): мёртвый кристаллический мир в пылевой полосе (бюджет 2),
    # вокруг теснина массива (пылевые полосы, 2), край — обычное поле (3).
    'asteroid_massif': [(1, 'dead_world', 'dust_lane'), (4, 'asteroid', 'dust_lane'),
                        (None, 'asteroid', 'asteroid_field')],
    # Молекулярное облако: плотное ядро (3) → туманность (4) → чистый край (5).
    'nebula_cloud': [(2, 'dense_nebula', 'dense_nebula'), (5, 'nebula', 'nebula'),
                     (None, 'dead_world', 'empty_space')],
    # Кладбище экспедиции: погост на обломках (2) → обломки (2) → поля обломков по краю.
    'expedition_graveyard': [(2, 'graveyard', 'derelict_graveyard'),
                             (3, 'debris_field', 'derelict_graveyard'),
                             (None, 'debris_field', 'empty_space')],
    # Выработанный узел: связей много, добычи мало (5) → чистый космос (5) → пустота (6).
    'depleted_node': [(3, 'dead_world', 'depleted_system'), (4, 'dead_world', 'empty_space'),
                      (None, 'dead_world', 'deep_void')],
    # Штормовой фронт: ионные штормы полосой (2) → зона вспышек (4) → чистый край (5).
    'storm_front': [(4, 'ion_storm', 'ion_storm'), (4, 'solar_flare', 'solar_flare_zone'),
                    (None, 'dead_world', 'empty_space')],
    # Открытый простор — соединительная ткань: пузырь пустоты (6), чистый край (5).
    'open_expanse': [(8, 'dead_world', 'deep_void'), (None, 'dead_world', 'empty_space')],
}

P = collections.OrderedDict()  # id → сектор
ROLE = {}  # id → 'core' | 'shell' | 'edge' — ступень лестницы, служебная разметка генератора
REGION_SECTORS = collections.OrderedDict((name, []) for name in REGIONS)
for name, cells in members.items():
    i = 0
    steps = LADDER[name]
    for step, (n, kind, terrain) in enumerate(steps):
        take = cells[i:] if n is None else cells[i:i + n]
        role = 'edge' if step == len(steps) - 1 else ('core' if step == 0 else 'shell')
        for p in take:
            i += 1
            sid = GRID[p]
            P[sid] = {'x': p[0], 'y': p[1], 'kind': kind, 'terrain': terrain}
            ROLE[sid] = role
            REGION_SECTORS[name].append(sid)


PLACED = set()


def lattice_neighbors(sid):
    """Соседи по решётке — кандидаты в соседи по мозаике."""
    return [o for o in P if o != sid
            and math.dist((P[o]['x'], P[o]['y']), (P[sid]['x'], P[sid]['y'])) < 1.3 * STEP]


def place(region, x, y, role=None, pocket=False, **fields):
    """Штучный объект — в провинцию области `region` (и ступени `role`, если названа),
    ближайшую к точке. Одна провинция — один объект.

    `pocket` — тупик с одним подходом: ему нельзя стоять рядом с оболочкой. Её клетки
    с бюджетом 2 тянутся цепочкой, и тупик между ними стал бы единственной дорогой к ядру
    (`E_SECTOR_OVERLINKED`)."""
    ids = [s for s in REGION_SECTORS[region]
           if s not in PLACED and (role is None or ROLE[s] == role)
           and not (pocket and any(ROLE[o] == 'shell' for o in lattice_neighbors(s)))]
    sid = min(ids, key=lambda s: math.dist((P[s]['x'], P[s]['y']), (x, y)))
    PLACED.add(sid)
    P[sid].update(fields)
    return sid


# ── Штучные объекты и типы миров ────────────────────────────────────────────────────────
# Ядро массива — ЦЕЛЬ в сердце (§5.4): кристаллический мёртвый мир.
HEART = REGION_SECTORS['asteroid_massif'][0]
P[HEART].update(planetType='crystalline')
PLACED.add(HEART)
# Троянские карманы массива — богатые тупики с одним подходом (`asteroid_cluster`, 1).
place('asteroid_massif', -1900, -100, 'edge', pocket=True, kind='asteroid_cluster', terrain='asteroid_cluster')
place('asteroid_massif', -1300, 800, 'edge', pocket=True, kind='asteroid_cluster', terrain='asteroid_cluster')
place('asteroid_massif', -1150, 150, 'edge', kind='planet', planetType='gas_giant')
# Ядро облака — энергетический узел звездообразования.
NEXUS = REGION_SECTORS['nebula_cloud'][0]
P[NEXUS].update(planetType='energy_nexus')
PLACED.add(NEXUS)
# Тёмная глобула на краю облака — логово пиратов.
PIRATE = place('nebula_cloud', -1450, -850, 'shell', kind='pirate_base', terrain='dense_nebula', owner='pirates')
place('nebula_cloud', -500, -1000, 'edge', kind='planet', planetType='oceanic')
# Кладбище: последний лагерь экспедиции, её точка съёмки и нейтральная обсерватория.
place('expedition_graveyard', 1250, -1000, 'edge', kind='planet', planetType='fortress_world')
place('expedition_graveyard', 500, -1050, 'edge', kind='empty')
NEUTRAL = place('expedition_graveyard', 450, -650, 'edge', kind='neutral_base', owner='neutrals')
# Фронт: мир под вспышками и вулканический мир за полосой; столица соперника на краю.
place('storm_front', 1500, 350, 'shell', kind='planet', planetType='irradiated')
place('storm_front', 1850, 650, 'edge', kind='planet', planetType='volcanic')
RIVAL = place('storm_front', 1850, -350, 'edge', kind='planet', planetType='terran', owner='p2')
# Выработанный узел: пустой мир и мёртвая планета — в ядре; улей Роя на дальнем краю.
SPENT = REGION_SECTORS['depleted_node']
P[SPENT[0]].update(kind='planet', planetType='barren')
P[SPENT[1]].update(planetType='dead_world')
P[SPENT[2]].update(kind='asteroid')
PLACED.update(SPENT[:3])
HIVE = place('depleted_node', -800, 950, 'edge', kind='planet', planetType='terran', owner='p3')
# Простор: столица игрока, станция, перекрёсток, чёрная дыра и миры-перекрёстки.
CAPITAL = place('open_expanse', -350, 0, kind='planet', planetType='terran', owner='p1')
place('open_expanse', 250, 250, kind='void_station')
place('open_expanse', -100, -350, kind='empty')
place('open_expanse', 350, -200, kind='black_hole')
place('open_expanse', 200, -550, kind='planet', planetType='ringworld')
place('open_expanse', 550, 150, kind='planet', planetType='relic_world')
# Разломы — шрамы между областями: запирают собой, трасс не несут (M2.6).
place('open_expanse', -800, -300, kind='rift', terrain='empty_space')
place('open_expanse', 700, 500, kind='rift', terrain='empty_space')

# ── Песочница игрока и старты обитателей ───────────────────────────────────────────────
# Что игрок СТРОИТ — те же ворота, что у ядра: не `issued`, не уникальное фракции
# (`factions.uniqueUnits`), не корабль героя. Челноки живут в ангаре — их кладёт клиент.
unique = {u for f in DATA['factions'].values() for u in f.get('uniqueUnits', [])}
own_units = [uid for uid, u in DATA['units'].items()
             if uid != 'hero' and uid not in unique and 'issued' not in u.get('traits', [])]
ships = [u for u in own_units if DATA['units'][u].get('domain', 'space') == 'space'
         and 'shuttle' not in DATA['units'][u].get('traits', [])]
ground = [u for u in own_units if DATA['units'][u].get('domain') == 'ground']
# Постройки столицы — всё, что пускают ворота `building.construct` на обычном мире: не орган
# Роя (`infected`), `onlyOn` пуст или называет планету. Уровень — последний.
planet_roster = DATA['sectorKinds']['planet'].get('allowedBuildings')
capital_buildings = [
    {'type': bid, 'level': 1 + len(b.get('upgrades', []))}
    for bid, b in DATA['buildings'].items()
    if 'infected' not in b.get('traits', [])
    and (b.get('onlyOn') is None or 'planet' in b['onlyOn'])
    and (planet_roster is None or bid in planet_roster)
]

BUILDINGS = {
    CAPITAL: capital_buildings,
    RIVAL: [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}, {'type': 'barracks'}],
    # Улей Роя — как в главе I (`pve-1`): с верфью, иначе первую матку не заложить.
    HIVE: [{'type': 'biomass_pit'}, {'type': 'swarm_synapse'}, {'type': 'mine_t2'},
           {'type': 'shipyard', 'level': 2}, {'type': 'orbital_aa'}, {'type': 'barracks'},
           {'type': 'factory'}, {'type': 'swarm_datacenter'}],
    PIRATE: [{'type': 'shipyard'}, {'type': 'radar'}],
    NEUTRAL: [{'type': 'shipyard'}, {'type': 'radar'}, {'type': 'power_plant'}],
}
GARRISON = {
    CAPITAL: [{'unit': u, 'count': 3} for u in ground],
    RIVAL: [{'unit': 'militia', 'count': 3}],
    HIVE: [{'unit': 'militia', 'count': 5}, {'unit': 'heavy_infantry', 'count': 3}],
    PIRATE: [{'unit': 'pirate_boarder', 'count': 2}],
    NEUTRAL: [{'unit': 'militia', 'count': 2}],
}
PLENTY = 50000

sectors = collections.OrderedDict()
for sid, p in P.items():
    sec = collections.OrderedDict([('position', {'x': p['x'], 'y': p['y']}), ('kind', p['kind']),
                                   ('terrain', p['terrain'])])
    if p.get('planetType'):
        sec['planetType'] = p['planetType']
    if p.get('owner'):
        sec['owner'] = p['owner']
    if sid in BUILDINGS:
        sec['buildings'] = BUILDINGS[sid]
    if sid in GARRISON:
        sec['garrison'] = GARRISON[sid]
    sectors[sid] = sec

m = collections.OrderedDict([
    ('id', 'proving-ground'), ('seed', 'proving-ground'), ('time', 0),
    ('sectors', sectors),
    ('regions', [{'id': name, 'sectors': ids} for name, ids in REGION_SECTORS.items()]),
    ('players', collections.OrderedDict([
        ('p1', {'name': 'Azure Compact', 'faction': 'vanguard',
                'resources': {r: PLENTY for r in ('credits', 'metal', 'food', 'energy', 'microelectronics')}}),
        ('p2', {'name': 'Crimson Hegemony', 'faction': 'crimson', 'ai': True,
                'resources': {'credits': 400, 'metal': 400}}),
        ('p3', {'name': 'Swarm Collective', 'faction': 'swarm', 'ai': True,
                'resources': {'credits': 800, 'metal': 800, 'biomass': 300, 'microelectronics': 80,
                              'energy': 150}}),
        ('pirates', {'name': 'Pirate Base', 'faction': 'pirates', 'npc': 'pirate',
                     'resources': {'credits': 0, 'metal': 0}}),
        ('neutrals', {'name': 'Neutral AI Base', 'faction': 'vanguard', 'npc': 'neutral',
                      'resources': {'credits': 0, 'metal': 0}}),
    ])),
    ('fleets', collections.OrderedDict([
        ('p1_armada', {'owner': 'p1', 'location': CAPITAL,
                       'units': [{'unit': u, 'count': 2} for u in ships]}),
        ('p2_fleet', {'owner': 'p2', 'location': RIVAL,
                      'units': [{'unit': 'cruiser', 'count': 2}, {'unit': 'frigate', 'count': 2}]}),
        ('p3_brood', {'owner': 'p3', 'location': HIVE,
                      'units': [{'unit': 'swarm_brood_mother', 'count': 3, 'modules': ['swarm_brood_chamber']},
                                {'unit': 'scout_drone', 'count': 2}]}),
        ('pirate_patrol', {'owner': 'pirates', 'location': PIRATE,
                           'units': [{'unit': 'pirate_frigate', 'count': 2}]}),
    ])),
])
open('data/maps/proving-ground.json', 'w', encoding='utf-8').write(
    json.dumps(m, indent=2, ensure_ascii=False) + '\n')
print('провинций:', len(sectors), {name: len(ids) for name, ids in REGION_SECTORS.items()})
if '--roles' in __import__('sys').argv:
    for sid, p in P.items():
        print(f"  {sid:10} {ROLE[sid]:5} {p['kind']:16} {p['terrain']:18} {p.get('planetType', ''):14} {p.get('owner', '')} ({p['x']},{p['y']})")
