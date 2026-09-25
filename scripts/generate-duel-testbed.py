"""Тестовая дуэльная карта — «Колыбель у мёртвой звезды» (`data/maps/duel-testbed.json`).

ЗАЧЕМ. Заказ владельца 2026-09-25: карта 1×1 на 55–60 провинций, на которой есть ВСЕ
области и ВСЕ виды провинций, хаотично по областям и без зеркала. На ней проверяют
настоящий сетевой матч 1×1 (слой под Cloudflare делает команда) и вырабатывают взгляд
на мапдизайн. Это ВИТРИНА, а не рейтинговая карта: честность сторон не держится
(резолюция владельца), в пул AvA она не входит (`avaEligible` не стоит).

ПОЛНОТА. Каталог выложен целиком: 16 видов (`sectorKinds`), 11 сред (`sectors`), 12 типов
миров (`planetTypes`). Вид `empty` стоит ТОЛЬКО здесь — две «точки съёмки», где можно
развернуть станцию (`station.deploy` требует такую клетку). На боевых картах его нет
(решение владельца 2026-09-22, M2.10); исключение для тестовой карты — резолюция
владельца 2026-09-25. Полноту держит `data/duelTestbed.test.ts`: новая запись в каталоге
без места на этой карте роняет тест.

СЦЕНА — один участок рукава Галактики (`docs/map-terrain-regions-concept.md` §5.6).
Области выросли из трёх процессов, а не набраны по списку:
  • гравитация собирает — ПОЯС у старой звезды (дом A) и МОЛЕКУЛЯРНОЕ ОБЛАКО (дом B);
  • энергия выдувает — ПУЗЫРЬ СВЕРХНОВОЙ в центре (чёрная дыра, шрамы ударной волны —
    разломы, выметенная полость — `deep_void`) и ФРОНТ ИОНИЗАЦИИ, где молодые горячие
    звёзды выжигают край облака (ионные штормы и вспышки);
  • время исчерпывает — ВЫРАБОТАННЫЙ УЗЕЛ на юге.
Рукотворное одно — КЛАДБИЩЕ ЭКСПЕДИЦИИ: она шла к чёрной дыре и не дошла; её точка
съёмки (`empty`) осталась на краю. ОТКРЫТЫЙ ПРОСТОР связывает области между собой.

Область — служебная разметка этого скрипта, а НЕ игровая сущность (§1 концепции): в
данные она не попадает, правила её не знают.

Соседство выводится из мозаики (M4.3): двигая провинцию, перемерь тест — любая правка
координат может молча поменять проходы.
"""
import json, collections, math, sys

P = collections.OrderedDict()
REGION = {}  # служебная разметка для рисунка автора (`--regions <файл>`), в карту не идёт
_region = ''


def region(name):
    global _region
    _region = name


def add(sid, x, y, kind, terrain, ptype=None, **extra):
    P[sid] = dict(x=x, y=y, kind=kind, terrain=terrain, ptype=ptype, extra=extra)
    REGION[sid] = _region


region('belt')
# ── ПОЯС (запад): старая спокойная звезда с поясом. Гравитация собирает. ──────────────
# Дом стоит в центре системы; звезда — не провинция. Кольцо пояса из плотных сред
# (поле, пылевые полосы) разорвано двумя резонансными щелями (щели Кирквуда) — это
# открытый космос, через них из системы и выходят. Сердце массива — кристаллический
# мир в пылевой полосе («объект в сердце», §5.4).
SA = (-1300, 250)


def orbit(r, deg):
    a = math.radians(deg)
    return round(SA[0] + r * math.cos(a)), round(SA[1] + r * math.sin(a))


add('home_a', *SA, 'planet', 'empty_space', 'terran', owner='slot_a')
add('belt_n', *orbit(330, -100), 'asteroid', 'asteroid_field')
# Северо-восточная щель выметена начисто — глубокая пустота на 6 проходов: из неё выходят
# к троянцам, в простор и к кладбищу экспедиции.
add('gap_ne', *orbit(330, -40), 'asteroid', 'deep_void')
add('belt_e', *orbit(330, 20), 'asteroid', 'asteroid_field')
add('crystal', *orbit(330, 80), 'dead_world', 'dust_lane', 'crystalline')
add('belt_sw', *orbit(330, 140), 'asteroid', 'dust_lane')
add('gap_w', *orbit(330, 200), 'asteroid', 'empty_space')
add('twin_a', -1700, -200, 'planet', 'empty_space', 'oceanic')
add('outer_belt', -1720, 700, 'asteroid', 'asteroid_field')
# Газовый гигант на внешней орбите, его вулканическая луна (приливный нагрев, как у Ио)
# и два троянских кармана в ±60° на ТОЙ ЖЕ орбите — богатые тупики `asteroid_cluster`.
gx, gy = orbit(640, 20)
add('giant', gx, gy, 'planet', 'empty_space', 'gas_giant')
add('io_moon', gx + 140, gy + 200, 'planet', 'empty_space', 'volcanic')
add('trojan_l4', *orbit(640, -40), 'asteroid_cluster', 'asteroid_cluster')
add('trojan_l5', *orbit(640, 80), 'asteroid_cluster', 'asteroid_cluster')

