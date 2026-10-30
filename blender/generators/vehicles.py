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

from lib.common import box, export_glb, hull, material, render_thumbnail, reset_scene, shade_flat

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
    "taxi": dict(length=4.5, width=1.9, body_h=0.62, clearance=0.32, cabin_len=2.2, cabin_off=0.2,
                 cabin_h=0.58, taper=0.32, wheelbase=2.75, wheel_r=0.34, taxi_sign=True),
    # Cab up front (-Y), open bed behind it.
    "pickup": dict(length=4.9, width=2.0, body_h=0.7, clearance=0.42, cabin_len=1.7, cabin_off=-0.75,
                   cabin_h=0.7, taper=0.18, wheelbase=3.0, wheel_r=0.4, bed=True),
    "police_suv": dict(length=4.9, width=2.0, body_h=0.85, clearance=0.42, cabin_len=2.9, cabin_off=0.25,
                       cabin_h=0.66, taper=0.14, wheelbase=2.9, wheel_r=0.4, lightbar=True, police_livery=True),
    # Long bonnet, short fastback cabin set well back, bonnet scoop and a ducktail.
    "muscle": dict(length=4.8, width=1.95, body_h=0.55, clearance=0.28, cabin_len=1.7, cabin_off=0.55,
                   cabin_h=0.48, taper=0.4, wheelbase=2.85, wheel_r=0.36, scoop=True, spoiler=True),
    "limo": dict(length=6.8, width=1.95, body_h=0.6, clearance=0.3, cabin_len=4.3, cabin_off=0.3,
                 cabin_h=0.56, taper=0.12, wheelbase=4.6, wheel_r=0.34, chrome=True),
}

