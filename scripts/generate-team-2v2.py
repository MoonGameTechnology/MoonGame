#!/usr/bin/env python3
"""Broken Reach: fixed, irregular 2v2 mosaic with independent inhabitants.

Coordinates are authored once; the game derives lanes from the power diagram and
terrain budgets. No mirrored quadrants, hand-written lanes or runtime generation.
Regenerate from the repository root, then run teamMap.test.ts against the real core.
"""
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sectors, players, fleets, slots = {}, {}, {}, {}


def add(sid, x, y, kind, terrain='empty_space', **extra):
    sectors[sid] = dict(position=dict(x=x, y=y), kind=kind, terrain=terrain, **extra)


homes = [(-1740, -730), (-1800, 670), (1760, -680), (1830, 780)]
for i, ((x, y), angles) in enumerate(zip(homes, [(12, 112), (-24, -122), (165, 260), (190, 290)]), 1):
    slot = f'slot_{i}'
    slots[slot] = dict(team='A' if i <= 2 else 'B', spawn='fixed', resources=dict(credits=300, metal=300))
    add(f'home_{i}', x, y, 'planet', planetType='terran', owner=slot,
        buildings=[dict(type='mine_t1'), dict(type='shipyard', level=2)],
        garrison=[dict(unit='militia', count=3)])
    fleets[f'fleet_{i}'] = dict(owner=slot, location=f'home_{i}', units=[dict(unit='scout', count=1)])
    for j, angle in enumerate(angles, 1):
        a = math.radians(angle)
        add(f'opening_{i}_{j}', round(x + 270 * math.cos(a)), round(y + 270 * math.sin(a)),
            'planet', planetType='terran', garrison=[dict(unit='militia', count=2)])

factions = json.loads((ROOT / 'data/factions.json').read_text())
for sid, x, y, npc, name in [
    ('pirate_north', 480, -1240, 'pirate', 'Veil Corsairs'),
    ('pirate_south', -560, 1320, 'pirate', 'Wreck Corsairs'),
    ('hive_north', -580, -1150, 'swarm', 'Ash Brood'),
    ('hive_south', 650, 1180, 'swarm', 'Iron Brood'),
    ('neutral_west', -820, 40, 'neutral', 'Western Observatory'),
    ('neutral_east', 830, -60, 'neutral', 'Eastern Anchorage'),
    ('neutral_north', -40, -1840, 'neutral', 'Northern Commune'),
    ('neutral_south', 120, 1860, 'neutral', 'Southern Freehold'),
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
add('remnant', 70, 130, 'black_hole', 'deep_void')
add('relic', -210, -270, 'planet', 'deep_void', planetType='relic_world', garrison=[dict(unit='militia', count=2)])
add('crossing', 160, -540, 'void_station', 'deep_void')

# A fixed Poisson sample supplies varied cell sizes and degrees. Terrain follows
# coherent physical areas, not independent rolls for each province.
rng = random.Random(20261014)
for attempt in range(12000):
    if len(sectors) == 85:
        break
    x, y = rng.randrange(-2600, 2601), rng.randrange(-2160, 2161)
    if (x / 2730) ** 2 + (y / 2390) ** 2 > 1:
        continue
    if any(math.hypot(x - s['position']['x'], y - s['position']['y']) < 355 for s in sectors.values()):
        continue
    if any(math.hypot(x - hx, y - hy) < 480 for hx, hy in homes):
        continue
    if x < -650 and y < -350:
        kind, terrain = 'asteroid', 'asteroid_field'
    elif x > 220 and y < -700:
        kind, terrain = 'nebula', 'nebula'
        if math.hypot(x - 870, y + 1350) < 400:
            kind, terrain = 'dense_nebula', 'dense_nebula'
    elif x < -180 and y > 800:
        kind, terrain = 'graveyard', 'derelict_graveyard'
    elif x > 480 and y > 780:
        kind, terrain = 'dead_world', 'deep_void'
    elif -180 < x < 720 and -600 < y < 800:
        kind, terrain = 'ion_storm', 'ion_storm'
    else:
        kind, terrain = 'asteroid', 'empty_space'
    add(f'reach_{len(sectors) + 1:02}', x, y, kind, terrain)
assert len(sectors) == 85, 'bounded layout search exhausted'

content = dict(id='team-2v2', seed='broken-reach-20261014', sectors=sectors,
    players=players, slots=slots, fleets=fleets,
    techRules=dict(ruleset='main', starting=['scout_design'], dayGates=True, exclude=[]))
(ROOT / 'data/maps/team-2v2.json').write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n')
