"""Шестая глава Сектора Зеро — «Нулевой комплекс».

Дизайн — `docs/sector-zero-map-concepts.md` §8 (согласован с владельцем 2026-09-28): финальный
штурм места рождения системы и эвакуация людей. Экспедиция и прикомандированный отряд вместе
подавляют производство Роя, разбивают его главные силы и выводят выживших из карантинных доков.

ГЕОГРАФИЯ (§8.2) — РАЗОРВАННАЯ СПИРАЛЬ. Стена из разломов `rift` (бюджет связей ноль,
MAP-BARRIER) закручивается вокруг комплекса: хвост на западе за плацдармом, дальше вдоль юга,
вверх по востоку, над комплексом и внутрь, под северную литейную. Комплекс сидит внутри завитка
и смещён к северо-востоку. Стена тонкая — клетки разломов стоят между двумя рядами провинций,
поэтому соседи по разные стороны стены близки по прямой и далеки по дорогам: это пары под
«Коридор» (дальность 300). У каждой пары есть обычный обход.

Разрывы стены — пять проходов, которые и делают спираль разорванной:
- **Пролом** (юго-запад) — устье: с плацдарма во внутренний виток;
- **Шов** (юго-восток) — с южной дуги к нижним вратам внутреннего витка;
- **Тень комплекса** (восток) — с восточного отрога прямо к комплексу;
- **Кромка комплекса** (север) — с промышленного фланга к комплексу;
- **Пепельная равнина** (северо-запад) — с фланга во внутренний виток.

ТРИ ПОДХОДА к комплексу (§8.2), и ни один не обязателен:
- **прямой** — внутренним витком мимо Бастиона: короткий, но рядом с основной обороной;
- **промышленный фланг** — северо-запад и север, две литейные Роя: сначала подавить часть
  производства и облегчить штурм;
- **карантинные доки** — южная дуга и восточный отрог: выжившие, промежуточная позиция и
  обход к комплексу с востока. Доки связаны с дугой, отрогом и швом — не тупик.

КТО ГДЕ. База экспедиции — на юго-западе, она же убежище (`haven`) для эвакуации. Ближняя
экономика (свободная колония, астероидная полка) — за базой, до главного штурма. Союзник — в
тылу на юге, у пути эвакуации. Доки заняты Роем: он вошёл в технические отсеки, а люди укрылись
за переборкой и ждут на транспортах (§8.4) — те входят в игру, когда к докам прибывает флот
игрока. Производят Рой три мира: комплекс (улей) и две литейные (биомассовые карьеры). Бастион —
крепость с фортом и орбитальным ПКО, основная оборона прямого подхода; производства на нём нет.

ВОЛНЫ РОЖДАЮТСЯ В КОМПЛЕКСЕ. Модуль волн берёт домом мир Роя с наименьшим id на посеве
(`packages/shared-core/src/modules/pve.ts`), поэтому id комплекса — `complex`: он идёт первым
среди миров Роя. Переименовывая мир Роя, держи это правило.

ЧТО ПРОВЕРЯЕТСЯ ЧИСЛАМИ — `data/pveSixthMission.test.ts`. Двигая провинцию руками, перемерь:
любая правка координат может молча поменять соседство (оно выводится из мозаики, M4.3).

ЧИСЛА — ЭСКИЗ, а не баланс (§8.11): стартовые ресурсы и флоты сторон, гарнизоны подобраны от
четвёртой главы и уточняются после плейтеста.
"""
import json, collections

