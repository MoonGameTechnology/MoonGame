"""Пятая глава Сектора Зеро — «Разорванная сеть».

Дизайн — `docs/sector-zero-map-concepts.md` §7 (обсуждён с владельцем 2026-09-28): совместное
наступление против ТРЁХ очагов Роя вместе с прикомандированным союзником, разведка и разрыв сети
обмена опытом. Союзник на связи с первой минуты: встречи, как в главе IV, нет (§7.2) — как и в
главе VI, карта объявляет встречу уже состоявшейся (`contactAtStart`).

ИСХОД (§7.5). Главу решает контракт операции главы VI, но из одних очагов: Рой потерял все три
(кто бы их ни взял — игрок или союзник), соединений и эвакуации в контракте нет (PVR-9.3).

ГЕОГРАФИЯ (§7.3). Тыл экспедиции — юг: база игрока на юго-западе, база союзника на юго-востоке,
между ними общий тыл. Север — три района Роя, у каждого свой очаг:

* ЗАПАДНЫЙ — астероиды, несколько подходов и ВЫНЕСЕННОЕ соединение сети: единственный
  ретранслятор между западным очагом и центром стоит на Жиле, ближе к экспедиции. Первый
  понятный разрыв, но не обязательный первый ход.
* ЦЕНТРАЛЬНЫЙ — перекрёсток, улей и ДВЕ цепочки связи с востоком: заметная (Створ) и обходная
  (Северная гряда). Один сбитый ретранслятор восток не изолирует — надо найти второй.
* ВОСТОЧНЫЙ — открытые подходы, удалённая верфь Роя вне сети и место для перемещения
  ретрансляторов; на внешнем обходе — наблюдательная станция «Дальний глаз».

Районы связаны центральным перекрёстком, поперечными путями и внешними обходами: потеря
перекрёстка осложняет движение, но не запирает экспедицию на юге. Разломы между районами дают
пары близких провинций с длинным обычным обходом — под «Коридор» (§6.6), но не обязательные.

ДВА ГРАФА (§7.3). Дороги выводятся из мозаики; сеть Роя — из пересечения кругов связи:
центр данных (200) у каждого очага и большие ретрансляторы (240) на постах. Числа кругов живут
в `data/`, раскладка постов здесь подобрана под них — `data/pveFifthMission.test.ts` проверяет
сеть по настоящей геометрии ядра (`swarmNet`), а не по нарисованным линиям.

КТО ГДЕ. Игрок стартует с ОДНОЙ планетой (заказ владельца к главе IV, 2026-09-28). Убежище
проповедника Скорого Принятия (задача «Голос Единения», `docs/covenant-of-unity.md`) — на
западном боковом направлении: колонию держит вооружённая группа Завета, она стоит на пути
транспортов станции «Последний сеанс» и прикрывает подход к западному ретранслятору. Союзник
без приказа закрепляется на двух освобождаемых позициях тыла (`ally_task`).

ЧТО ПРОВЕРЯЕТСЯ ЧИСЛАМИ — `data/pveFifthMission.test.ts`. Двигая провинцию руками, перемерь:
правка координат может молча поменять соседство (оно выводится из мозаики, M4.3) и связь сети.

ЧИСЛА — ЭСКИЗ, а не баланс (§7.8): стартовые силы, гарнизоны и бюджеты взяты от четвёртой
главы; общий бюджет Роя поделён между тремя очагами, а не умножен втрое.
"""
import json, collections

