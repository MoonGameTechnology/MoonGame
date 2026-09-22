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
#
# Координаты сначала расставлены вручную по областям, потом доведены локальным поиском
# под требования главы (`data/pveSecondMission.test.ts`) — поэтому числа «неровные»:
#   * узлов, где сходятся пять дорог и больше, не меньше четырёх, и все они — миры;
#   * у большинства провинций три подхода и больше («сетка, а не коридор»);
#   * тупик только там, где его требует местность (скопление — один подход);
#   * средний перелёт короче 300 — главу просили без длинных путей;
#   * МАСШТАБ — баланс, а не вид: маршруты от миров Роя до причала держатся у прежней
#     карты главы (842 / 1092 / 1365 ± 8%), иначе волны шли бы к дому дольше или быстрее;
#   * двойной путь через раскоп цел, валидатор чист.
# Двигая провинцию руками, перемерь всё перечисленное: соседство выводится из мозаики, и
# любая правка координат может молча его поменять.
P = collections.OrderedDict([
    # СЕВЕРО-ЗАПАД — сюда входит игрок, это ещё край сектора.
    ('landing',   (-437, -415, 'planet', 'empty_space', 'p1',
                   [{'unit': 'militia', 'count': 2}],
                   [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}, {'type': 'radar'}])),
    ('rim_veil',  (-397, -600, 'nebula', 'nebula', None, [], [])),
    ('cold_shoal',(-218, -145, 'asteroid', 'asteroid_field', None, [], [])),

    # СЕВЕР — след экспедиции: раскоп и разбитый караван.
    ('dig_site',  (-139, -358, 'dead_world', 'depleted_system', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 3}], [])),
    ('wreck_spine',(111, -338, 'graveyard', 'derelict_graveyard', 'swarm', [], [])),
    ('flare_belt', (300, -317, 'solar_flare', 'solar_flare_zone', None, [], [])),

    # ВОСТОК — астероидный массив лестницей: поле → пылевая полоса → скопление.
    ('rockfield', (303, 3, 'asteroid', 'asteroid_field', None, [], [])),
    ('dust_reach',(649, 191, 'asteroid', 'dust_lane', None, [], [])),
    ('ore_knot',  (755, 354, 'asteroid_cluster', 'asteroid_cluster', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 3}], [])),
    ('ion_wall',  (458, 257, 'ion_storm', 'ion_storm', None, [], [])),

    # ЦЕНТР — большая туманность и хвост обломков.
    ('hollow',    (-43, -103, 'nebula', 'nebula', None, [], [])),
    ('wreck_tail',(128, 94, 'graveyard', 'derelict_graveyard', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 2}], [])),

    # МЕСТА-УЗЛЫ. Перекрёстки на этой карте есть и должны быть (раннее указание владельца:
    # «побольше провинций, перекрёстков и двойных путей»), но перекрёсток — это МИР, где
    # сходятся дороги, а не пустая клетка ради развилки. Поэтому узлы — лагерь экспедиции,
    # ретранслятор Роя, луна в дрейфе: места со своим смыслом и просторной местностью.
    ('camp',      (139, -88, 'dead_world', 'depleted_system', 'swarm', [], [])),
    ('relay',     (176, 293, 'planet', 'empty_space', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 2}],
                   [{'type': 'shipyard', 'level': 2}, {'type': 'orbital_aa'}])),
    ('drift_moon',(-251, 198, 'dead_world', 'deep_void', None, [], [])),
    ('spore_cloud',(-231, 26, 'nebula', 'nebula', 'swarm', [], [])),
    ('scree',     (576, -209, 'asteroid', 'asteroid_field', None, [], [])),

    # ЗАПАД — выработанный мир и плотная вуаль.
    ('deep_drift',(-417, 3, 'dead_world', 'deep_void', None, [], [])),
    ('veil_deep', (-21, 203, 'dense_nebula', 'dense_nebula', None, [], [])),

    # ЮГ — Рой.
    ('biopit',    (-217, 413, 'planet', 'empty_space', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 4}],
                   [{'type': 'biomass_pit'}, {'type': 'shipyard', 'level': 2}, {'type': 'fort'}])),
    ('brood_yard',(16, 413, 'planet', 'empty_space', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 4}],
                   [{'type': 'swarm_synapse'}, {'type': 'shipyard', 'level': 2},
                    {'type': 'orbital_aa'}])),
    ('nest',      (304, 439, 'planet', 'empty_space', 'swarm',
                   [{'unit': 'swarm_lander', 'count': 6}],
                   [{'type': 'swarm_hive'}, {'type': 'biomass_pit'},
                    {'type': 'shipyard', 'level': 2}, {'type': 'barracks'},
                    {'type': 'fort'}, {'type': 'orbital_aa'}])),
    ('salvage_pocket',(-689, 565, 'graveyard', 'derelict_graveyard', 'swarm',
                      [{'unit': 'swarm_lander', 'count': 2}], [])),
    ('bone_drift',(213, 735, 'graveyard', 'derelict_graveyard', 'swarm', [], [])),
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
                             ('count', 14), ('reward', 2)]),
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
