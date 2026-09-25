"""Третья глава Сектора Зеро — «Карантинный рубеж».

Дизайн — `docs/sector-zero-map-concepts.md` §5 (согласован владельцем 2026-09-24). Главная
идея — удержать рубеж, сохранив подвижный резерв: две широкие области соединены ТРЕМЯ
разнесёнными переходами, поперечные связи есть по обе стороны, одна крепость не закрывает
все подходы, а колонии не спрятаны за общей горловиной.

КАК ДЕЛАЕТСЯ РУБЕЖ. Соседство выводится из мозаики (M4.3), поэтому стену между областями
держат клетки непроходимого вида `rift` — пространственные разломы, оставшиеся от
карантинного барьера. Разлом стоит МЕЖДУ переходами и по краям; переход — это место,
а не дыра: западный — астероиды, центральный — старая станция карантина, восточный —
обход через туманность. Визуально рубеж задают станции и колонии, а разлом — просто
отсутствие пути (§5.3: «не сплошная декоративная стена»).

ОБЛАСТИ (заказ владельца 2026-09-25: «карта стерильная, прослеживается топология»). Первый
эскиз стоял зеркалом и рядами — ровная сетка читалась сквозь карту. Теперь провинции собраны
в области `docs/map-terrain-regions-concept.md` §5.5: открытый простор, астероидный массив,
туманное облако на севере; риф, кладбище экспедиции и штормовой фронт на юге. Зеркала нет,
общего шага по рядам нет.

ЧТО ПРОВЕРЯЕТСЯ ЧИСЛАМИ — `data/pveThirdMission.test.ts`: переходов ровно три, путь с
севера на юг идёт только через них, по обе стороны есть поперечные связи, у каждой колонии
свой подход, переходы разнесены так, что ни одна крепость не накрывает двух, и т. д.
Двигая провинцию руками, перемерь: любая правка координат может молча поменять соседство.

ЧИСЛА — ЭСКИЗ, а не баланс (§5.11): стартовые ресурсы и флот, гарнизоны, награды задач
выбраны от второй главы и подбираются после замеров.
"""
import json, collections

# Провинции: id → (x, y, вид, местность, владелец, гарнизон, постройки).
P = collections.OrderedDict([
    # СЕВЕР — сторона игрока. Три области, а не ряды: открытый простор в центре, астероидный
    # массив на северо-западе, туманное облако на северо-востоке (§5.5 концепции областей).
    #
    # ОТКРЫТЫЙ ПРОСТОР — база и глубокий дрейф за ней, выработанный двор перед воротами.
    # Дом — тот же крепкий старт, что во всех главах (PVR-2.4, `data/runStartDefense.test.ts`):
    # форт второго уровня с выданным гарнизоном, четыре тяжёлых пехотинца, `haven`.
    ('bastion',     (40, -470, 'planet', 'empty_space', 'p1',
                     [{'unit': 'militia', 'count': 2}, {'unit': 'heavy_infantry', 'count': 4},
                      {'unit': 'garrison', 'count': 2}],
                     [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}, {'type': 'radar'},
                      {'type': 'fort', 'level': 2}])),
    ('north_reach', (-230, -600, 'dead_world', 'deep_void', None, [], [])),
    ('gate_yard',   (-70, -280, 'dead_world', 'depleted_system', None, [], [])),
    ('north_gate',  (60, -150, 'planet', 'empty_space', None, [], [])),

    # АСТЕРОИДНЫЙ МАССИВ (северо-запад): колония на краю, в глубине — богатый тупик
    # (`asteroid_cluster`, один подход), к переходу массив редеет в обычное поле.
    # Колонии — обжитые миры: верфь у них есть (сторож стартовых миров,
    # `construction-yard-port.test.ts`), первого уровня — лёгкие корпуса строятся на месте.
    ('west_colony', (-600, -300, 'planet', 'empty_space', 'p1',
                     [{'unit': 'militia', 'count': 2}],
                     [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 1}])),
    ('ore_shelf',   (-470, -500, 'asteroid_cluster', 'asteroid_cluster', None, [], [])),
    ('watch_post',  (-560, -130, 'asteroid', 'asteroid_field', None, [], [])),
    ('front_w',     (-300, -190, 'asteroid', 'asteroid_field', None, [], [])),

    # ТУМАННОЕ ОБЛАКО (северо-восток): плотное ядро за колонией, обычная туманность по
    # краю; восточный переход — обход сквозь плотную часть облака.
    ('east_colony', (420, -390, 'planet', 'empty_space', 'p1',
                     [{'unit': 'militia', 'count': 2}],
                     [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 1}])),
    ('hinter_veil', (600, -580, 'dense_nebula', 'dense_nebula', None, [], [])),
    ('east_haze',   (560, -150, 'nebula', 'nebula', None, [], [])),
    ('front_e',     (390, -120, 'nebula', 'nebula', None, [], [])),

    # РУБЕЖ: три перехода между разломами. Разломы — непроходимые клетки (`rift`) между
    # переходами и по краям; переход — место, а не дыра.
    ('rift_far_w',  (-820, 40, 'rift', 'empty_space', None, [], [])),
    ('west_pass',   (-500, 20, 'asteroid', 'asteroid_field', None, [], [])),
    ('rift_w',      (-230, -10, 'rift', 'empty_space', None, [], [])),
    # Станция карантина потеряна: её держит десант Роя, построек у неё не осталось.
    ('quarantine',  (50, 15, 'planet', 'empty_space', 'swarm',
                     [{'unit': 'swarm_lander', 'count': 3}], [])),
    ('rift_e',      (340, 10, 'rift', 'empty_space', None, [], [])),
    ('east_pass',   (620, 30, 'dense_nebula', 'dense_nebula', None, [], [])),
    ('rift_far_e',  (860, -20, 'rift', 'empty_space', None, [], [])),

    # ЮГ — сторона Роя, тоже областями.
    # АСТЕРОИДНЫЙ РИФ (юго-запад) с выносным маяком в глубине.
    ('south_west',  (-520, 190, 'asteroid', 'asteroid_field', 'swarm', [], [])),
    ('biofarm_w',   (-330, 420, 'planet', 'empty_space', 'swarm',
                     [{'unit': 'swarm_lander', 'count': 3}],
                     [{'type': 'biomass_pit'}, {'type': 'shipyard', 'level': 2}])),
    ('beacon_rock', (-700, 480, 'asteroid', 'asteroid_field', None, [], [])),
    # КЛАДБИЩЕ ЭКСПЕДИЦИИ у плацдарма: обломки прикрывают подход к центральному переходу.
    ('wreck_w',     (-190, 210, 'graveyard', 'derelict_graveyard', 'swarm', [], [])),
    ('beachhead',   (90, 190, 'planet', 'empty_space', 'swarm',
                     [{'unit': 'swarm_lander', 'count': 3}],
                     [{'type': 'shipyard', 'level': 2}])),
    # ШТОРМОВОЙ ФРОНТ (юго-восток): ионная полоса и хвост облака за разломом.
    ('storm_e',     (360, 240, 'ion_storm', 'ion_storm', None, [], [])),
    ('spore_reach', (630, 210, 'nebula', 'nebula', 'swarm', [], [])),
    ('biofarm_e',   (440, 460, 'planet', 'empty_space', 'swarm',
                     [{'unit': 'swarm_lander', 'count': 3}],
                     [{'type': 'biomass_pit'}, {'type': 'swarm_synapse'},
                      {'type': 'shipyard', 'level': 2}])),
    # Очаг — вдали и не на оси карты.
    ('hive',        (120, 740, 'planet', 'empty_space', 'swarm',
                     [{'unit': 'swarm_lander', 'count': 6}],
                     [{'type': 'swarm_hive'}, {'type': 'swarm_datacenter'},
                      {'type': 'shipyard', 'level': 2}, {'type': 'barracks'},
                      {'type': 'fort'}, {'type': 'orbital_aa'}])),
])