# Провинции: id → (x, y, вид, местность, владелец, гарнизон, постройки).
# id миров Роя начинаются не раньше `focus_center`: улей волн — мир Роя с наименьшим id
# (`npcStagingWorld`), и им должен быть центральный очаг.
P = collections.OrderedDict([
    # ── ТЫЛ ЭКСПЕДИЦИИ (юго-запад). База — тот же крепкий старт, что во всех главах (PVR-2.4):
    # форт второго уровня с выданным гарнизоном и `haven`. Она же безопасная зона для
    # пленного и транспортов станции.
    ('staging',       (-560, 600, 'planet', 'empty_space', 'p1',
                       [{'unit': 'militia', 'count': 2}, {'unit': 'heavy_infantry', 'count': 4},
                        {'unit': 'garrison', 'count': 2}],
                       [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}, {'type': 'radar'},
                        {'type': 'fort', 'level': 2}])),
    # Свободная колония за базой — первая планета, которую можно занять и развить.
    ('west_colony',   (-900, 700, 'planet', 'empty_space', None, [], [])),
    ('ore_field',     (-800, 430, 'asteroid', 'asteroid_field', None, [], [])),
    ('w_verge',       (-1100, 450, 'asteroid', 'asteroid_field', None, [], [])),
    ('supply_drift',  (-300, 790, 'dead_world', 'depleted_system', None, [], [])),
    ('south_mid',     (-280, 360, 'nebula', 'nebula', None, [], [])),

    # ── ОБЩИЙ ТЫЛ (юг, между базами): стыковочная станция и позиции, которые союзник
    # освобождает сам (§7.2: «закрепляется на заранее обозначенных освобождаемых позициях»).
    ('rear_dock',     (0, 560, 'void_station', 'empty_space', None, [], [])),
    ('outpost_south', (230, 470, 'dead_world', 'deep_void', 'swarm',
                       [{'unit': 'swarm_lander', 'count': 2}], [])),
    ('south_verge',   (330, 800, 'nebula', 'nebula', None, [], [])),
    ('south_rim',     (10, 830, 'nebula', 'nebula', None, [], [])),

    # ── ТЫЛ СОЮЗНИКА (юго-восток). База крепкая, как дом игрока: отряд живёт своей задачей
    # рядом с Роем, и его гибель должна быть исходом боя, а не участью по умолчанию.
    ('ally_base',     (600, 620, 'planet', 'empty_space', 'ally',
                       [{'unit': 'militia', 'count': 2}, {'unit': 'heavy_infantry', 'count': 4},
                        {'unit': 'garrison', 'count': 2}],
                       [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}, {'type': 'radar'},
                        {'type': 'fort', 'level': 2}])),
    ('ally_field',    (880, 720, 'asteroid', 'asteroid_field', 'ally', [], [])),
    ('outpost_east',  (880, 400, 'void_station', 'empty_space', 'swarm',
                       [{'unit': 'swarm_lander', 'count': 2}], [])),
    ('e_verge',       (1120, 330, 'nebula', 'nebula', None, [], [])),

    # ── ФРОНТ: центральный перекрёсток, подходы к районам и внешние обходы.
    # Перекрёсток — станция: на нём можно поставить форт («Опорный рубеж»).
    ('crossroad',     (0, 110, 'void_station', 'empty_space', None, [], [])),
    ('west_approach', (-560, 170, 'dead_world', 'deep_void', None, [], [])),
    ('east_approach', (560, 180, 'dead_world', 'depleted_system', None, [], [])),
    ('east_mid',      (330, 260, 'nebula', 'nebula', None, [], [])),
    ('west_bypass',   (-1000, 180, 'nebula', 'nebula', None, [], [])),
    ('east_bypass',   (1060, 30, 'dead_world', 'deep_void', None, [], [])),
    # Поперечные пути между районами — сменить направление, не возвращаясь в тыл.
    ('w_cross',       (-320, -100, 'nebula', 'nebula', None, [], [])),
    ('e_cross',       (320, -90, 'nebula', 'nebula', None, [], [])),
    ('c_south',       (0, -180, 'dead_world', 'deep_void', None, [], [])),

    # ── ЗАПАДНЫЙ РАЙОН: астероиды, несколько подходов, вынесенное соединение сети.
    ('focus_west',    (-640, -560, 'planet', 'empty_space', 'swarm',
                       [{'unit': 'swarm_lander', 'count': 3}],
                       [{'type': 'swarm_datacenter'}, {'type': 'biomass_pit'},
                        {'type': 'shipyard', 'level': 2}])),
    # Жила — вынесенное соединение: здесь стоит ретранслятор между западом и центром.
    ('w_link',        (-350, -470, 'asteroid', 'asteroid_field', None, [], [])),
    ('w_shoal',       (-520, -230, 'asteroid', 'asteroid_field', None, [], [])),
    ('w_rocks',       (-860, -300, 'asteroid', 'asteroid_field', None, [], [])),
    ('w_north',       (-400, -760, 'asteroid', 'asteroid_field', None, [], [])),
    ('w_far',         (-900, -720, 'asteroid_cluster', 'asteroid_cluster', None, [], [])),
    # Убежище проповедника (задача «Голос Единения»): колонию держит вооружённая группа
    # Завета; оно стоит на пути транспортов станции и прикрывает подход к Жиле. Как миры
    # Завета в главе IV — гарнизон без построек: обжитой мир с постройками начинает с верфью
    # (`construction-yard-port.test.ts`), а верфь фанатикам незачем. Гарнизон — на ступень
    # крепче Приюта главы IV: замер ядром (2026-10-04) — весь стартовый десант экспедиции
    # (3 ополченца + 4 тяжёлых пехотинца) убежище не берёт, с одним новым пехотинцем из
    # казарм берёт уверенно; союзник по приказу «Атаковать» собирает свой десант и берёт
    # убежище сам (`data/pveFifthMission.test.ts`, `prototype/src/chapterFiveRun.test.ts`).
    ('hideout',       (-760, -80, 'planet', 'empty_space', 'covenant',
                       [{'unit': 'militia', 'count': 3}, {'unit': 'heavy_infantry', 'count': 2}],
                       [])),
    # Станция «Последний сеанс»: персонал ждёт на транспортах вывода к базе.
    ('listening_post', (-1060, -470, 'void_station', 'empty_space', None, [], [])),

    # ── ЦЕНТРАЛЬНЫЙ РАЙОН: улей, перекрёстки и две цепочки связи с востоком.
    ('focus_center',  (0, -620, 'planet', 'empty_space', 'swarm',
                       [{'unit': 'swarm_lander', 'count': 6}],
                       [{'type': 'swarm_hive'}, {'type': 'swarm_datacenter'},
                        {'type': 'biomass_pit'}, {'type': 'swarm_synapse'},
                        {'type': 'shipyard', 'level': 2}, {'type': 'barracks'},
                        {'type': 'fort'}, {'type': 'orbital_aa'}])),
    # Створ — заметная цепочка: ретранслятор на прямом пути центр–восток.
    ('c_gate',        (320, -400, 'void_station', 'empty_space', None, [], [])),
    # Северная гряда — обходная цепочка: второй ретранслятор за ульем.
    ('c_north',       (330, -840, 'dense_nebula', 'dense_nebula', None, [], [])),
    ('c_ridge',       (-150, -880, 'nebula', 'nebula', None, [], [])),
    # Пеленгатор — маяк задачи: держать его, пока Рой отвечает силами.
    ('beacon_post',   (-60, -440, 'dead_world', 'deep_void', None, [], [])),

    # ── ВОСТОЧНЫЙ РАЙОН: открытые подходы, удалённое производство, простор для постов.
    ('focus_east',    (660, -570, 'planet', 'empty_space', 'swarm',
                       [{'unit': 'swarm_lander', 'count': 4}],
                       [{'type': 'swarm_datacenter'}, {'type': 'swarm_synapse'},
                        {'type': 'shipyard', 'level': 2}, {'type': 'fort'}])),
    ('e_open',        (590, -270, 'dead_world', 'deep_void', None, [], [])),
    # Удалённая верфь Роя — производственная позиция вне сети.
    ('remote_yard',   (1000, -440, 'void_station', 'empty_space', 'swarm',
                       [{'unit': 'swarm_lander', 'count': 2}],
                       [{'type': 'shipyard', 'level': 2}])),
    ('e_north',       (720, -860, 'dead_world', 'depleted_system', None, [], [])),
    # «Дальний глаз» — вынесенная наблюдательная станция у внешнего маршрута.
    ('far_eye',       (1080, -760, 'void_station', 'empty_space', None, [], [])),
    ('e_drift',       (880, -150, 'asteroid', 'asteroid_field', None, [], [])),

    # ── РАЗЛОМЫ между районами: непроходимые, отсюда пары близких провинций с длинным
    # обычным обходом (под «Коридор»).
    ('rift_w',        (-200, -470, 'rift', 'empty_space', None, [], [])),
    ('rift_e',        (470, -340, 'rift', 'empty_space', None, [], [])),
])

