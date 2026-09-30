"""Четвёртая глава Сектора Зеро — «Архив без ответа».

Дизайн — `docs/sector-zero-map-concepts.md` §6 (обсуждён с владельцем 2026-09-27): разветвлённая
операция с союзным отрядом. Игрок устанавливает связь с союзником, добирается до архива,
извлекает накопитель и доставляет его в зону вывода у входа экспедиции.

ГЕОГРАФИЯ (§6.2). Смещённая к северу чёрная дыра — непроходимая область без путей: сама дыра
и разломы `rift` вокруг неё (бюджет связей ноль, MAP-BARRIER). Путь с запада на восток идёт
вокруг неё ДВУМЯ ДУГАМИ: внутренняя жмётся к дыре — короче и плотнее занята Роем; внешняя
шире и длиннее, на ней район союзника. Дуги связаны тремя перемычками, поэтому направление
можно сменить уже после начала операции, а один потерянный перекрёсток не запирает
половину карты. Между перемычками дуги разделяют разломы — отсюда пары близких провинций с
длинным обычным обходом, где полезен «Коридор» (дальность 300). Обычные пути всегда
оставляют способ пройти главу без этого героя.

КТО ГДЕ. У входа (запад) — база игрока: она же зона вывода накопителя (§6.2), рядом объекты
развития. Игрок стартует с ОДНОЙ планетой (заказ владельца 2026-09-28): Приют Завета на
северо-западе и Лабораторию Смена за дырой держат фанатики Завета Единения
(`docs/covenant-of-unity.md`) — их отбивают задачами. Точка встречи — стыковочный узел на
пути к внешней дуге, раньше основного сопротивления. Союзник — на внешнем направлении, его
стартовая база далеко от сенсоров игрока: география разводит отряды до встречи (§6.3). Архив —
на дальней стороне (восток), его держит десант Роя; улей Роя — на юго-востоке, в конце
внешней дуги, так что ни одна дуга не безопасна.

РАЗМЕР (редакция PVR-7.7, «карту бы побольше»): 45 провинций вместо 34 — земли Завета на
северо-западе, свободная колония за базой, южный пояс под внешней дугой с гнездовьем Роя,
врата района союзника и отмель за архивом. Дыра, дуги, перемычки и разломы — прежние.

ЧТО ПРОВЕРЯЕТСЯ ЧИСЛАМИ — `data/pveFourthMission.test.ts`. Двигая провинцию руками, перемерь:
любая правка координат может молча поменять соседство (оно выводится из мозаики, M4.3).

ЧИСЛА — ЭСКИЗ, а не баланс (§6.10): стартовые ресурсы и флоты сторон, гарнизоны подобраны от
третьей главы и уточняются после плейтеста.
"""
import json, collections

