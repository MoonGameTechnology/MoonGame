#!/usr/bin/env python3
"""Shattered Crown: fixed, irregular 3v3 mosaic with independent inhabitants.

The 3v3 sibling of `generate-team-2v2.py` (Broken Reach): the same area templates,
pairing and rarity rules on a wider map with three districts a side.

Coordinates are authored once; the game derives lanes from the power diagram and
terrain budgets. No mirrored quadrants, hand-written lanes or runtime generation.
Regenerate from the repository root, then run teamMap3v3.test.ts against the real core.

AREAS (`docs/map-terrain-regions-concept.md` §5.3–5.5). Every sampled province falls
into a named area, and inside the area core → shell → edge follows the distance to the
area's anchor, so terrain forms coherent bodies instead of one terrain per rectangle.
All six area templates are used, and every province kind, terrain and world
type of the catalogue appears — except `empty`, which the owner keeps off combat
maps (2026-09-22), and the fork fortress, which only a player builds. Areas that give a side something to own come in
PAIRS turned 180° about the centre (team A's home districts map onto team B's under
that turn); areas that hold a single prize sit on the x = 0 axis, the same distance
from both teams. The province grid itself stays an irregular sample, so the four
start districts still differ in shape.

Wrecks are a rare find (owner, 2026-10-14): the wreck area holds ONE graveyard and ONE
debris field beside it; the rest of the area is plain open space with dead worlds.
"""
import collections
import json
import math
import os
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sectors, players, fleets, slots = {}, {}, {}, {}


def add(sid, x, y, kind, terrain='empty_space', **extra):
    sectors[sid] = dict(position=dict(x=x, y=y), kind=kind, terrain=terrain, **extra)


# Team A holds the west, team B the east; B's districts are A's turned 180°, nudged.
homes = [(-2150, -1150), (-2450, 20), (-2120, 1170), (2180, 1130), (2420, -10), (2130, -1180)]
angles = [(20, 110), (-50, 50), (-20, -110), (200, 290), (130, 230), (160, 250)]
for i, ((x, y), angles) in enumerate(zip(homes, angles), 1):
    slot = f'slot_{i}'
    slots[slot] = dict(team='A' if i <= 3 else 'B', spawn='fixed', resources=dict(credits=300, metal=300))
    add(f'home_{i}', x, y, 'planet', planetType='terran', owner=slot,
        buildings=[dict(type='mine'), dict(type='shipyard', level=2)],
        garrison=[dict(unit='militia', count=3)])
    fleets[f'fleet_{i}'] = dict(owner=slot, location=f'home_{i}', units=[dict(unit='scout', count=1)])
    # Every district opens with the same pair of worlds: a temperate one and an ocean.
    for j, (angle, world) in enumerate(zip(angles, ('terran', 'oceanic')), 1):
        a = math.radians(angle)
        add(f'opening_{i}_{j}', round(x + 270 * math.cos(a)), round(y + 270 * math.sin(a)),
            'planet', planetType=world, garrison=[dict(unit='militia', count=2)])