region('wreck')
# ── КЛАДБИЩЕ ЭКСПЕДИЦИИ (северо-запад): рукотворное, единственное не природное. ───────
add('wreck_1', -700, -620, 'graveyard', 'derelict_graveyard')
add('wreck_2', -400, -840, 'graveyard', 'derelict_graveyard')
add('debris_1', -1000, -470, 'debris_field', 'empty_space')
add('debris_2', -300, -560, 'debris_field', 'empty_space')
add('last_camp', -760, -1000, 'planet', 'empty_space', 'fortress_world')
add('survey_1', -1150, -820, 'empty', 'empty_space')

region('bubble')
# ── ПУЗЫРЬ СВЕРХНОВОЙ (центр): звезда умерла, осталась чёрная дыра, взрыв вымел полость.
# Три разлома — шрамы ударной волны на оболочке пузыря, не сплошная стена: между ними
# проходы. Внутри быстро и голо (`deep_void`).
add('singularity', 150, -150, 'black_hole', 'deep_void')
add('relic', -130, -170, 'planet', 'deep_void', 'relic_world')
add('ring', 390, -400, 'planet', 'deep_void', 'ringworld')
add('station', 200, 170, 'void_station', 'deep_void')
add('observatory', 450, -50, 'neutral_base', 'deep_void', owner='neutrals')
add('survey_2', -110, 110, 'empty', 'deep_void')
add('scorched', 720, -300, 'planet', 'deep_void', 'irradiated')
add('scar_nw', -150, -440, 'rift', 'empty_space')
add('scar_s', -220, 520, 'rift', 'empty_space')
add('scar_e', 650, 90, 'rift', 'empty_space')

region('cloud')
# ── ОБЛАКО (северо-восток): молекулярное облако, колыбель звёзд. Плотное ядро →
# туманность → край (§5.3). В тёмной глобуле на краю прячутся пираты.
add('core_1', 900, -760, 'dense_nebula', 'dense_nebula', 'energy_nexus')
add('core_2', 1160, -560, 'dense_nebula', 'dense_nebula')
add('veil_w', 620, -700, 'nebula', 'nebula')
add('veil_n', 1150, -950, 'nebula', 'nebula')
add('veil_e', 1430, -720, 'nebula', 'nebula')
# Двойной путь: у южной вуали две развилки — вдоль ядра облака и по его кромке. Каждая
# трасса обходит мир по своей развилке, и сменить одну на другую на ходу нельзя.
add('veil_s', 900, -490, 'nebula', 'nebula',
    transit=[['core_1', 'core_2'], ['reach_e', 'scorched']])
add('globule', 1500, -1000, 'pirate_base', 'dense_nebula', owner='pirates')
add('home_b', 1360, -330, 'planet', 'empty_space', 'terran', owner='slot_b')
add('shore_b', 1640, -60, 'planet', 'empty_space', 'oceanic')
# Двойной путь (M2.5): в волокне туманности две чистые полосы — дом ↔ фронт и простор ↔
# берег. Они пересекают `wisp`, не встречаясь: свернуть с одной на другую на ходу нельзя.
add('wisp', 1120, -130, 'nebula', 'nebula',
    transit=[['home_b', 'flare_1'], ['reach_e', 'shore_b']])

region('storm')
# ── ФРОНТ ИОНИЗАЦИИ (юго-восток): молодые горячие звёзды выжигают край облака. Ионные
# штормы полосами, между ними вспышки — проходы быстрые, но в бою хрупкие.
add('storm_1', 880, 150, 'ion_storm', 'ion_storm')
add('flare_1', 1130, 220, 'solar_flare', 'solar_flare_zone')
# Шторм смотрит на берег дома B: два его прохода — к берегу и к короне.
add('storm_2', 1475, 213, 'ion_storm', 'ion_storm')
add('flare_2', 1620, 420, 'solar_flare', 'solar_flare_zone')
add('storm_3', 1000, 440, 'ion_storm', 'ion_storm')
add('hot_world', 1270, 620, 'planet', 'solar_flare_zone', 'irradiated')
add('scoured', 980, 900, 'dead_world', 'solar_flare_zone')
add('blaze', 1560, 760, 'planet', 'empty_space', 'volcanic')