# Провинции: id → (x, y, вид, местность, владелец, гарнизон, постройки).
P = collections.OrderedDict([
    # ── ВХОД ЭКСПЕДИЦИИ (запад). База — тот же крепкий старт, что во всех главах (PVR-2.4):
    # форт второго уровня с выданным гарнизоном и `haven`. Она же зона вывода накопителя.
    ('staging',      (-880, -60, 'planet', 'empty_space', 'p1',
                      [{'unit': 'militia', 'count': 2}, {'unit': 'heavy_infantry', 'count': 4},
                       {'unit': 'garrison', 'count': 2}],
                      [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}, {'type': 'radar'},
                       {'type': 'fort', 'level': 2}])),
    ('ore_belt',     (-1010, -300, 'asteroid', 'asteroid_field', None, [], [])),
    ('salvage_yard', (-750, -330, 'dead_world', 'depleted_system', None, [], [])),
    ('south_camp',   (-950, 240, 'planet', 'empty_space', None, [], [])),
    ('approach',     (-650, 60, 'dead_world', 'deep_void', None, [], [])),
    # Запад за базой: свободная колония — первая планета, которую можно занять и развить.
    ('west_colony',  (-1060, 90, 'planet', 'empty_space', None, [], [])),

    # ── ЗЕМЛИ ЗАВЕТА (северо-запад). Община Завета Единения (§6.7, «Книга голосов»); её
    # приют захватили фанатики Скорого Принятия (`docs/covenant-of-unity.md`). За приютом —
    # богатый тупик (`asteroid_cluster`, один подход), на севере — станция-колокол.
    ('pilgrim_way',  (-830, -560, 'nebula', 'nebula', None, [], [])),
    ('covenant_hold', (-570, -490, 'planet', 'empty_space', 'covenant',
                       [{'unit': 'militia', 'count': 2}, {'unit': 'heavy_infantry', 'count': 2}], [])),
    ('north_drift',  (-320, -590, 'asteroid_cluster', 'asteroid_cluster', None, [], [])),
    ('choir_bell',   (-610, -800, 'void_station', 'empty_space', None, [], [])),
    ('quiet_belt',   (-980, -790, 'asteroid', 'asteroid_field', None, [], [])),

    # ── ТОЧКА ВСТРЕЧИ — стыковочный узел по дороге к внешней дуге (§6.3).
    ('rendezvous',   (-610, 340, 'void_station', 'empty_space', None, [], [])),
    # Юго-запад: поле обломков между точкой встречи и районом союзника.
    ('sw_wrecks',    (-660, 610, 'graveyard', 'derelict_graveyard', None, [], [])),

    # ── ВНУТРЕННЯЯ ДУГА: жмётся к дыре — короче и плотнее занята Роем.
    ('inner_w',      (-395, -45, 'asteroid', 'asteroid_field', None, [], [])),
    ('spire',        (-150, -85, 'planet', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 3}],
                      [{'type': 'shipyard', 'level': 2}])),
    ('hollow',       (95, 15, 'planet', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 3}],
                      [{'type': 'biomass_pit'}, {'type': 'shipyard', 'level': 2}])),
    ('spore_gate',   (395, -45, 'planet', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 3}],
                      [{'type': 'shipyard', 'level': 2}])),
    ('inner_e',      (665, -60, 'dead_world', 'depleted_system', None, [], [])),
    # Второй ряд внутренней дуги — у самого горизонта дыры: развилки вместо одной дорожки.
    ('ember',        (-20, -215, 'dense_nebula', 'dense_nebula', None, [], [])),
    ('shade',        (240, -190, 'nebula', 'nebula', None, [], [])),

    # ── ПЕРЕМЫЧКИ между дугами — сменить направление после начала операции; между ними
    # разломы, поэтому соседи по разные стороны разлома — пары под «Коридор».
    ('bridge_w',     (-370, 110, 'planet', 'empty_space', None, [], [])),
    ('rift_sw',      (-125, 70, 'rift', 'empty_space', None, [], [])),
    ('bridge_c',     (135, 140, 'graveyard', 'derelict_graveyard', None, [], [])),
    ('rift_se',      (385, 95, 'rift', 'empty_space', None, [], [])),
    ('bridge_e',     (615, 105, 'nebula', 'nebula', None, [], [])),

    # ── ВНЕШНЯЯ ДУГА: шире и длиннее, два ряда; на ней район союзника.
    ('outer_w',      (-360, 260, 'nebula', 'nebula', None, [], [])),
    ('gloom',        (-140, 200, 'nebula', 'nebula', None, [], [])),
    ('outer_mid',    (130, 285, 'dead_world', 'deep_void', None, [], [])),
    ('outer_e',      (375, 240, 'dead_world', 'depleted_system', None, [], [])),
    ('outer_far',    (640, 225, 'nebula', 'nebula', None, [], [])),
    # База союзника — крепкая, как дом игрока: отряд живёт своей задачей рядом с Роем, и
    # его гибель после встречи должна быть исходом боя, а не участью по умолчанию.
    ('ally_base',    (-240, 525, 'planet', 'empty_space', 'ally',
                      [{'unit': 'militia', 'count': 2}, {'unit': 'heavy_infantry', 'count': 4},
                       {'unit': 'garrison', 'count': 2}],
                      [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}, {'type': 'radar'},
                       {'type': 'fort', 'level': 2}])),
    ('ally_field',   (30, 575, 'asteroid', 'asteroid_field', 'ally', [], [])),
    ('bulwark_gate', (-60, 390, 'dead_world', 'depleted_system', None, [], [])),
    ('station_west', (300, 520, 'void_station', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 2}], [])),
    ('station_east', (575, 505, 'void_station', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 2}], [])),

    # ── ЮЖНЫЙ ПОЯС под внешней дугой: третий ряд, длинный и пустой; на востоке — гнездовье Роя.
    ('south_verge',  (-900, 560, 'nebula', 'nebula', None, [], [])),
    ('scrap_belt',   (-430, 800, 'asteroid', 'asteroid_field', None, [], [])),
    ('deep_relay',   (-60, 810, 'void_station', 'empty_space', None, [], [])),
    ('murk',         (310, 790, 'nebula', 'nebula', None, [], [])),
    ('nest',         (640, 790, 'dead_world', 'deep_void', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 3}], [])),

    # ── ЧЁРНАЯ ДЫРА, смещённая к северу, и разломы вокруг неё: непроходимая область.
    ('black_hole',   (110, -395, 'black_hole', 'empty_space', None, [], [])),
    ('rift_w',       (-150, -400, 'rift', 'empty_space', None, [], [])),
    ('rift_e',       (370, -420, 'rift', 'empty_space', None, [], [])),
    ('rift_n',       (130, -635, 'rift', 'empty_space', None, [], [])),

    # ── ДАЛЬНЯЯ СТОРОНА (восток): архив, подступы и северный карман за дырой.
    # Лаборатория за дырой: её заняли фанатики Завета; персонал ушёл на транспорты и ждёт
    # эвакуации на орбите («Последняя смена», §6.7).
    ('lab_outpost',  (540, -465, 'dead_world', 'deep_void', 'covenant',
                      [{'unit': 'militia', 'count': 1}], [])),
    ('far_eye',      (690, -615, 'void_station', 'empty_space', None, [], [])),
    ('archive_ring', (820, -300, 'dead_world', 'depleted_system', None, [], [])),
    ('archive',      (930, -85, 'void_station', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 4}], [])),
    ('east_reach',   (905, 205, 'dead_world', 'deep_void', None, [], [])),
    ('east_shoal',   (1070, 60, 'asteroid', 'asteroid_field', None, [], [])),
    ('hive',         (870, 525, 'planet', 'empty_space', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 6}],
                      [{'type': 'swarm_hive'}, {'type': 'swarm_datacenter'},
                       {'type': 'shipyard', 'level': 2}, {'type': 'barracks'},
                       {'type': 'fort'}, {'type': 'orbital_aa'}])),
])

