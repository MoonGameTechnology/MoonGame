"""Вторая глава Сектора Зеро — «Кладбище экспедиции».

ПРАВИЛО ВЛАДЕЛЬЦА (22 сентября), под которое карта переделана целиком:

    «Развилка — это место, где расходятся дороги… Развилки не создают отдельную
    провинцию. И перекрёстки тоже не обязательно должны создавать провинцию.»

Поэтому здесь НЕТ ни одной клетки вида `empty`. Прежняя раскладка держала семь таких:
перекрёстки решётки, которые нельзя присвоить и которые существовали только чтобы через
них летали. Теперь каждая провинция — МЕСТО: мир, поле, обломки, туманность. Развилка
получается сама — там, где сходятся границы трёх соседей, а не там, где автор положил
пустую клетку.

Второе правило владельца: «чтоб не было похоже на соты, всё равно разные формы
используй». Форму здесь дают только КООРДИНАТЫ: они не выстроены в ряды и не держат
общего шага. `size` намеренно не задан — на этом масштабе он почти ничего не решает:
размеры 0.7–1.4 сдвигали границы в среднем на 4 единицы при длине границ 100–800
(замер по `mosaicBorders`), то есть разные «веса» не дают разных по величине областей.

СЮЖЕТ (решение владельца): первая карта — самый край Сектора Зеро, дальше главы ведут к
первой планете, где ставил опыты учёный. Вторая глава — первый шаг внутрь: здесь уже
видны следы экспедиции (раскоп, разбитые корабли) и Рой, который тут осел.
"""
import json, collections

# Провинции: id → (x, y, вид, местность, владелец, гарнизон, постройки).
# Координаты расставлены вручную и нарочно неровно — ни рядов, ни общего шага.
P = collections.OrderedDict([
    # СЕВЕРО-ЗАПАД — сюда входит игрок, это ещё край сектора.
    ('landing',   (-600, -460, 'planet', 'empty_space', 'p1',
                   [{'unit': 'militia', 'count': 2}],
                   [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}, {'type': 'radar'}])),
    ('rim_veil',  (-280, -560, 'nebula', 'nebula', None, [], [])),
    ('cold_shoal',(-680, -120, 'asteroid', 'asteroid_field', None, [], [])),

    # СЕВЕР — след экспедиции: раскоп и разбитый караван.
    ('dig_site',  (-120, -260, 'dead_world', 'depleted_system', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 3}], [])),
    ('wreck_spine',(200, -430, 'graveyard', 'derelict_graveyard', 'swarm', [], [])),
    ('flare_belt', (520, -380, 'solar_flare', 'solar_flare_zone', None, [], [])),

    # ВОСТОК — астероидный массив лестницей: поле → пылевая полоса → скопление.
    ('rockfield', (700, -120, 'asteroid', 'asteroid_field', None, [], [])),
    ('dust_reach',(760, 160, 'asteroid', 'dust_lane', None, [], [])),
    ('ore_knot',  (960, 500, 'asteroid_cluster', 'asteroid_cluster', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 3}], [])),
    ('ion_wall',  (640, 330, 'ion_storm', 'ion_storm', None, [], [])),

    # ЦЕНТР — большая туманность и хвост обломков.
    ('hollow',    (-40, 40, 'nebula', 'nebula', None, [], [])),
    ('wreck_tail',(420, 100, 'graveyard', 'derelict_graveyard', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 2}], [])),

    # ЗАПАД — выработанный мир и плотная вуаль.
    ('deep_drift',(-560, 220, 'dead_world', 'deep_void', None, [], [])),
    ('veil_deep', (-300, 400, 'dense_nebula', 'dense_nebula', None, [], [])),

    # ЮГ — Рой.
    ('biopit',    (-60, 520, 'planet', 'empty_space', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 4}],
                   [{'type': 'biomass_pit'}, {'type': 'shipyard', 'level': 2}, {'type': 'fort'}])),
    ('brood_yard',(280, 560, 'planet', 'empty_space', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 4}],
                   [{'type': 'swarm_synapse'}, {'type': 'shipyard', 'level': 2},
                    {'type': 'orbital_aa'}])),
    ('nest',      (600, 700, 'planet', 'empty_space', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 6}],
                   [{'type': 'swarm_hive'}, {'type': 'biomass_pit'},
                    {'type': 'shipyard', 'level': 2}, {'type': 'barracks'},
                    {'type': 'fort'}, {'type': 'orbital_aa'}])),
    ('salvage_pocket',(-480, 660, 'graveyard', 'derelict_graveyard', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 2}], [])),
    ('bone_drift',(100, 860, 'graveyard', 'derelict_graveyard', 'swarm', [], [])),
])