TRAITS = {
    'staging': ['haven'],
    # Своя задача союзника без приказа (§7.2): освободить позиции общего тыла.
    'outpost_south': ['ally_task'],
    'outpost_east': ['ally_task'],
    # Пеленгатор — маяк задачи (PVR-5.3): флот игрока на нём, и сигнал притягивает Рой.
    'beacon_post': ['beacon'],
    # «Найти связующее звено»: куда ведут старые схемы архива — к ближайшему соединению.
    'w_link': ['net_lead'],
}
# Пленный главы (PVR-9.5): убежище и безопасная зона доставки — база игрока.
CAPTIVE = {'hideout': {'zone': 'staging'}}

# Союзник с первой минуты (§7.2, PVR-9.2): встреча состоялась до операции, как в главе VI.
# Место связи — база союзника; загрузчик записывает контакт и ставит союз (`contactAtStart`),
# поэтому окно связи, приказы и общий обзор работают с нулевой минуты.
LINK = {'ally_base': {'rendezvous': 'ally', 'contactAtStart': True}}

# ЗАДАЧИ ЗАБЕГА — пул из двенадцати (§7.6 + «Голос Единения» + общие глаголы); видно по
# правилу PVR-5.3. Главная цепочка (звено → три очага) — не задача пула: она решает исход.
# Взятое, снесённое и удержанное союзником засчитывается и игроку (§7.6: «общая операция
# учитывает обе стороны»), как в главе VI. Постройки и эвакуация — только силами игрока:
# транспорты станции выходят к флоту игрока, союзник их охраняет, но не везёт.
def objective(oid, kind, **kw):
    o = collections.OrderedDict([('id', oid), ('kind', kind)])
    for key in ('targets', 'at', 'count', 'reward'):
        if key in kw:
            o[key] = kw[key]
    return o