# Cab-over-body vehicles: built by build_truck(); wheels list axle Y positions (front first).
TRUCKS = {
    "bus": dict(length=12.0, width=2.55, height=3.0, clearance=0.35, wheel_r=0.5, axles=(-3.9, 3.6), kind="bus"),
    "ambulance": dict(length=6.0, width=2.15, height=2.75, clearance=0.4, wheel_r=0.42, axles=(-1.95, 1.75),
                      cab_len=1.9, cab_h=1.3, kind="box", lightbar=True, stripe="amb_red"),
    "firetruck": dict(length=9.2, width=2.5, height=3.0, clearance=0.45, wheel_r=0.52, axles=(-3.0, 2.0, 3.35),
                      cab_len=2.6, cab_h=1.4, kind="fire", lightbar=True),
    # Armoured van: short cab, slab-sided body with slit windows, push bar, roof bar. Paint it dark at spawn.
    "swat": dict(length=6.0, width=2.2, height=2.65, clearance=0.42, wheel_r=0.44, axles=(-2.0, 1.85),
                 cab_len=1.7, cab_h=1.25, kind="swat", lightbar=True),
    "garbage_truck": dict(length=8.6, width=2.5, height=3.2, clearance=0.45, wheel_r=0.52,
                          axles=(-2.85, 2.0, 3.35), cab_len=2.3, cab_h=1.35, kind="garbage"),
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
    if p.get("police_livery"):
        paint = mats["trim"]
        parts.append(box(f"{arch}_doors", (W + 0.02, p["cabin_len"] * 0.75, p["body_h"] * 0.55),
                         (0, p["cabin_off"], z_body + p["body_h"] * 0.5), mats["trim"]))
        parts.append(box(f"{arch}_pushbar", (W * 0.7, 0.12, p["body_h"] * 0.7),
                         (0, -L / 2 - 0.07, z_body + p["body_h"] * 0.4), mats["trim"]))
    if p.get("scoop"):
        parts.append(box(f"{arch}_scoop", (0.55, 0.9, 0.1), (0, -L / 2 + 1.1, body_top + 0.05), mats["trim"]))
    if p.get("spoiler"):
        parts.append(box(f"{arch}_spoiler", (W * 0.92, 0.25, 0.08), (0, L / 2 - 0.15, body_top + 0.04), mats["paint"]))
    if p.get("chrome"):
        for x in (-1, 1):
            parts.append(box(f"{arch}_chrome_{'L' if x > 0 else 'R'}", (0.02, L * 0.8, 0.05),
                             (x * (W / 2 + 0.005), 0, z_body + p["body_h"] * 0.55), mats["chrome"]))
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

    if p.get("taxi_sign"):
        roof_z = body_top + p["cabin_h"] + 0.14
        parts.append(box(f"{arch}_sign", (0.7, 0.22, 0.2), (0, p["cabin_off"], roof_z), mats["headlight"]))

    if p.get("bed"):
        # Low walls and tailgate around the load bed, behind the cab.
        bed_front = p["cabin_off"] + p["cabin_len"] / 2
        bed_len = L / 2 - bed_front
        bed_mid = bed_front + bed_len / 2
        wall_h = 0.3
        for x in (-1, 1):
            parts.append(box(f"{arch}_bedwall_{'L' if x > 0 else 'R'}", (0.08, bed_len, wall_h),
                             (x * (W / 2 - 0.04), bed_mid, body_top + wall_h / 2), mats["paint"]))
        parts.append(box(f"{arch}_tailgate", (W, 0.08, wall_h), (0, L / 2 - 0.04, body_top + wall_h / 2), mats["paint"]))
        parts.append(box(f"{arch}_bedfloor", (W - 0.16, bed_len - 0.1, 0.02), (0, bed_mid, body_top + 0.01), mats["trim"]))

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


def lights(arch, W, L, z, mats, size=(0.38, 0.06, 0.14)):
    parts = []
    for x in (-W * 0.36, W * 0.36):
        side = "L" if x > 0 else "R"
        parts.append(box(f"{arch}_head_{side}", size, (x, -L / 2 - 0.01, z), mats["headlight"]))
        parts.append(box(f"{arch}_tail_{side}", size, (x, L / 2 + 0.01, z), mats["taillight"]))
    return parts


def axle_wheels(arch, W, axles, r, mats, width=0.32):
    """Wheels per axle: the first axle is FL/FR (steers), the rest RL/RR, RL2/RR2, ..."""
    parts = []
    for i, y in enumerate(axles):
        tags = ("FL", "FR") if i == 0 else ((f"RL{i}", f"RR{i}") if i > 1 else ("RL", "RR"))
        for tag, x in zip(tags, (1, -1)):
            parts.append(wheel(f"{arch}_wheel_{tag}", r, width, (x * (W / 2 - width / 2 + 0.06), y, r), mats["tyre"]))
    return parts


def lightbar(arch, y, z, mats, width=1.2):
    return [
        box(f"{arch}_bar_red", (width / 2 - 0.02, 0.28, 0.13), (-width / 4, y, z), mats["siren_red"]),
        box(f"{arch}_bar_blue", (width / 2 - 0.02, 0.28, 0.13), (width / 4, y, z), mats["siren_blue"]),
    ]


def cab(arch, p, mats):
    """Truck cab at the front: tall body, near-vertical windscreen, flat roof."""
    W, L = p["width"], p["length"]
    z0, cab_len, cab_h = p["clearance"], p["cab_len"], p["cab_h"]
    y = -L / 2 + cab_len / 2
    glass_h = cab_h * 0.55
    parts = [
        box(f"{arch}_cab", (W, cab_len, cab_h), (0, y, z0 + cab_h / 2), mats["paint"], bevel=0.05),
        box(f"{arch}_cabtop", (W, cab_len - 0.3, glass_h), (0, y + 0.15, z0 + cab_h + glass_h / 2), mats["paint"],
            bevel=0.04),
        box(f"{arch}_windscreen", (W - 0.2, 0.06, glass_h * 0.8), (0, -L / 2 + 0.14, z0 + cab_h + glass_h * 0.45),
            mats["glass"]),
        box(f"{arch}_grille", (W * 0.5, 0.05, cab_h * 0.4), (0, -L / 2 - 0.01, z0 + cab_h * 0.35), mats["trim"]),
        box(f"{arch}_bumper", (W + 0.04, 0.16, 0.22), (0, -L / 2 - 0.04, z0 + 0.1), mats["trim"]),
    ]
    for x in (-1, 1):
        parts.append(box(f"{arch}_sidewin_{'L' if x > 0 else 'R'}", (0.04, cab_len * 0.55, glass_h * 0.75),
                         (x * (W / 2 + 0.005), y, z0 + cab_h + glass_h * 0.45), mats["glass"]))
    return parts, z0 + cab_h + glass_h


def build_truck(arch, p, mats):
    root = bpy.data.objects.new(arch, None)
    bpy.context.scene.collection.objects.link(root)
    W, L, H, z0 = p["width"], p["length"], p["height"], p["clearance"]
    parts = []
    kind = p["kind"]

    if kind == "bus":
        body_h = H - z0
        parts.append(box(f"{arch}_body", (W, L, body_h), (0, 0, z0 + body_h / 2), mats["paint"], bevel=0.08))
        parts.append(box(f"{arch}_roof", (W - 0.3, L - 1.2, 0.12), (0, 0.3, H + 0.06), mats["trim"]))
        # Window band down both sides and a big windscreen; door glass on the kerb side (+X is left).
        band_z = z0 + body_h * 0.68
        for x in (-1, 1):
            parts.append(box(f"{arch}_windows_{'L' if x > 0 else 'R'}", (0.04, L - 1.4, body_h * 0.36),
                             (x * (W / 2 + 0.005), 0.2, band_z), mats["glass"]))
        parts.append(box(f"{arch}_windscreen", (W - 0.2, 0.05, body_h * 0.5), (0, -L / 2 - 0.01, z0 + body_h * 0.6),
                         mats["glass"]))
        parts.append(box(f"{arch}_door", (0.04, 1.1, body_h * 0.8), (-(W / 2 + 0.01), -L / 2 + 1.6,
                                                                       z0 + body_h * 0.45), mats["glass"]))
        parts.append(box(f"{arch}_sign", (W * 0.7, 0.05, 0.25), (0, -L / 2 - 0.02, H - 0.2), mats["sign"]))
        parts.append(box(f"{arch}_bumper", (W + 0.04, 0.16, 0.25), (0, -L / 2 - 0.05, z0 + 0.12), mats["trim"]))
        parts.append(box(f"{arch}_ac", (1.6, 2.4, 0.3), (0, 2.5, H + 0.25), mats["trim"]))
        parts += lights(arch, W, L, z0 + 0.45, mats)
    else:
        cab_parts, cab_top = cab(arch, p, mats)
        parts += cab_parts
        body_front = -L / 2 + p["cab_len"] + 0.12
        body_len = L / 2 - body_front
        body_mid = body_front + body_len / 2
        body_h = H - z0
        if kind == "box":  # ambulance module
            parts.append(box(f"{arch}_module", (W, body_len, body_h), (0, body_mid, z0 + body_h / 2),
                             mats["paint"], bevel=0.06))
            for x in (-1, 1):
                parts.append(box(f"{arch}_stripe_{'L' if x > 0 else 'R'}", (0.03, body_len + 0.02, 0.28),
                                 (x * (W / 2 + 0.01), body_mid, z0 + body_h * 0.45), mats[p["stripe"]]))
            parts.append(box(f"{arch}_cross_a", (0.9, 0.3, 0.02), (0, body_mid, H + 0.01), mats[p["stripe"]]))
            parts.append(box(f"{arch}_cross_b", (0.3, 0.9, 0.02), (0, body_mid, H + 0.01), mats[p["stripe"]]))
            parts.append(box(f"{arch}_rearwin", (0.8, 0.04, 0.5), (0, L / 2 + 0.01, z0 + body_h * 0.7), mats["glass"]))
            for x in (-1, 1):  # corner flashers on the module
                parts.append(box(f"{arch}_flash_{'L' if x > 0 else 'R'}", (0.2, 0.12, 0.1),
                                 (x * (W / 2 - 0.15), L / 2 - 0.1, H + 0.05),
                                 mats["siren_blue" if x > 0 else "siren_red"]))
        elif kind == "fire":
            locker_h = body_h * 0.62
            parts.append(box(f"{arch}_body", (W, body_len, locker_h), (0, body_mid, z0 + locker_h / 2), mats["paint"],
                             bevel=0.05))
            for x in (-1, 1):  # roller-shutter lockers
                for i in range(3):
                    parts.append(box(f"{arch}_locker_{'L' if x > 0 else 'R'}{i}", (0.03, body_len / 3 - 0.15,
                                                                                   locker_h * 0.7),
                                     (x * (W / 2 + 0.01), body_front + body_len * (i + 0.5) / 3, z0 + locker_h * 0.5),
                                     mats["chrome"]))
            # Ladder on the roof, from over the cab to past the back.
            deck_z = z0 + locker_h
            ladder_len = L - 1.0
            for x in (-0.45, 0.45):
                parts.append(box(f"{arch}_ladder_rail{x:+.1f}", (0.08, ladder_len, 0.12),
                                 (x, 0.4, deck_z + 0.5), mats["chrome"]))
            for i in range(9):
                parts.append(box(f"{arch}_ladder_rung{i}", (0.9, 0.05, 0.05),
                                 (0, 0.4 - ladder_len / 2 + (i + 0.5) * ladder_len / 9, deck_z + 0.5), mats["chrome"]))
            parts.append(box(f"{arch}_ladder_base", (1.0, 1.2, 0.4), (0, L / 2 - 1.2, deck_z + 0.2), mats["trim"]))
        elif kind == "swat":
            parts.append(hull(f"{arch}_body", [(x * W / 2, y, z) for x in (-1, 1)
                                                for (y, z) in ((body_front, z0), (L / 2, z0), (body_front, H - 0.05),
                                                               (L / 2, H - 0.05))]
                              + [(x * (W / 2 - 0.12), y, H) for x in (-1, 1) for y in (body_front + 0.1, L / 2 - 0.1)],
                              mats["paint"]))
            for x in (-1, 1):
                side = "L" if x > 0 else "R"
                for i in range(2):  # slit windows
                    parts.append(box(f"{arch}_slit_{side}{i}", (0.03, 0.9, 0.16),
                                     (x * (W / 2 + 0.005), body_front + 0.7 + i * 1.5, z0 + body_h * 0.72), mats["glass"]))
                parts.append(box(f"{arch}_step_{side}", (0.18, body_len - 0.4, 0.06),
                                 (x * (W / 2 + 0.06), body_mid, z0 + 0.05), mats["trim"]))
            parts.append(box(f"{arch}_rack", (W - 0.5, body_len - 0.6, 0.06), (0, body_mid, H + 0.12), mats["trim"]))
            for y in (body_front + 0.4, L / 2 - 0.4):
                parts.append(box(f"{arch}_rackleg{y:+.1f}", (W - 0.5, 0.06, 0.12), (0, y, H + 0.04), mats["trim"]))
            parts.append(box(f"{arch}_reardoors", (W - 0.3, 0.04, body_h * 0.8), (0, L / 2 + 0.01, z0 + body_h * 0.45),
                             mats["trim"]))
            # Push bar on the nose.
            parts.append(box(f"{arch}_pushbar", (W * 0.75, 0.1, 0.55), (0, -L / 2 - 0.2, z0 + 0.45), mats["trim"]))
            for x in (-0.55, 0.55):
                parts.append(box(f"{arch}_pushpost{x:+.1f}", (0.08, 0.25, 0.08), (x, -L / 2 - 0.08, z0 + 0.45),
                                 mats["trim"]))
        elif kind == "garbage":
            parts.append(hull(f"{arch}_body", [(-W / 2, body_front, z0 + 0.2), (W / 2, body_front, z0 + 0.2),
                                                (-W / 2, body_front, H), (W / 2, body_front, H),
                                                (-W / 2, L / 2 - 1.2, z0 + 0.2), (W / 2, L / 2 - 1.2, z0 + 0.2),
                                                (-W / 2, L / 2 - 1.2, H - 0.1), (W / 2, L / 2 - 1.2, H - 0.1)],
                              mats["paint"]))
            # Rear hopper: slanted tailgate with a dark mouth.
            parts.append(hull(f"{arch}_hopper", [(-W / 2 + 0.05, L / 2 - 1.2, z0 + 0.3), (W / 2 - 0.05, L / 2 - 1.2, z0 + 0.3),
                                                  (-W / 2 + 0.05, L / 2 - 1.2, H - 0.1), (W / 2 - 0.05, L / 2 - 1.2, H - 0.1),
                                                  (-W / 2 + 0.05, L / 2, z0 + 0.3), (W / 2 - 0.05, L / 2, z0 + 0.3),
                                                  (-W / 2 + 0.05, L / 2 - 0.3, H - 0.4), (W / 2 - 0.05, L / 2 - 0.3, H - 0.4)],
                              mats["trim"]))
            parts.append(box(f"{arch}_mouth", (W - 0.4, 0.05, 0.7), (0, L / 2 + 0.01, z0 + 0.75), mats["dark"]))
            for x in (-1, 1):
                parts.append(box(f"{arch}_stripe_{'L' if x > 0 else 'R'}", (0.03, body_len - 1.3, 0.2),
                                 (x * (W / 2 + 0.01), body_front + (body_len - 1.2) / 2, z0 + 0.5), mats["hazard"]))
            parts.append(box(f"{arch}_beacon", (0.25, 0.25, 0.15), (0, -L / 2 + p["cab_len"] - 0.4, cab_top + 0.08),
                             mats["amber"]))
        if p.get("lightbar"):
            parts += lightbar(arch, -L / 2 + p["cab_len"] / 2, cab_top + 0.08, mats, width=min(W - 0.3, 1.6))
        parts += lights(arch, W, L, z0 + 0.5, mats)

    parts += axle_wheels(arch, W, p["axles"], p["wheel_r"], mats)
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
        # Fixed colours (not tinted): liveries and fittings.
        "chrome": material("chrome", (190, 194, 200), 0.25),
        "sign": material("sign", (255, 170, 40), 0.4),
        "amb_red": material("amb_red", (210, 30, 30), 0.5),
        "hazard": material("hazard", (240, 196, 30), 0.6),
        "amber": material("amber", (245, 150, 20), 0.3),
        "dark": material("dark", (12, 12, 14), 0.9),
    }
    objects = []
    for i, (arch, params) in enumerate(ARCHETYPES.items()):
        root, parts = build_vehicle(arch, params, mats)
        objects += [root, *parts]
        root.location.x = i * 3.0  # side by side in the .blend / thumbnail; the game re-centres
    for j, (arch, params) in enumerate(TRUCKS.items()):
        root, parts = build_truck(arch, params, mats)
        objects += [root, *parts]
        root.location.x = (len(ARCHETYPES) + j * 1.2) * 3.0

    export_glb(out_dir / "vehicles.glb", objects)
    if thumbs:
        render_thumbnail(THUMBS / "vehicles.png", target_height=6)