# Своя задача союзника (§6.5): вернуть две внешние исследовательские станции — признак
# `ally_task` читает его планировщик (`decisions/allyOperation.ts`).
TRAITS = {'staging': ['haven'], 'station_west': ['ally_task'], 'station_east': ['ally_task'],
          # Колокол Хора — маяк задачи (PVR-5.3): флот игрока на нём, и сигнал притягивает Рой.
          'choir_bell': ['beacon']}
# Место встречи: первое прибытие флота игрока с живым кораблём устанавливает связь с союзником
# (PVR-7.2, `rendezvousModule`).
RENDEZVOUS = {'rendezvous': 'ally'}
# Архив с накопителем (PVR-7.3): часы работы флота у очищенного архива и зона вывода — база
# у входа. Срок — эскиз (§6.10): около полутора минут на ×150.
VAULT = {'archive': {'hours': 4, 'zone': 'staging'}}

# ЗАДАЧИ ЗАБЕГА — пул из восьми (§6.7 + общие глаголы); видно по правилу PVR-5.3, как во всех
# главах. Главная цепочка (связь → архив → накопитель → вывод) — не задача пула: она решает
# исход главы, а задачи — надбавка.
OBJECTIVES = [
    collections.OrderedDict([('id', 'mission.far-eye'), ('kind', 'control'),
                             ('targets', ['far_eye']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.fallback-line'), ('kind', 'build'),
                             ('targets', ['fort']), ('at', ['bridge_w']),
                             ('count', 1), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.last-shift'), ('kind', 'evac'),
                             ('count', 3), ('reward', 4)]),
    collections.OrderedDict([('id', 'mission.book-of-voices'), ('kind', 'control'),
                             ('targets', ['covenant_hold']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.shift-lab'), ('kind', 'control'),
                             ('targets', ['lab_outpost']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.take-spire'), ('kind', 'control'),
                             ('targets', ['spire']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.raze-biomass'), ('kind', 'raze'),
                             ('targets', ['biomass_pit']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.recon'), ('kind', 'scout'),
                             ('count', 24), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.hold-out'), ('kind', 'wave'),
                             ('count', 6), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.choir-bell'), ('kind', 'beacon'),
                             ('targets', ['choir_bell']), ('count', 8), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.second-yard'), ('kind', 'build'),
                             ('targets', ['shipyard']), ('at', ['west_colony']),
                             ('count', 1), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.nest'), ('kind', 'control'),
                             ('targets', ['nest']), ('reward', 3)]),
]
# Карта крупнее прочих, и задач видно больше (заказ владельца 2026-09-28): четыре с первого
# захода, потолок шесть — вместо общих 3 и 5.
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
    if sid in RENDEZVOUS:
        sec['rendezvous'] = RENDEZVOUS[sid]
    if sid in VAULT:
        sec['vault'] = VAULT[sid]
    sectors[sid] = sec

m = collections.OrderedDict([
    ('id', 'pve-4'), ('seed', 'pve-4'), ('time', 0), ('mode', 'pve_waves'),
    ('sectors', sectors),
    ('objectives', OBJECTIVES),
    ('objectiveSlots', OBJECTIVE_SLOTS),
    ('players', collections.OrderedDict([
        ('p1', {'name': 'Azure Compact', 'faction': 'vanguard',
                'resources': {'credits': 500, 'metal': 500}}),
        ('ally', {'name': 'Attached Detachment', 'faction': 'vanguard', 'npc': 'neutral',
                  'ai': True, 'resources': {'credits': 300, 'metal': 300}}),
        ('swarm', {'name': 'Swarm Collective', 'faction': 'swarm', 'ai': True,
                   'resources': {'credits': 1000, 'metal': 1000, 'biomass': 400,
                                 'microelectronics': 100, 'energy': 150}}),
        # Фанатики Завета — сценарные люди, как Колония Эхо в главе I: враждебный житель
        # (`npc: 'pirate'`), без бота и без флота, держит только гарнизоны.
        ('covenant', {'name': 'Covenant of Unity', 'faction': 'vanguard', 'npc': 'pirate',
                      'ai': False, 'resources': {'credits': 0, 'metal': 0}}),
    ])),
    ('fleets', collections.OrderedDict([
        ('p1_1', {'owner': 'p1', 'location': 'staging',
                  'landing': [{'unit': 'militia', 'count': 1}],
                  'units': [{'unit': 'cruiser', 'count': 2},
                            {'unit': 'scout_drone', 'count': 1}]}),
        ('p1_2', {'owner': 'p1', 'location': 'staging',
                  'units': [{'unit': 'cruiser', 'count': 2}]}),
        # Отряд союзника: ударная группа с десантом под свою задачу — вернуть станции.
        ('ally_1', {'owner': 'ally', 'location': 'ally_base',
                    'landing': [{'unit': 'militia', 'count': 2},
                                {'unit': 'heavy_infantry', 'count': 2}],
                    'units': [{'unit': 'cruiser', 'count': 2},
                              {'unit': 'frigate', 'count': 2}]}),
        # «Последняя смена»: транспорты персонала лаборатории ждут вывода к базе.
        ('p1_evac', {'joinsOnArrival': True, 'owner': 'p1', 'location': 'lab_outpost',
                     'units': [{'unit': 'evac_transport', 'count': 3}]}),
        ('swarm_1', {'owner': 'swarm', 'location': 'hive',
                     'units': [{'unit': 'swarm_brood_mother', 'count': 2}]}),
        ('swarm_2', {'owner': 'swarm', 'location': 'hollow',
                     'units': [{'unit': 'swarm_brood_mother', 'count': 1}]}),
        ('swarm_relay_1', {'owner': 'swarm', 'location': 'spore_gate',
                           'units': [{'unit': 'swarm_relay', 'count': 1},
                                     {'unit': 'frigate', 'count': 2}]}),
    ])),
])
open('data/maps/pve-4.json', 'w', encoding='utf-8').write(
    json.dumps(m, indent=2, ensure_ascii=False) + '\n')
print('провинций:', sum(1 for s in sectors.values() if s['kind'] not in ('rift', 'black_hole')))