OBJECTIVES = [
    objective('mission.break-net', 'isolate', targets=['focus_west'], reward=3),
    objective('mission.voice-of-unity', 'captive', targets=['hideout'], reward=4),
    objective('mission.watch-station', 'control', targets=['far_eye'], reward=3),
    objective('mission.last-session', 'evac', count=3, reward=4),
    objective('mission.bulwark', 'build', targets=['fort'], at=['crossroad'], count=1,
              reward=2),
    objective('mission.bypass-channel', 'isolate', targets=['focus_east'], reward=3),
    objective('mission.direction-finder', 'beacon', targets=['beacon_post'], count=6,
              reward=3),
    objective('mission.remote-yard', 'control', targets=['remote_yard'], reward=3),
    objective('mission.field-yard', 'build', targets=['shipyard'], at=['west_colony'],
              count=1, reward=2),
    objective('mission.raze-biomass', 'raze', targets=['biomass_pit'], reward=3),
    objective('mission.recon', 'scout', count=25, reward=2),
    objective('mission.hold-out', 'wave', count=6, reward=2),
]
# Карта крупная, задач видно больше — как у главы IV после PVR-7.7: четыре с первого захода,
# потолок шесть.
OBJECTIVE_SLOTS = {'base': 4, 'cap': 6}

