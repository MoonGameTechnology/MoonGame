"""Author the frozen Frontier 50 content; never run during game startup.

Run from the repository root with Python, NumPy and SciPy installed.
The committed JSON is the runtime input; graph invariants live in mapCatalog.test.ts.
"""
import json
from pathlib import Path

import numpy as np
from scipy.spatial import Voronoi
from scipy.sparse import lil_matrix
from scipy.sparse.csgraph import shortest_path


rng = np.random.default_rng(414)
points, ghosts = [[0.0, 0.0]], []
for y in range(-4, 42):
    for x in range(-4, 46):
        px = (x + (0.5 if y % 2 else 0) + rng.uniform(-0.32, 0.32) - 18.3) / 18.3
        py = (y + rng.uniform(-0.32, 0.32) - 16.3) / 16.3
        angle = np.arctan2(py, px)
        edge = 0.95 + 0.05 * np.sin(3 * angle) + 0.06 * np.cos(5 * angle)
        if px * px + py * py < 0.016:
            continue
        (points if px * px + py * py < edge * edge else ghosts).append([px, py])

p = np.array(points)
n = len(p)
assert n == 831 and n <= 1675 / 2
vor = Voronoi(points + ghosts)
graph = lil_matrix((n, n), dtype=np.int8)
boundary, hole_neighbors, edges = set(), set(), set()
for a, b in vor.ridge_points:
    if a == 0 and b < n:
        hole_neighbors.add(int(b))
    if b == 0 and a < n:
        hole_neighbors.add(int(a))
    if 0 < a < n and 0 < b < n:
        graph[a, b] = graph[b, a] = 1
        edges.add(tuple(sorted((int(a), int(b)))))
    elif a < n <= b:
        boundary.add(int(a))
    elif b < n <= a:
        boundary.add(int(b))

distance = shortest_path(graph.tocsr(), directed=False, unweighted=True)
assert np.isfinite(distance[1:, 1:]).all()
rim_distance = distance[:, sorted(boundary)].min(axis=1)
conflict = distance < 3
rng = np.random.default_rng(16)
available = rim_distance >= 3
available[0] = False
candidates = []
while np.any(available):
    cost = conflict[:, available].sum(axis=1) + rng.random(n) * 2
    cost[~available] = 1e6
    chosen = int(np.argmin(cost))
    candidates.append(chosen)
    available[conflict[chosen]] = False
assert len(candidates) >= 50
# Spread the selected starts throughout the compact galaxy.
starts = [min(candidates, key=lambda k: np.sum(p[k] ** 2))]
while len(starts) < 50:
    remaining = [i for i in candidates if i not in starts]
    starts.append(max(remaining, key=lambda k: min(np.sum((p[k] - p[s]) ** 2) for s in starts)))
starts.sort(key=lambda i: (p[i, 1], p[i, 0]))

bases = []
eligible = [i for i in range(1, n) if rim_distance[i] >= 1
            and min(distance[i, starts]) >= 2 and i not in hole_neighbors]
while len(bases) < 12:
    eligible = [i for i in eligible if all(distance[i, b] >= 3 for b in bases)]
    assert eligible
    target = rng.uniform(-0.75, 0.75, 2)
    bases.append(min(eligible, key=lambda i: np.sum((p[i] - target) ** 2)))
bases.sort(key=lambda i: (p[i, 0], p[i, 1]))
kinds = ['nebula', 'asteroid', 'graveyard', 'ion_storm', 'planet']
terrain = [kinds[int(rng.integers(len(kinds)))] for _ in range(n)]
terrain[0] = 'black_hole'
for i in starts:
    terrain[i] = 'planet'
for i in bases[::2]:
    terrain[i] = 'pirate_base'
for i in bases[1::2]:
    terrain[i] = 'neutral_base'

content = dict(points=np.round(p, 5).tolist(), edges=sorted(edges), starts=starts,
               boundary=sorted(boundary), terrain=terrain)
destination = Path(__file__).resolve().parents[1] / 'data/frontier-50.json'
destination.write_text(json.dumps(content, separators=(',', ':')) + '\n')
print(json.dumps(dict(provinces=n, starts=len(starts), lanes=len(edges), bases=len(bases))))
