"""Car-part chunks thrown out of explosions: debris.glb.

One root per chunk (`door`, `hood`, `bumper`, `wheel`, `panel_a/b/c`), origin
at the chunk's centre so it can tumble about it, <= 80 tris each. Materials
are the car contract's `paint` / `trim` / `tyre`, so the effects code can tint
`paint` with the exploding car's colour.
"""
import random
from pathlib import Path

from lib.common import box, cylinder, export_glb, group, hull, material, reset_scene, rotate


def mats():
    return {
        "paint": material("paint", (235, 235, 235), 0.45),
        "trim": material("trim", (24, 26, 30), 0.6),
        "tyre": material("tyre", (22, 22, 22), 0.95),
    }


def bent_panel(name, w, h, bend, mat, thick=0.04, seed=0):
    """A sheet w x h, folded `bend` degrees along its middle and a bit crumpled."""
    rnd = random.Random(seed)
    half = [(-w / 2, 0), (0, 0), (w / 2, 0)]
    pts = []
    for i, (x, _) in enumerate(half):
        dz = (abs(i - 1)) * w / 2 * (bend / 90) * 0.6
        for y in (-h / 2, h / 2):
            jitter = rnd.uniform(-0.03, 0.03)
            pts.append((x, y, dz + jitter))
            pts.append((x, y, dz + jitter + thick))
    # Two hulls (left and right of the fold) so the fold stays concave.
    left = hull(f"{name}_l", [p for p in pts if p[0] <= 0], mat)
    right = hull(f"{name}_r", [p for p in pts if p[0] >= 0], mat)
    return [left, right]


def door(m):
    parts = bent_panel("door_skin", 1.0, 0.7, 20, m["paint"], seed=1)
    parts.append(box("door_window_frame", (0.9, 0.04, 0.05), (0, 0.36, 0.05), m["trim"]))
    parts.append(box("door_handle", (0.14, 0.03, 0.03), (0.25, -0.1, 0.07), m["trim"]))
    return parts


def hood(m):
    return bent_panel("hood_skin", 1.4, 1.1, 35, m["paint"], thick=0.05, seed=2)


def bumper(m):
    b = box("bumper_bar", (1.6, 0.16, 0.18), (0, 0, 0), m["trim"])
    rotate(b, (0, 0, 14), pivot=(0.8, 0, 0))
    return [b, box("bumper_plate", (0.4, 0.02, 0.12), (-0.2, -0.09, 0), m["paint"])]


def wheel(m):
    return [
        cylinder("wheel_tyre", 0.34, 0.24, (0, 0, 0), m["tyre"], verts=10, rotation=(0, 90, 0)),
        cylinder("wheel_hub", 0.18, 0.26, (0, 0, 0), m["trim"], verts=6, rotation=(0, 90, 0)),
    ]


def outline(pts):
    """Convex outline (x, y) of a point set, counter-clockwise (gift wrapping; a handful of points)."""
    start = min(pts)
    out, p = [], start
    while True:
        out.append(p)
        q = pts[0] if pts[0] != p else pts[1]
        for r in pts:
            cross = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
            if cross < 0:
                q = r
        p = q
        if p == start:
            return out


def panel(name, seed, lip=0.1, tilt=0.9):
    """A torn sheet of body panel and, along its longest torn edge, a `trim` lip folded up:
    the flange round a wheel arch or door shut, so it tumbles with some shape (and the dark
    trim against the paint still reads at night)."""
    def make(m):
        rnd = random.Random(seed)
        pts, flat = [], []
        for _ in range(7):
            x, y = rnd.uniform(-0.35, 0.35), rnd.uniform(-0.3, 0.3)
            z = rnd.uniform(-0.08, 0.08)
            pts += [(x, y, z), (x, y, z + 0.03)]
            flat.append((x, y, z))
        ring = outline([(x, y) for x, y, _ in flat])
        z_at = {(x, y): z for x, y, z in flat}
        edges = [(ring[i], ring[(i + 1) % len(ring)]) for i in range(len(ring))]
        a, b = max(edges, key=lambda e: (e[1][0] - e[0][0]) ** 2 + (e[1][1] - e[0][1]) ** 2)
        # Outward in the plane (the ring is counter-clockwise, so outward is to the right of a -> b).
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = (dx * dx + dy * dy) ** 0.5
        ox, oy = dy / n, -dx / n
        flange = []
        for (x, y) in (a, b):
            z = z_at[(x, y)]
            for t in (0.0, 0.025):  # the lip's thickness, inward from the edge
                flange += [(x - ox * t, y - oy * t, z), (x - ox * t, y - oy * t, z + 0.035),
                           (x + ox * lip * tilt - ox * t, y + oy * lip * tilt - oy * t, z + 0.035 + lip)]
        return [hull(f"{name}_skin", pts, m["paint"]), hull(f"{name}_lip", flange, m["trim"])]

    return make


CHUNKS = {"door": door, "hood": hood, "bumper": bumper, "wheel": wheel,
          "panel_a": panel("panel_a", 11), "panel_b": panel("panel_b", 12), "panel_c": panel("panel_c", 13)}


def build(out_dir: Path, thumbs: bool = False):
    reset_scene()
    m = mats()
    objects = []
    for i, (name, make) in enumerate(CHUNKS.items()):
        parts = make(m)
        objects += [group(name, parts, location=(i * 2.0, 0, 0)), *parts]
    export_glb(out_dir / "debris.glb", objects)