factions = json.loads((ROOT / 'data/factions.json').read_text())
for sid, x, y, npc, name in [
    ('pirate_north', 620, -1650, 'pirate', 'Crown Corsairs'),
    ('pirate_south', -600, 1700, 'pirate', 'Shard Corsairs'),
    ('hive_north', -720, -1560, 'swarm', 'Ember Brood'),
    ('hive_south', 700, 1590, 'swarm', 'Hollow Brood'),
    ('neutral_west', -1100, 30, 'neutral', 'Western Lighthouse'),
    ('neutral_east', 1110, -40, 'neutral', 'Eastern Exchange'),
    ('neutral_north', -40, -2350, 'neutral', 'Northern Abbey'),
    ('neutral_south', 60, 2360, 'neutral', 'Southern Arsenal'),
]:
    pid = 'npc-' + sid
    faction = 'pirates' if npc == 'pirate' else 'swarm' if npc == 'swarm' else 'violet'
    kit = factions[faction]['startingLoadout']
    resources = dict(credits=500, metal=500, food=200, energy=200, microelectronics=100)
    if npc == 'swarm':
        resources['biomass'] = 240
        buildings = kit['homeBuildings'] + ['shipyard', 'power_plant']
        units = kit['fleet']
        guard = kit['garrison']
    else:
        buildings = ['shipyard', 'radar', 'power_plant', 'fabricator']
        units = factions['pirates']['startingLoadout']['fleet'] if npc == 'pirate' else [dict(unit='cruiser', count=3), dict(unit='scout', count=1)]
        guard = factions['pirates']['startingLoadout']['garrison'] if npc == 'pirate' else [dict(unit='heavy_infantry', count=3)]
    players[pid] = dict(name=name, faction=faction, resources=resources, ai=True, npc=npc)
    add(sid, x, y, 'planet' if npc == 'swarm' else 'pirate_base' if npc == 'pirate' else 'neutral_base',
        planetType='barren' if npc == 'swarm' else 'terran', owner=pid,
        buildings=[dict(type=b, level=2 if b == 'shipyard' else 1) for b in buildings], garrison=guard)
    fleets[pid + '-fleet'] = dict(owner=pid, location=sid, units=units,
        landing=[dict(unit='swarm_lander', count=3)] if npc == 'swarm' else [])

# The old remnant lies off-centre; the traffic can pass on either side.
# The relic world and the old station sit on the axis, equally far from both teams.
add('remnant', 60, 40, 'black_hole', 'deep_void')
add('relic', -20, -520, 'planet', 'deep_void', planetType='relic_world', garrison=[dict(unit='militia', count=2)])
add('crossing', 30, 600, 'void_station', 'deep_void')
FIXED = list(sectors)

# A fixed Poisson sample supplies varied cell sizes and degrees. Each accepted point
# brings its twin turned 180° about the centre, nudged a little: the two teams get the
# same amount of space at the same distances, but no district is a copy of another.
# SEED picks the sample; 58 gives the closest team balance (see teamMap.test.ts).
rng = random.Random(int(os.environ.get('SEED', 58)))
cells = []


def fits(x, y, taken):
    if (x / 3350) ** 2 + (y / 2900) ** 2 > 1:
        return False
    if any(math.hypot(x - px, y - py) < 355 for px, py in taken):
        return False
    return not any(math.hypot(x - hx, y - hy) < 480 for hx, hy in homes)


TOTAL = 121
for attempt in range(20000):
    if len(sectors) + len(cells) == TOTAL:
        break
    x, y = rng.randrange(-3200, 3201), rng.randrange(-2700, 2701)
    twin = (-x + rng.randrange(-60, 61), -y + rng.randrange(-60, 61))
    taken = [(s['position']['x'], s['position']['y']) for s in sectors.values()] + cells
    if fits(x, y, taken) and fits(*twin, taken + [(x, y)]):
        cells += [(x, y), twin]
assert len(sectors) + len(cells) == TOTAL, 'bounded layout search exhausted'

# ── Areas: (centre, weight, core anchor). A cell joins the area with the smallest
# distance / weight; inside it, the ladder below is laid out from the anchor outwards.
REGIONS = collections.OrderedDict([
    ('western_expanse', ((-2400, 0), 1.0, [(-2500, 0)])),
    ('eastern_expanse', ((2400, 0), 1.0, [(2500, 0)])),
    ('ember_massif', ((-1500, -1900), 1.0, [(-1600, -2000)])),
    ('hollow_massif', ((1500, 1900), 1.0, [(1600, 2000)])),
    ('shard_nebula', ((-1500, 1900), 1.0, [(-1600, 2000)])),
    ('crown_nebula', ((1500, -1900), 1.0, [(1600, -2000)])),
    ('expedition_graveyard', ((0, -1950), 0.85, [(0, -2000)])),
    ('depleted_node', ((0, 1950), 0.85, [(0, 2000)])),
    ('storm_front', ((0, 0), 1.1, [(-300, 600), (300, -600)])),
])