# Провинции: id → (x, y, вид, местность, владелец, гарнизон, постройки).
P = collections.OrderedDict([
    # ── ПЛАЦДАРМ ЭКСПЕДИЦИИ (юго-запад) — устье спирали. База — тот же крепкий старт, что во
    # всех главах (PVR-2.4): форт второго уровня с выданным гарнизоном. Она же убежище.
    ('forward_base', (-740, 270, 'planet', 'empty_space', 'p1',
                      [{'unit': 'militia', 'count': 2}, {'unit': 'heavy_infantry', 'count': 4},
                       {'unit': 'garrison', 'count': 2}],
                      [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}, {'type': 'radar'},
                       {'type': 'fort', 'level': 2}])),
    # Ближняя экономика за базой — доступна до главного штурма (§8.2).
    ('free_colony',  (-940, 490, 'planet', 'empty_space', None, [], [])),
    ('ore_shelf',    (-920, 60, 'asteroid', 'asteroid_field', None, [], [])),
    ('rear_drift',   (-550, 470, 'dead_world', 'depleted_system', None, [], [])),
    # Пролом — устье спирали: с плацдарма во внутренний виток.
    ('breach',       (-500, 150, 'dead_world', 'depleted_system', None, [], [])),

    # ── ТЫЛ СОЮЗНИКА (юг): отряд прикрывает общий тыл и путь эвакуации (§8.3).
    ('ally_camp',    (-700, 720, 'planet', 'empty_space', 'ally',
                      [{'unit': 'militia', 'count': 2}, {'unit': 'heavy_infantry', 'count': 4},
                       {'unit': 'garrison', 'count': 2}],
                      [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}, {'type': 'radar'},
                       {'type': 'fort', 'level': 2}])),

    # ── ЮЖНАЯ ДУГА — внешний виток спирали и путь эвакуации от доков к базе. Два ряда: потеря
    # одного перекрёстка не отрезает доки от базы.
    ('south_wake',   (-310, 400, 'nebula', 'nebula', None, [], [])),
    # Застава Роя на пути эвакуации — своя задача союзника (`ally_task`): расчистить дорогу.
    ('toll_post',    (-20, 360, 'void_station', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 2}], [])),
    ('ember_drift',  (240, 420, 'dead_world', 'depleted_system', None, [], [])),
    # Внешний причал — станция у доков: здесь можно поставить форт и прикрыть конвой (§8.7).
    ('dock_approach', (520, 500, 'void_station', 'empty_space', None, [], [])),
    ('hollow_reach', (-400, 670, 'nebula', 'nebula', None, [], [])),
    ('drift_ward',   (-140, 720, 'dead_world', 'deep_void', None, [], [])),
    ('burnt_hulls',  (150, 660, 'graveyard', 'derelict_graveyard', None, [], [])),
    ('salvage_line', (430, 740, 'asteroid', 'asteroid_field', None, [], [])),

    # ── КАРАНТИННЫЕ ДОКИ (юго-восток). Рой занял технические отсеки, люди ждут на транспортах.
    ('quarantine_docks', (700, 250, 'void_station', 'empty_space', 'swarm',
                          [{'unit': 'swarm_lander', 'count': 3}], [])),
    ('cold_moorings', (680, 500, 'dead_world', 'deep_void', None, [], [])),
    # Часовня общины — Книги голосов: удержать станцию, пока копируются записи (маяк задачи).
    ('voices_chapel', (940, 380, 'void_station', 'empty_space', None, [], [])),

    # ── ВОСТОЧНЫЙ ОТРОГ — от доков на север. Тень комплекса — проход в стене прямо к нему.
    ('east_spur',    (940, 50, 'dead_world', 'depleted_system', None, [], [])),
    ('east_terrace', (960, -230, 'nebula', 'nebula', None, [], [])),
    ('core_shadow',  (790, -180, 'dense_nebula', 'dense_nebula', None, [], [])),

    # ── СЕВЕРНЫЙ КРАЙ над комплексом: дозорная станция Роя и путь вдоль края карты.
    ('north_watch',  (890, -500, 'void_station', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 2}], [])),
    ('crown_ridge',  (620, -680, 'asteroid', 'asteroid_field', None, [], [])),
    ('spore_vents',  (320, -630, 'nebula', 'nebula', None, [], [])),

    # ── ПРОМЫШЛЕННЫЙ ФЛАНГ (северо-запад и север): литейные миры Роя.
    ('north_foundry', (40, -510, 'planet', 'empty_space', 'swarm',
                       [{'unit': 'swarm_lander', 'count': 4}],
                       [{'type': 'shipyard', 'level': 2}, {'type': 'biomass_pit'}])),
    # Пепельная равнина — выход с фланга во внутренний виток.
    ('ash_plain',    (-300, -460, 'dead_world', 'deep_void', None, [], [])),
    ('west_foundry', (-580, -380, 'planet', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 3}],
                      [{'type': 'shipyard', 'level': 2}, {'type': 'biomass_pit'},
                       {'type': 'swarm_synapse'}])),
    ('slag_belt',    (-810, -180, 'asteroid', 'asteroid_field', None, [], [])),
    # Внешняя станция у западной литейной — освободить её (дополнительная задача, §8.8). За ней —
    # богатый тупик (`asteroid_cluster`, один подход): металл как награда за станцию.
    ('outer_station', (-890, -470, 'void_station', 'empty_space', 'swarm',
                       [{'unit': 'swarm_lander', 'count': 2}], [])),
    ('pale_drift',   (-680, -630, 'asteroid_cluster', 'asteroid_cluster', None, [], [])),

    # ── ВНУТРЕННИЙ ВИТОК — прямой подход: короткий путь мимо основной обороны. Два ряда:
    # Бастион на южном ряду можно обойти северным. Верфь у Бастиона — как у каждого мира с
    # постройками на старте (сторож `construction-yard-port.test.ts`), производства нет.
    ('scar_field',   (-260, 140, 'asteroid', 'asteroid_field', None, [], [])),
    ('rampart',      (10, 110, 'planet', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 5}],
                      [{'type': 'shipyard'}, {'type': 'fort', 'level': 2},
                       {'type': 'orbital_aa'}])),
    ('lower_gate',   (280, 130, 'dead_world', 'depleted_system', None, [], [])),
    ('cinder_reach', (-180, -180, 'dead_world', 'depleted_system', None, [], [])),
    ('inner_waste',  (90, -140, 'dead_world', 'deep_void', None, [], [])),
    ('inner_gate',   (380, -150, 'dead_world', 'depleted_system', None, [], [])),
    # Шов — проход в стене между южной дугой и нижними вратами.
    ('seam',         (480, 280, 'nebula', 'nebula', None, [], [])),
    ('complex_rim',  (280, -390, 'dead_world', 'deep_void', None, [], [])),

    # ── НУЛЕВОЙ КОМПЛЕКС — место рождения системы и главный производящий мир Роя (§8.6).
    ('complex',      (580, -250, 'planet', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 8}],
                      [{'type': 'swarm_hive'}, {'type': 'swarm_datacenter'},
                       {'type': 'shipyard', 'level': 2}, {'type': 'barracks'},
                       {'type': 'fort', 'level': 2}, {'type': 'orbital_aa'}])),

    # ── СТЕНА СПИРАЛИ — тонкая цепочка разломов, от внешнего хвоста к завитку над комплексом.
    ('rift_w1',      (-420, -210, 'rift', 'empty_space', None, [], [])),
    ('rift_w2',      (-410, -10, 'rift', 'empty_space', None, [], [])),
    ('rift_s0',      (-350, 280, 'rift', 'empty_space', None, [], [])),
    ('rift_s1',      (-150, 240, 'rift', 'empty_space', None, [], [])),
    ('rift_s2',      (50, 260, 'rift', 'empty_space', None, [], [])),
    ('rift_s3',      (260, 270, 'rift', 'empty_space', None, [], [])),
    ('rift_e0',      (590, 360, 'rift', 'empty_space', None, [], [])),
    ('rift_e1',      (580, 140, 'rift', 'empty_space', None, [], [])),
    ('rift_e2',      (680, -30, 'rift', 'empty_space', None, [], [])),
    ('rift_n1',      (720, -430, 'rift', 'empty_space', None, [], [])),
    ('rift_n2',      (500, -490, 'rift', 'empty_space', None, [], [])),
    ('rift_c1',      (40, -320, 'rift', 'empty_space', None, [], [])),
])