region('spent')
# ── ВЫРАБОТАННЫЙ УЗЕЛ (юг): система, из которой всё вынули. Время исчерпывает. ────────
add('spent', -300, 700, 'planet', 'depleted_system', 'barren')
add('husk', -30, 850, 'dead_world', 'depleted_system', 'dead_world')
add('tailings', -560, 930, 'asteroid', 'depleted_system')
# Шлаковый мир на краю узла, куда дотянулся фронт вспышек: две тропы с развилками — объезды
# мимо планеты (предложение владельца 2026-09-25). По низу `husk` ↔ `scoured`, по верху
# `station` ↔ `reach_se`; трассы не встречаются (двойной путь).
add('cinder', 422, 382, 'dead_world', 'solar_flare_zone',
    transit=[['husk', 'scoured'], ['station', 'reach_se']])
add('old_colony', -560, 470, 'planet', 'depleted_system', 'terran')

region('open')
# ── ОТКРЫТЫЙ ПРОСТОР: соединительная ткань между областями. ───────────────────────────
add('reach_w', -560, 110, 'dead_world', 'empty_space')
add('reach_nw', -440, -300, 'planet', 'deep_void', 'barren')
add('reach_se', 511, 271, 'dead_world', 'deep_void')
add('reach_n', 100, -700, 'planet', 'empty_space', 'gas_giant')
add('reach_sw', -900, 820, 'asteroid', 'empty_space')
add('reach_e', 930, -200, 'dead_world', 'empty_space')

# Постройки и гарнизоны. Дома — тот же старт, что у `ava-duel-1`: рудник и верфь второго
# уровня (классы корпусов FORT-5.5 иначе отняли бы крейсер). Базы обитателей — с тем,
# что им разрешает каталог вида.
BUILDINGS = {
    'home_a': [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}],
    'home_b': [{'type': 'mine_t1'}, {'type': 'shipyard', 'level': 2}],
    'globule': [{'type': 'shipyard'}, {'type': 'radar'}],
    'observatory': [{'type': 'shipyard'}, {'type': 'radar'}, {'type': 'power_plant'}],
}
GARRISON = {
    'home_a': [{'unit': 'militia', 'count': 3}],
    'home_b': [{'unit': 'militia', 'count': 3}],
    'globule': [{'unit': 'militia', 'count': 2}],
    'observatory': [{'unit': 'militia', 'count': 2}],
}

sectors = collections.OrderedDict()
for sid, p in P.items():
    sec = collections.OrderedDict([('position', {'x': p['x'], 'y': p['y']}), ('kind', p['kind']),
                                   ('terrain', p['terrain'])])
    if p['ptype']:
        sec['planetType'] = p['ptype']
    sec.update(p['extra'])
    if sid in BUILDINGS:
        sec['buildings'] = BUILDINGS[sid]
    if sid in GARRISON:
        sec['garrison'] = GARRISON[sid]
    sectors[sid] = sec

m = collections.OrderedDict([
    ('id', 'duel-testbed'), ('seed', 'duel-testbed'), ('time', 0),
    ('sectors', sectors),
    ('players', collections.OrderedDict([
        ('pirates', {'name': 'Pirate Base', 'faction': 'vanguard', 'npc': 'pirate',
                     'resources': {'credits': 0, 'metal': 0}}),
        ('neutrals', {'name': 'Neutral AI Base', 'faction': 'vanguard', 'npc': 'neutral',
                      'resources': {'credits': 0, 'metal': 0}}),
    ])),
    ('slots', collections.OrderedDict([
        ('slot_a', {'team': 'A', 'spawn': 'fixed', 'resources': {'credits': 300, 'metal': 300}}),
        ('slot_b', {'team': 'B', 'spawn': 'fixed', 'resources': {'credits': 300, 'metal': 300}}),
    ])),
    ('fleets', collections.OrderedDict([
        ('fleet_a', {'owner': 'slot_a', 'location': 'home_a',
                     'units': [{'unit': 'cruiser', 'count': 2}]}),
        ('fleet_b', {'owner': 'slot_b', 'location': 'home_b',
                     'units': [{'unit': 'cruiser', 'count': 2}]}),
        ('pirate_patrol', {'owner': 'pirates', 'location': 'globule',
                           'units': [{'unit': 'frigate', 'count': 2}]}),
    ])),
])
open('data/maps/duel-testbed.json', 'w', encoding='utf-8').write(
    json.dumps(m, indent=2, ensure_ascii=False) + '\n')
if '--regions' in sys.argv:
    json.dump(REGION, open(sys.argv[sys.argv.index('--regions') + 1], 'w'))
print('провинций:', len(sectors))