# КОНТРАКТ ОПЕРАЦИИ (§7.5, PVR-9.3): главу выигрывают три очага Роя — Рой не держит ни
# одного, кто бы их ни взял. Соединений и эвакуации в контракте нет: разрыв сети —
# преимущество, а не условие, и последнего удара игрока не требуется.
OPERATION = collections.OrderedDict([
    ('production', ['focus_west', 'focus_center', 'focus_east']),
])

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
    if sid in CAPTIVE:
        sec['captive'] = CAPTIVE[sid]
    sec.update(LINK.get(sid, {}))
    sectors[sid] = sec

RELAY_ESCORT = [{'unit': 'swarm_relay', 'count': 1}, {'unit': 'frigate', 'count': 2}]

m = collections.OrderedDict([
    ('id', 'pve-5'), ('seed', 'pve-5'), ('time', 0), ('mode', 'pve_waves'),
    ('sectors', sectors),
    ('objectives', OBJECTIVES),
    ('objectiveSlots', OBJECTIVE_SLOTS),
    ('operation', OPERATION),
    ('players', collections.OrderedDict([
        ('p1', {'name': 'Azure Compact', 'faction': 'vanguard',
                'resources': {'credits': 500, 'metal': 500}}),
        # Прикомандированный отряд — житель карты, как в главах IV и VI. Союз с первой минуты
        # (§7.2) ставит `contactAtStart` на его базе (LINK выше).
        ('ally', {'name': 'Attached Detachment', 'faction': 'vanguard', 'npc': 'neutral',
                  'ai': True, 'resources': {'credits': 300, 'metal': 300}}),
        ('swarm', {'name': 'Swarm Collective', 'faction': 'swarm', 'ai': True,
                   'resources': {'credits': 1000, 'metal': 1000, 'biomass': 400,
                                 'microelectronics': 100, 'energy': 150}}),
        # Вооружённая группа Завета — сценарные люди, как в главах I и IV: враждебный житель
        # (`npc: 'pirate'`), без бота и без флота, держит только убежище.
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
        # «Последний сеанс»: транспорты персонала станции ждут вывода к базе.
        ('p1_evac', {'joinsOnArrival': True, 'owner': 'p1', 'location': 'listening_post',
                     'units': [{'unit': 'evac_transport', 'count': 3}]}),
        # Отряд союзника: ударная группа с десантом и лёгкий разведчик.
        ('ally_1', {'owner': 'ally', 'location': 'ally_base',
                    'landing': [{'unit': 'militia', 'count': 2},
                                {'unit': 'heavy_infantry', 'count': 2}],
                    'units': [{'unit': 'cruiser', 'count': 2},
                              {'unit': 'frigate', 'count': 2}]}),
        ('ally_2', {'owner': 'ally', 'location': 'ally_base',
                    'units': [{'unit': 'frigate', 'count': 1}]}),
        # Силы Роя поделены между очагами.
        ('swarm_1', {'owner': 'swarm', 'location': 'focus_center',
                     'units': [{'unit': 'swarm_brood_mother', 'count': 2}]}),
        ('swarm_2', {'owner': 'swarm', 'location': 'focus_west',
                     'units': [{'unit': 'swarm_brood_mother', 'count': 1}]}),
        ('swarm_3', {'owner': 'swarm', 'location': 'focus_east',
                     'units': [{'unit': 'swarm_brood_mother', 'count': 1}]}),
        # Посты сети (`relay_post`): запад–центр одним постом, центр–восток двумя цепочками.
        ('relay_west', {'owner': 'swarm', 'location': 'w_link', 'units': RELAY_ESCORT}),
        ('relay_gate', {'owner': 'swarm', 'location': 'c_gate', 'units': RELAY_ESCORT}),
        ('relay_north', {'owner': 'swarm', 'location': 'c_north',
                         'units': [{'unit': 'swarm_relay', 'count': 1},
                                   {'unit': 'frigate', 'count': 1}]}),
    ])),
])
open('data/maps/pve-5.json', 'w', encoding='utf-8').write(
    json.dumps(m, indent=2, ensure_ascii=False) + '\n')
print('провинций:', sum(1 for s in sectors.values() if s['kind'] not in ('rift', 'black_hole')))