def dist_to_anchor(p, anchor):
    if len(anchor) == 1:
        return math.dist(p, anchor[0])
    (ax, ay), (bx, by) = anchor
    vx, vy = bx - ax, by - ay
    t = max(0, min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / (vx * vx + vy * vy)))
    return math.dist(p, (ax + t * vx, ay + t * vy))


def area_of(p):
    return min(REGIONS, key=lambda name: math.dist(p, REGIONS[name][0]) / REGIONS[name][1])


members = collections.OrderedDict((name, []) for name in REGIONS)
for p in cells:
    members[area_of(p)].append(p)
for name, ps in members.items():
    ps.sort(key=lambda p: (dist_to_anchor(p, REGIONS[name][2]), p))

# Ladder per template: (cells, kind, terrain) from the core outwards; None = the rest.
MASSIF = [(1, 'dead_world', 'dust_lane'), (2, 'asteroid', 'dust_lane'), (None, 'asteroid', 'asteroid_field')]
NEBULA = [(2, 'dense_nebula', 'dense_nebula'), (3, 'nebula', 'nebula'),
          (None, ('dead_world', 'planet/terran'), 'empty_space')]
# The wide flanks would otherwise be a sea of dead worlds: their rim cycles through
# a dead world, a barren world and a loose asteroid group, in the same order on both
# sides (the twins sort alike), so the mix stays fair.
EXPANSE = [(3, 'dead_world', 'deep_void'), (None, ('dead_world', 'planet/barren', 'asteroid'), 'empty_space')]
LADDER = {
    'western_expanse': EXPANSE, 'eastern_expanse': EXPANSE,
    'ember_massif': MASSIF, 'hollow_massif': MASSIF,
    'shard_nebula': NEBULA, 'crown_nebula': NEBULA,
    # One graveyard and one debris field beside it; wrecks are rare, so the rim of the
    # area is plain open space rather than more debris (owner, 2026-10-14).
    'expedition_graveyard': [(1, 'graveyard', 'derelict_graveyard'),
                             (1, 'debris_field', 'derelict_graveyard'),
                             (None, 'dead_world', 'empty_space')],
    'depleted_node': [(2, 'dead_world', 'depleted_system'), (1, 'asteroid', 'depleted_system'),
                      (None, 'dead_world', 'deep_void')],
    'storm_front': [(4, 'ion_storm', 'ion_storm'), (3, 'solar_flare', 'solar_flare_zone'),
                    (None, ('dead_world', 'asteroid'), 'empty_space')],
}

ROLE, AREA, REGION_SECTORS = {}, {}, collections.OrderedDict((name, []) for name in REGIONS)
n = 0
for name, ps in members.items():
    i = 0
    steps = LADDER[name]
    for step, (count, kind, terrain) in enumerate(steps):
        take = ps[i:] if count is None else ps[i:i + count]
        role = 'edge' if step == len(steps) - 1 else 'core' if step == 0 else 'shell'
        for k, (x, y) in enumerate(take):
            i += 1
            n += 1
            sid = f'crown_{len(FIXED) + n:03}'
            this = kind[k % len(kind)] if isinstance(kind, tuple) else kind
            # A home borders exactly its two opening worlds: no extra world next door.
            if this.startswith('planet') and min(math.dist((x, y), h) for h in homes) < 650:
                this = 'dead_world'
            this, _, world = this.partition('/')
            add(sid, x, y, this, terrain, **({'planetType': world} if world else {}))
            ROLE[sid] = role
            AREA[sid] = name
# Fixed sectors are labelled with the area they stand in; their kind stays authored.
for sid in sectors:
    if sid not in AREA:
        AREA[sid] = area_of((sectors[sid]['position']['x'], sectors[sid]['position']['y']))
for sid in sectors:
    REGION_SECTORS[AREA[sid]].append(sid)