# ДОРОГИ ВНУТРИ ПРОВИНЦИИ (M2.5). Раскоп — единственный узел, где две трассы идут
# СКВОЗЬ и не сходятся: северная (край → центр) и западная (шельф → выработанный мир).
# Это и есть «две параллельные дороги через провинцию», а не перекрёсток.
TRANSIT = {'dig_site': [['rim_veil', 'wreck_spine'], ['cold_shoal', 'hollow']]}

# ЗАДАЧИ ЗАБЕГА — три разных ГЛАГОЛА: взять, снести, пройти.
OBJECTIVES = [
    collections.OrderedDict([('id', 'mission.salvage'), ('kind', 'control'),
                             ('targets', ['wreck_spine', 'wreck_tail', 'salvage_pocket',
                                          'bone_drift']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.raze-biomass'), ('kind', 'raze'),
                             ('targets', ['biomass_pit']), ('reward', 3)]),
    collections.OrderedDict([('id', 'mission.recon'), ('kind', 'scout'),
                             ('count', 11), ('reward', 2)]),
]

# МАСШТАБ — это баланс, а не вид. Время в пути решает, как скоро волна Роя дойдёт до дома,
# поэтому длины маршрутов держатся у прежней карты этой главы: от миров Роя до причала
# было 842 / 1092 / 1365. Координаты выше расставлены крупнее ради удобства правки, и
# без этого множителя те же маршруты вышли бы в полтора раза длиннее. Размеров (`size`)
# у провинций нет, поэтому мозаика от масштаба не зависит: сжатие меняет длины, но не
# соседство.
SCALE = 0.67

sectors = collections.OrderedDict()
for sid, (x, y, kind, terrain, owner, garr, blds) in P.items():
    x, y = round(x * SCALE), round(y * SCALE)
    sec = collections.OrderedDict([('position', {'x': x, 'y': y}), ('kind', kind),
                                   ('terrain', terrain)])
    if owner:
        sec['owner'] = owner
    if blds:
        sec['buildings'] = blds
    if garr:
        sec['garrison'] = garr
    if sid in TRANSIT:
        sec['transit'] = TRANSIT[sid]
    sectors[sid] = sec

m = collections.OrderedDict([
    ('id', 'pve-2'), ('seed', 'pve-2'), ('time', 0), ('mode', 'pve_waves'),
    ('sectors', sectors),
    ('objectives', OBJECTIVES),
    ('players', collections.OrderedDict([
        ('p1', {'name': 'Azure Compact', 'faction': 'vanguard',
                'resources': {'credits': 400, 'metal': 400}}),
        ('swarm', {'name': 'Swarm Collective', 'faction': 'swarm', 'ai': True,
                   'resources': {'credits': 800, 'metal': 800, 'biomass': 300,
                                 'microelectronics': 80}}),
    ])),
    ('fleets', collections.OrderedDict([
        ('p1_1', {'owner': 'p1', 'location': 'landing',
                  'landing': [{'unit': 'militia', 'count': 1}],
                  'units': [{'unit': 'cruiser', 'count': 2},
                            {'unit': 'scout_drone', 'count': 1}]}),
        ('swarm_1', {'owner': 'swarm', 'location': 'nest',
                     'units': [{'unit': 'swarm_brood_mother', 'count': 2}]}),
        ('swarm_2', {'owner': 'swarm', 'location': 'biopit',
                     'units': [{'unit': 'swarm_brood_mother', 'count': 1}]}),
    ])),
])
open('/home/user/MoonGame/data/maps/pve-2.json', 'w', encoding='utf-8').write(
    json.dumps(m, indent=2, ensure_ascii=False) + '\n')
print('провинций:', len(sectors))