# Своя задача союзника (§8.3): снять заставу на пути эвакуации — признак `ally_task` читает его
# планировщик (`decisions/allyOperation.ts`). Часовня — маяк задачи (PVR-5.3): флот игрока на
# ней, и сигнал притягивает Рой.
TRAITS = {'forward_base': ['haven'], 'toll_post': ['ally_task'], 'voices_chapel': ['beacon']}

# ЗАДАЧИ ЗАБЕГА — пул из двенадцати (§8.8 + общие глаголы); видно по правилу PVR-5.3, как во
# всех главах. Три результата операции (производство, главные силы, основная эвакуация) — не
# задачи пула: они решают исход главы, а задачи — надбавка.
OBJECTIVES = [
    # Три побочные задачи §8.8.
    collections.OrderedDict([('id', 'mission.chapel-books'), ('kind', 'beacon'),
                             ('targets', ['voices_chapel']), ('count', 8), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.outer-station'), ('kind', 'control'),
                             ('targets', ['outer_station']), ('reward', 3)]),
    # Основной эвакуации хватит трёх транспортов из четырёх; эта задача — довести всех.
    collections.OrderedDict([('id', 'mission.all-survivors'), ('kind', 'evac'),
                             ('count', 4), ('reward', 4)]),
    # Укреплённый рубеж на пути конвоя (§8.7).
    collections.OrderedDict([('id', 'mission.dock-line'), ('kind', 'build'),
                             ('targets', ['fort']), ('at', ['dock_approach']),
                             ('count', 1), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.take-rampart'), ('kind', 'control'),
                             ('targets', ['rampart']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.north-watch'), ('kind', 'control'),
                             ('targets', ['north_watch']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.burnt-hulls'), ('kind', 'control'),
                             ('targets', ['burnt_hulls']), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.rear-yard'), ('kind', 'build'),
                             ('targets', ['shipyard']), ('at', ['free_colony']),
                             ('count', 1), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.raze-biomass'), ('kind', 'raze'),
                             ('targets', ['biomass_pit']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.fortify'), ('kind', 'build'),
                             ('targets', ['fort']), ('count', 3), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.recon'), ('kind', 'scout'),
                             ('count', 22), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.hold-out'), ('kind', 'wave'),
                             ('count', 6), ('reward', 2)]),
]
# Пул как у четвёртой главы (заказ владельца 2026-09-28): четыре с первого захода, потолок шесть.
OBJECTIVE_SLOTS = {'base': 4, 'cap': 6}

sectors = collections.OrderedDict()
for sid, (x, y, kind, terrain, owner, garr, blds) in P.items():
    sec = collections.OrderedDict([('position', {'x': x, 'y': y}), ('kind', kind),
                                   ('terrain', terrain)])
    if owner:
        sec['owner'] = owner
    if blds:
        sec['buildings'] = blds
    if garr:
        sec['garrison'] = garr
    if sid in TRAITS:
        sec['traits'] = TRAITS[sid]
    sectors[sid] = sec

m = collections.OrderedDict([
    ('id', 'pve-6'), ('seed', 'pve-6'), ('time', 0), ('mode', 'pve_waves'),
    ('sectors', sectors),
    ('objectives', OBJECTIVES),
    ('objectiveSlots', OBJECTIVE_SLOTS),
    ('players', collections.OrderedDict([
        ('p1', {'name': 'Azure Compact', 'faction': 'vanguard',
                'resources': {'credits': 500, 'metal': 500}}),
        # Прикомандированный отряд — житель карты, как в четвёртой главе. Союз с первой минуты
        # (§8.3) объявит отдельный кирпич фазы.
        ('ally', {'name': 'Attached Detachment', 'faction': 'vanguard', 'npc': 'neutral',
                  'ai': True, 'resources': {'credits': 300, 'metal': 300}}),
        ('swarm', {'name': 'Swarm Collective', 'faction': 'swarm', 'ai': True,
                   'resources': {'credits': 1000, 'metal': 1000, 'biomass': 400,
                                 'microelectronics': 100, 'energy': 150}}),
    ])),
    ('fleets', collections.OrderedDict([
        ('p1_1', {'owner': 'p1', 'location': 'forward_base',
                  'landing': [{'unit': 'militia', 'count': 1}],
                  'units': [{'unit': 'cruiser', 'count': 2},
                            {'unit': 'scout_drone', 'count': 1}]}),
        ('p1_2', {'owner': 'p1', 'location': 'forward_base',
                  'units': [{'unit': 'cruiser', 'count': 2}]}),
        ('ally_1', {'owner': 'ally', 'location': 'ally_camp',
                    'landing': [{'unit': 'militia', 'count': 2},
                                {'unit': 'heavy_infantry', 'count': 2}],
                    'units': [{'unit': 'cruiser', 'count': 2},
                              {'unit': 'frigate', 'count': 2}]}),
        # Выжившие доков: четыре транспорта ждут за переборкой и входят в игру, когда к докам
        # прибывает флот игрока (`joinsOnArrival`, заказ владельца 2026-09-29).
        ('p1_evac', {'joinsOnArrival': True, 'owner': 'p1', 'location': 'quarantine_docks',
                         'units': [{'unit': 'evac_transport', 'count': 4}]}),
        # Главные силы Роя — три соединения: охрана комплекса, флот Бастиона и резерв у северной
        # дозорной станции.
        ('swarm_guard', {'owner': 'swarm', 'location': 'complex',
                         'units': [{'unit': 'swarm_brood_mother', 'count': 3},
                                   {'unit': 'frigate', 'count': 2}]}),
        ('swarm_host', {'owner': 'swarm', 'location': 'rampart',
                        'units': [{'unit': 'swarm_brood_mother', 'count': 2},
                                  {'unit': 'frigate', 'count': 2}]}),
        ('swarm_reserve', {'owner': 'swarm', 'location': 'north_watch',
                           'units': [{'unit': 'swarm_brood_mother', 'count': 2}]}),
        # Пост сети Роя на северном проходе: связывает комплекс с фронтом.
        ('swarm_relay_1', {'owner': 'swarm', 'location': 'complex_rim',
                           'units': [{'unit': 'swarm_relay', 'count': 1},
                                     {'unit': 'frigate', 'count': 2}]}),
    ])),
])
open('data/maps/pve-6.json', 'w', encoding='utf-8').write(
    json.dumps(m, indent=2, ensure_ascii=False) + '\n')
print('провинций:', sum(1 for s in sectors.values() if s['kind'] not in ('rift', 'black_hole')))