# Выносной маяк — добровольный риск вдали от базы (§5.7), на стороне Роя.
TRAITS = {'beacon_rock': ['beacon'], 'bastion': ['haven']}

# ЗАДАЧИ ЗАБЕГА — пул из восьми (§5.7); видно по правилу PVR-5.3, как во всех главах.
OBJECTIVES = [
    collections.OrderedDict([('id', 'mission.retake-station'), ('kind', 'control'),
                             ('targets', ['quarantine']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.watch-post'), ('kind', 'control'),
                             ('targets', ['watch_post']), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.starfort-west'), ('kind', 'build'),
                             ('targets', ['starfort']), ('at', ['west_colony']),
                             ('count', 1), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.fort-east'), ('kind', 'build'),
                             ('targets', ['fort']), ('at', ['east_colony']),
                             ('count', 1), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.beacon'), ('kind', 'beacon'),
                             ('targets', ['beacon_rock']), ('count', 8), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.raze-biomass'), ('kind', 'raze'),
                             ('targets', ['biomass_pit']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.recon'), ('kind', 'scout'),
                             ('count', 16), ('reward', 2)]),
    collections.OrderedDict([('id', 'mission.beachhead'), ('kind', 'control'),
                             ('targets', ['beachhead']), ('reward', 4)]),
]

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
    ('id', 'pve-3'), ('seed', 'pve-3'), ('time', 0), ('mode', 'pve_waves'),
    ('sectors', sectors),
    ('objectives', OBJECTIVES),
    ('players', collections.OrderedDict([
        ('p1', {'name': 'Azure Compact', 'faction': 'vanguard',
                'resources': {'credits': 500, 'metal': 500}}),
        ('swarm', {'name': 'Swarm Collective', 'faction': 'swarm', 'ai': True,
                   'resources': {'credits': 900, 'metal': 900, 'biomass': 350,
                                 'microelectronics': 90, 'energy': 150}}),
    ])),
    ('fleets', collections.OrderedDict([
        # Резерв у базы и по крейсеру у колоний: сколько держать на позициях — решение игрока.
        ('p1_1', {'owner': 'p1', 'location': 'bastion',
                  'landing': [{'unit': 'militia', 'count': 1}],
                  'units': [{'unit': 'cruiser', 'count': 2},
                            {'unit': 'scout_drone', 'count': 1}]}),
        ('p1_2', {'owner': 'p1', 'location': 'bastion',
                  'units': [{'unit': 'cruiser', 'count': 2}]}),
        ('p1_w', {'owner': 'p1', 'location': 'west_colony',
                  'units': [{'unit': 'cruiser', 'count': 1}]}),
        ('p1_e', {'owner': 'p1', 'location': 'east_colony',
                  'units': [{'unit': 'cruiser', 'count': 1}]}),
        ('swarm_1', {'owner': 'swarm', 'location': 'hive',
                     'units': [{'unit': 'swarm_brood_mother', 'count': 2}]}),
        ('swarm_2', {'owner': 'swarm', 'location': 'beachhead',
                     'units': [{'unit': 'swarm_brood_mother', 'count': 1}]}),
        ('swarm_relay_1', {'owner': 'swarm', 'location': 'beachhead',
                           'units': [{'unit': 'swarm_relay', 'count': 1},
                                     {'unit': 'frigate', 'count': 2}]}),
    ])),
])
open('data/maps/pve-3.json', 'w', encoding='utf-8').write(
    json.dumps(m, indent=2, ensure_ascii=False) + '\n')
print('провинций:', len(sectors))
