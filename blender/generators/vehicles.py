"""Parametric low-poly vehicles, one root per archetype in vehicles.glb.

Per archetype: a bevelled lower body, a tapered glass cabin with a paint roof
slab on top, four wheels (separate objects, origin at the hub, rotation
applied so the game can yaw front wheels freely) and light bars.

Material names are a contract with the game (src/render/vehicleModels.ts):
  "paint"      tinted per car at runtime
  "glass", "tyre", "headlight", "taillight", "trim", fixed colours
Wheel objects are named "<arch>_wheel_FL/FR/RL/RR".
"""
from pathlib import Path

import bmesh
import bpy

from lib.common import box, export_glb, material, render_thumbnail, reset_scene, shade_flat

THUMBS = Path(__file__).resolve().parents[1] / "thumbs"

# Dimensions in metres. Length runs along Blender Y (front = -Y).
ARCHETYPES = {
    "sedan": dict(length=4.4, width=1.9, body_h=0.62, clearance=0.32, cabin_len=2.2, cabin_off=0.2,
                  cabin_h=0.58, taper=0.32, wheelbase=2.7, wheel_r=0.34),
    "compact": dict(length=3.8, width=1.75, body_h=0.62, clearance=0.3, cabin_len=2.0, cabin_off=0.15,
                    cabin_h=0.62, taper=0.25, wheelbase=2.4, wheel_r=0.31),
    "sports": dict(length=4.4, width=1.95, body_h=0.48, clearance=0.24, cabin_len=1.6, cabin_off=0.35,
                   cabin_h=0.42, taper=0.45, wheelbase=2.6, wheel_r=0.34),
    "van": dict(length=4.8, width=2.0, body_h=0.95, clearance=0.38, cabin_len=3.6, cabin_off=-0.4,
                cabin_h=0.85, taper=0.12, wheelbase=3.0, wheel_r=0.38),
    "police": dict(length=4.5, width=1.9, body_h=0.62, clearance=0.32, cabin_len=2.2, cabin_off=0.2,
                   cabin_h=0.58, taper=0.32, wheelbase=2.75, wheel_r=0.34, lightbar=True),
}


def tapered_box(name, length, width, height, taper, z0, y_center, mat):
    """Box whose top face is inset by `taper` (fraction) front/back and a bit at the sides."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    hl, hw = length / 2, width / 2
    tl, tw = hl * (1 - taper), hw * (1 - taper * 0.35)
    bottom = [(-hw, -hl, 0), (hw, -hl, 0), (hw, hl, 0), (-hw, hl, 0)]
    top = [(-tw, -tl, height), (tw, -tl, height), (tw, tl, height), (-tw, tl, height)]
    vs = [bm.verts.new((x, y + y_center, z + z0)) for x, y, z in bottom + top]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([vs[i] for i in f])
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    shade_flat(obj)
    return obj, tl * 2, tw * 2


def wheel(name, radius, width, location, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius, depth=width, location=location,
                                        rotation=(0, 1.5707963, 0))
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(mat)
    shade_flat(obj)
    return obj


def build_vehicle(arch, p, mats):
    root = bpy.data.objects.new(arch, None)
    bpy.context.scene.collection.objects.link(root)
    parts = []

    L, W = p["length"], p["width"]
    z_body = p["clearance"]
    body_top = z_body + p["body_h"]
    paint = mats["trim"] if arch == "police" else mats["paint"]

    # Lower body; police get a white-door band via a second, slightly wider box.
    parts.append(box(f"{arch}_body", (W, L, p["body_h"]), (0, 0, z_body + p["body_h"] / 2), mats["paint"], bevel=0.06))
    if arch == "police":
        parts.append(box(f"{arch}_doors", (W + 0.02, L * 0.42, p["body_h"] * 0.7),
                         (0, -p["cabin_off"] * 0.5, z_body + p["body_h"] * 0.45), mats["trim"]))

    cabin, top_len, top_w = tapered_box(f"{arch}_cabin", p["cabin_len"], W * 0.9, p["cabin_h"], p["taper"],
                                        body_top, p["cabin_off"], mats["glass"])
    parts.append(cabin)
    parts.append(box(f"{arch}_roof", (top_w * 0.98, top_len * 0.98, 0.05),
                     (0, p["cabin_off"], body_top + p["cabin_h"] + 0.02), paint))

    # Lights: front is -Y.
    for x in (-W * 0.32, W * 0.32):
        parts.append(box(f"{arch}_head_{'L' if x > 0 else 'R'}", (0.38, 0.06, 0.14),
                         (x, -L / 2 - 0.01, z_body + p["body_h"] * 0.6), mats["headlight"]))
        parts.append(box(f"{arch}_tail_{'L' if x > 0 else 'R'}", (0.38, 0.06, 0.14),
                         (x, L / 2 + 0.01, z_body + p["body_h"] * 0.6), mats["taillight"]))

    if p.get("lightbar"):
        roof_z = body_top + p["cabin_h"] + 0.1
        parts.append(box(f"{arch}_bar_red", (0.5, 0.25, 0.12), (-0.28, p["cabin_off"], roof_z), mats["siren_red"]))
        parts.append(box(f"{arch}_bar_blue", (0.5, 0.25, 0.12), (0.28, p["cabin_off"], roof_z), mats["siren_blue"]))

    r = p["wheel_r"]
    for tag, x, y in (("FL", 1, -1), ("FR", -1, -1), ("RL", 1, 1), ("RR", -1, 1)):
        # Blender +X is the car's left when it faces -Y.
        parts.append(wheel(f"{arch}_wheel_{tag}", r, 0.26, (x * (W / 2 - 0.1), y * p["wheelbase"] / 2, r), mats["tyre"]))

    for obj in parts:
        obj.parent = root
    return root, parts


def build(out_dir: Path, thumbs: bool = False):
    reset_scene()
    mats = {
        "paint": material("paint", (235, 235, 235), 0.45),
        "glass": material("glass", (32, 42, 56), 0.15),
        "tyre": material("tyre", (22, 22, 22), 0.95),
        "headlight": material("headlight", (255, 244, 194), 0.3),
        "taillight": material("taillight", (220, 40, 30), 0.3),
        "trim": material("trim", (24, 26, 30), 0.6),
        "siren_red": material("siren_red", (230, 30, 30), 0.3),
        "siren_blue": material("siren_blue", (30, 80, 240), 0.3),
    }
    objects = []
    for i, (arch, params) in enumerate(ARCHETYPES.items()):
        root, parts = build_vehicle(arch, params, mats)
        objects += [root, *parts]
        root.location.x = i * 3.0  # side by side in the .blend / thumbnail; the game re-centres

    export_glb(out_dir / "vehicles.glb", objects)
    if thumbs:
        render_thumbnail(THUMBS / "vehicles.png", target_height=6)
