"""Police helicopter: heli.glb.

Root `heli` (origin at ground centre under the skids, nose toward Blender -Y =
game +Z, ~12 m long) with the airframe parts plus two spinning nodes:
  heli_rotor_main  origin at the hub, spin about local Y (glTF up)
  heli_rotor_tail  origin at the hub, spin about local X (the disc is upright)
Both have identity rotation, so local axes match the root's. Mostly seen
from directly above, so the silhouette and rotor disc carry it: four long
blades, white tail boom, a dark-blue cabin with a white roof stripe.

Materials: `searchlight` (nose lamp: glow it and aim the pool from it),
`siren_red` / `siren_blue` (belly strobes), `glass`; everything else is a
fixed colour. <= 1,500 tris.
"""
from pathlib import Path

import bpy

from lib.common import box, cylinder, export_glb, group, hull, material, reset_scene, rotate

HUB_Z = 3.15  # main rotor hub height
TAIL_HUB = (0.32, 7.35, 2.35)  # tail rotor hub (left side of the fin, +X)


def join(name, objs):
    """Merge objs into one mesh object called `name`; its origin stays where the first one's was."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    return obj


def set_origin(obj, point):
    """Move obj's origin to `point` (world) without moving its geometry."""
    from mathutils import Matrix, Vector

    bpy.context.view_layer.update()
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.transform(Matrix.Translation(-Vector(point)))
    obj.location = point


def build(out_dir: Path, thumbs: bool = False):
    reset_scene()
    m = {
        "blue": material("heli_blue", (24, 40, 86), 0.5),
        "white": material("heli_white", (232, 234, 238), 0.5),
        "glass": material("glass", (32, 42, 56), 0.15),
        "dark": material("trim", (24, 26, 30), 0.6),
        "rotor": material("rotor", (40, 42, 46), 0.6),
        "searchlight": material("searchlight", (255, 248, 220), 0.3),
        "siren_red": material("siren_red", (230, 30, 30), 0.3),
        "siren_blue": material("siren_blue", (30, 80, 240), 0.3),
    }

    # Cabin pod: a rounded hull, nose low and forward.
    pod = hull("heli_pod", [
        (x * w, y, z)
        for (y, w, z0, z1) in ((-2.6, 0.45, 1.0, 1.7), (-1.9, 0.85, 0.75, 2.35), (-0.6, 1.0, 0.7, 2.55),
                               (0.9, 0.95, 0.75, 2.5), (1.9, 0.6, 1.1, 2.3))
        for x in (-1, 1) for z in (z0, z1)
    ], m["blue"])
    canopy = hull("heli_canopy", [
        (x * w, y, z)
        for (y, w, z0, z1) in ((-2.72, 0.38, 1.25, 1.65), (-2.0, 0.83, 1.3, 2.28), (-1.2, 0.95, 1.4, 2.45))
        for x in (-1, 1) for z in (z0, z1)
    ], m["glass"])
    parts = [
        pod, canopy,
        box("heli_roofstripe", (0.9, 2.6, 0.06), (0, 0.15, 2.57), m["white"]),
        box("heli_engine", (1.1, 2.0, 0.55), (0, 0.9, 2.75), m["white"], bevel=0.08),
        cylinder("heli_mast", 0.12, 0.45, (0, 0.2, HUB_Z - 0.2), m["dark"], verts=6),
        # Tail boom, tapering back to the fin.
        cylinder("heli_boom", 0.42, 5.4, (0, 4.6, 2.05), m["white"], verts=8, radius2=0.18, rotation=(-90, 0, 0)),
        hull("heli_fin", [(0, 6.9, 2.0), (0, 7.7, 2.0), (0, 7.75, 3.35), (0, 7.45, 3.4), (0.06, 7.3, 2.2),
                          (-0.06, 7.3, 2.2)], m["blue"]),
        box("heli_stabiliser", (2.0, 0.5, 0.06), (0, 6.6, 2.15), m["blue"]),
        box("heli_ventral", (0.06, 0.6, 0.5), (0, 7.4, 1.75), m["blue"]),
        # Skids and struts.
        cylinder("heli_searchlight", 0.17, 0.22, (0, -2.25, 0.85), m["searchlight"], verts=8),
        box("heli_strobe_red", (0.15, 0.15, 0.08), (0, 1.0, 0.68), m["siren_red"]),
        box("heli_strobe_blue", (0.15, 0.15, 0.08), (0, -1.0, 0.68), m["siren_blue"]),
    ]
    for x in (-1, 1):
        parts.append(cylinder(f"heli_skid{x:+d}", 0.06, 3.4, (x * 1.1, -0.2, 0.08), m["dark"], verts=6,
                              rotation=(90, 0, 0)))
        for y in (-1.1, 0.8):
            parts.append(rotate(box(f"heli_strut{x:+d}{y:+.0f}", (0.08, 0.1, 0.75), (x * 0.95, y, 0.45), m["dark"]),
                                (0, -x * 18, 0), pivot=(x * 1.1, y, 0.08)))
        parts.append(box(f"heli_door{x:+d}", (0.03, 1.1, 0.9), (x * 0.99, -0.3, 1.65), m["glass"]))

    # Main rotor: four blades + hub, joined into one node at the hub.
    blades = [cylinder("heli_rotor_hub", 0.28, 0.2, (0, 0.2, HUB_Z), m["dark"], verts=8)]
    for i in range(4):
        blade = box(f"heli_blade{i}", (0.32, 5.4, 0.05), (0, 0.2 - 2.75, HUB_Z + 0.06), m["rotor"])
        rotate(blade, (0, 0, 45 + 90 * i), pivot=(0, 0.2, HUB_Z))
        blades.append(blade)
    rotor_main = join("heli_rotor_main", blades)
    set_origin(rotor_main, (0, 0.2, HUB_Z))

    # Tail rotor: two blades in the YZ plane, spinning about X.
    tail = [cylinder("heli_tail_hub", 0.1, 0.14, TAIL_HUB, m["dark"], verts=6, rotation=(0, 90, 0))]
    for i in range(2):
        b = box(f"heli_tblade{i}", (0.04, 0.16, 1.5), (TAIL_HUB[0] + 0.05, TAIL_HUB[1], TAIL_HUB[2]), m["rotor"])
        rotate(b, (90 * i + 20, 0, 0), pivot=TAIL_HUB)
        tail.append(b)
    rotor_tail = join("heli_rotor_tail", tail)
    set_origin(rotor_tail, TAIL_HUB)

    root = group("heli", parts + [rotor_main, rotor_tail])
    export_glb(out_dir / "heli.glb", [root, *parts, rotor_main, rotor_tail])