PLACED = set()


def place(area, x, y, role=None, **fields):
    """One authored object into the free province of `area` (and `role`) nearest (x, y)."""
    free = [s for s in REGION_SECTORS[area] if s in ROLE and s not in PLACED]
    ids = [s for s in free if role is None or ROLE[s] == role] or free
    sid = min(ids, key=lambda s: math.dist((sectors[s]['position']['x'], sectors[s]['position']['y']), (x, y)))
    PLACED.add(sid)
    sectors[sid].update(fields)
    return sid


def pair(area_a, area_b, x, y, role=None, **fields):
    """The same object for both teams: at (x, y) in `area_a` and turned 180° in `area_b`."""
    place(area_a, x, y, role, **fields)
    place(area_b, -x, -y, role, **fields)


# Massifs: a crystalline dead world in the dust heart (§5.4), a dense pocket with metal
# on the rim (one approach) and a gas giant in the open field.
for area in ('ember_massif', 'hollow_massif'):
    heart = next(s for s in REGION_SECTORS[area] if ROLE.get(s) == 'core')
    sectors[heart]['planetType'] = 'crystalline'
    PLACED.add(heart)
pair('ember_massif', 'hollow_massif', -2350, -1850, 'edge', kind='asteroid_cluster', terrain='asteroid_cluster')
pair('ember_massif', 'hollow_massif', -1100, -2250, 'edge', kind='planet', planetType='gas_giant')
# Nebulae: an energy nexus in the dense core, a volcanic world on the clear rim.
for area in ('shard_nebula', 'crown_nebula'):
    nexus = next(s for s in REGION_SECTORS[area] if ROLE.get(s) == 'core')
    sectors[nexus]['planetType'] = 'energy_nexus'
    PLACED.add(nexus)
pair('shard_nebula', 'crown_nebula', -1100, 1200, 'edge', kind='planet', planetType='volcanic')
# Storm front: an irradiated world under the flares on each side of the black hole.
pair('storm_front', 'storm_front', -700, 550, kind='planet', terrain='solar_flare_zone',
     planetType='irradiated')
# Open expanses: a fortress world guarding the flank and a rift sealing the far edge
# behind the middle home (impassable, carries no lanes).
pair('western_expanse', 'eastern_expanse', -1600, -500, kind='planet', planetType='fortress_world')
pair('western_expanse', 'eastern_expanse', -3150, -500, kind='rift', terrain='empty_space')
# Axis prizes, equally far from both teams: the expedition's last camp in the
# graveyard, the ringworld and the spent mines of the depleted node.
place('expedition_graveyard', 0, -1600, 'edge', kind='planet', planetType='oceanic')
place('depleted_node', 0, 1600, 'edge', kind='planet', planetType='ringworld')
spent = [s for s in REGION_SECTORS['depleted_node'] if ROLE.get(s) == 'core']
sectors[spent[0]].update(kind='planet', planetType='barren')
sectors[spent[1]].update(planetType='dead_world')
PLACED.update(spent)

content = dict(id='team-3v3', seed='shattered-crown-20261014', sectors=sectors,
    regions=[dict(id=name, sectors=ids) for name, ids in REGION_SECTORS.items()],
    players=players, slots=slots, fleets=fleets,
    pricing=json.loads((ROOT / 'data/maps/duel-1.json').read_text())['pricing'],
    techRules=dict(ruleset='main', starting=['scout_design'], dayGates=True, exclude=[]))
(ROOT / 'data/maps/team-3v3.json').write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n')
print('provinces:', len(sectors), {name: len(ids) for name, ids in REGION_SECTORS.items()})
if '--roles' in __import__('sys').argv:
    for sid, s in sectors.items():
        print(f"  {sid:14} {AREA[sid]:20} {ROLE.get(sid, '-'):5} {s['kind']:16} {s['terrain']:18} "
              f"{s.get('planetType', ''):14} ({s['position']['x']},{s['position']['y']})")
