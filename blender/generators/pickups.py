"""Guns and pickups: weapons.glb and pickups.glb.

weapons.glb: `pistol`, `smg`, `shotgun`, `grenade`, `molotov`, `rocket_launcher` as loose models for the game to attach
at the hand. Origin at the grip (where the fist closes), barrel toward Blender
-Y (game +Z), up is up; `muzzle` (metres ahead of the grip, along the barrel)
is exported as a custom property on each root for muzzle flashes (0 for thrown
weapons, whose origin is the middle of the fist). `rocket` is the projectile
the game flies: origin at its centre, nose toward game +Z, <= 60 tris.

pickups.glb: things lying in the street, designed to read from above:
`crate_pistol` / `crate_smg` / `crate_shotgun` / `crate_grenade` /
`crate_molotov` / `crate_rocket` (the weapon on the lid and a coloured stripe
per weapon), `health_kit`, `armour`, `ammo_box`, `package` (hidden-package
collectible) and `cash`. Origin at ground centre. Budget <= 300 tris each.
"""
from pathlib import Path

from lib.common import box, cylinder, export_glb, group, hull, material, render_thumbnail, reset_scene, rotate

THUMBS = Path(__file__).resolve().parents[1] / "thumbs"

GUN_STRIPES = {"pistol": (240, 200, 40), "smg": (240, 120, 30), "shotgun": (210, 40, 40),
               "grenade": (80, 170, 60), "molotov": (150, 70, 200), "rocket_launcher": (235, 235, 235)}


def mats():
    m = {
        "gunmetal": material("gunmetal", (44, 46, 50), 0.4),
        "grip": material("grip", (70, 54, 40), 0.8),
        "steel": material("steel", (120, 124, 130), 0.3),
        "crate": material("crate", (130, 110, 70), 0.9),
        "crate_dark": material("crate_dark", (70, 60, 40), 0.9),
        "white": material("white", (236, 238, 240), 0.5),
        "red": material("red", (210, 30, 30), 0.5),
        "cardboard": material("cardboard", (176, 130, 80), 0.9),
        "tape": material("tape", (220, 200, 140), 0.6),
        "note": material("note", (110, 160, 100), 0.8),
        "band": material("band", (240, 230, 200), 0.6),
        "olive": material("olive", (86, 96, 56), 0.7),
        "bottle": material("bottle", (60, 120, 60), 0.2),
        "rag": material("rag", (220, 200, 160), 0.9),
        "warhead": material("warhead", (110, 116, 80), 0.5),
        "vest": material("vest", (34, 40, 56), 0.8),
        "ammo_band": material("ammo_band", (230, 190, 40), 0.6),
    }
    for gun, rgb in GUN_STRIPES.items():
        m[f"stripe_{gun}"] = material(f"stripe_{gun}", rgb, 0.5)
    return m


# ---------------------------------------------------------------- guns (origin at the grip)

def pistol(m, p="pistol"):
    return [
        box(f"{p}_slide", (0.035, 0.2, 0.04), (0, -0.07, 0.05), m["gunmetal"]),
        box(f"{p}_barrel", (0.02, 0.03, 0.02), (0, -0.18, 0.05), m["steel"]),
        rotate(box(f"{p}_grip", (0.03, 0.045, 0.11), (0, 0.0, -0.01), m["grip"]), (-15, 0, 0)),
        box(f"{p}_guard", (0.012, 0.05, 0.012), (0, -0.04, 0.0), m["gunmetal"]),
    ], 0.2


def smg(m, p="smg"):
    return [
        box(f"{p}_body", (0.045, 0.32, 0.07), (0, -0.1, 0.06), m["gunmetal"]),
        box(f"{p}_barrel", (0.025, 0.12, 0.025), (0, -0.32, 0.07), m["steel"]),
        box(f"{p}_grip", (0.03, 0.045, 0.1), (0, 0.0, -0.01), m["grip"]),
        rotate(box(f"{p}_mag", (0.025, 0.04, 0.17), (0, -0.12, -0.04), m["gunmetal"]), (8, 0, 0)),
        box(f"{p}_stock", (0.025, 0.16, 0.03), (0, 0.12, 0.05), m["gunmetal"]),
        box(f"{p}_sight", (0.01, 0.04, 0.02), (0, -0.2, 0.105), m["gunmetal"]),
    ], 0.38


def shotgun(m, p="shotgun"):
    return [
        cylinder(f"{p}_barrel", 0.018, 0.62, (0, -0.42, 0.07), m["steel"], verts=6, rotation=(90, 0, 0)),
        cylinder(f"{p}_tube", 0.016, 0.45, (0, -0.33, 0.035), m["gunmetal"], verts=6, rotation=(90, 0, 0)),
        box(f"{p}_pump", (0.045, 0.14, 0.045), (0, -0.36, 0.04), m["grip"]),
        box(f"{p}_receiver", (0.045, 0.18, 0.07), (0, -0.04, 0.06), m["gunmetal"]),
        box(f"{p}_grip", (0.03, 0.05, 0.09), (0, 0.04, -0.005), m["grip"]),
        hull(f"{p}_stock", [(-0.022, 0.05, 0.03), (0.022, 0.05, 0.03), (-0.022, 0.05, 0.09), (0.022, 0.05, 0.09),
                            (-0.025, 0.36, -0.03), (0.025, 0.36, -0.03), (-0.025, 0.36, 0.08),
                            (0.025, 0.36, 0.08)], m["grip"]),
    ], 0.73


def grenade(m, p="grenade"):
    # Held in the fist: origin at its centre.
    return [
        cylinder(f"{p}_body", 0.035, 0.08, (0, 0, 0), m["olive"], verts=8),
        cylinder(f"{p}_cap", 0.02, 0.03, (0, 0, 0.05), m["steel"], verts=6),
        box(f"{p}_lever", (0.012, 0.02, 0.09), (0, 0.03, 0.02), m["steel"]),
        cylinder(f"{p}_pin", 0.014, 0.006, (0.025, 0, 0.055), m["steel"], verts=6, rotation=(0, 90, 0)),
    ], 0.0


def molotov(m, p="molotov"):
    # Held round the bottle's middle (origin), neck up, rag stuffed in the neck.
    return [
        cylinder(f"{p}_bottle", 0.038, 0.17, (0, 0, -0.02), m["bottle"], verts=8),
        cylinder(f"{p}_shoulder", 0.038, 0.05, (0, 0, 0.09), m["bottle"], verts=8, radius2=0.015),
        cylinder(f"{p}_neck", 0.015, 0.06, (0, 0, 0.14), m["bottle"], verts=6),
        rotate(box(f"{p}_rag", (0.03, 0.03, 0.09), (0.0, 0, 0.2), m["rag"]), (0, 25, 0), pivot=(0, 0, 0.17)),
    ], 0.0


def rocket_launcher(m, p="rocket_launcher"):
    # Shoulder tube: origin at the pistol grip under it; the tube runs 1.1 m, 0.75 m of it ahead of the grip.
    return [
        cylinder(f"{p}_tube", 0.065, 1.1, (0, -0.2, 0.11), m["olive"], verts=8, rotation=(90, 0, 0)),
        cylinder(f"{p}_flare", 0.065, 0.12, (0, 0.4, 0.11), m["gunmetal"], verts=8, radius2=0.09,
                 rotation=(-90, 0, 0)),
        cylinder(f"{p}_muzzle", 0.075, 0.06, (0, -0.73, 0.11), m["gunmetal"], verts=8, rotation=(90, 0, 0)),
        box(f"{p}_grip", (0.03, 0.05, 0.11), (0, 0, 0.0), m["grip"]),
        box(f"{p}_fore", (0.03, 0.05, 0.09), (0, -0.35, 0.01), m["grip"]),
        box(f"{p}_sight", (0.05, 0.08, 0.06), (-0.07, -0.25, 0.17), m["gunmetal"]),
    ], 0.76


def rocket(m, p="rocket"):
    # Projectile the game flies: origin at its centre, nose toward game +Z. <= 60 tris.
    return [
        cylinder(f"{p}_body", 0.05, 0.42, (0, 0.03, 0), m["olive"], verts=6, rotation=(90, 0, 0)),
        cylinder(f"{p}_nose", 0.05, 0.16, (0, -0.26, 0), m["warhead"], verts=6, radius2=0.0, rotation=(90, 0, 0)),
        box(f"{p}_fin_a", (0.2, 0.08, 0.01), (0, 0.2, 0), m["gunmetal"]),
        box(f"{p}_fin_b", (0.01, 0.08, 0.2), (0, 0.2, 0), m["gunmetal"]),
    ], 0.0


GUNS = {"pistol": pistol, "smg": smg, "shotgun": shotgun, "grenade": grenade, "molotov": molotov,
        "rocket_launcher": rocket_launcher, "rocket": rocket}


# ---------------------------------------------------------------- pickups (origin on the ground)

def crate(m, gun):
    name = f"crate_{gun}" if gun != "rocket_launcher" else "crate_rocket"
    length = 1.05 if gun == "rocket_launcher" else 0.7  # the launcher gets a long crate
    parts = [
        box(f"{name}_body", (length, 0.5, 0.32), (0, 0, 0.16), m["crate"], bevel=0.015),
        box(f"{name}_stripe", (length + 0.02, 0.12, 0.33), (0, 0, 0.16), m[f"stripe_{gun}"]),
        box(f"{name}_edge_a", (length + 0.02, 0.04, 0.04), (0, -0.24, 0.32), m["crate_dark"]),
        box(f"{name}_edge_b", (length + 0.02, 0.04, 0.04), (0, 0.24, 0.32), m["crate_dark"]),
    ]
    # The gun itself lying on the lid, turned sideways, scaled up a little to read from above.
    gun_parts, _ = GUNS[gun](m, f"{name}_gun")
    scale = {"pistol": 1.6, "smg": 1.2, "shotgun": 0.62, "grenade": 2.6, "molotov": 1.35, "rocket_launcher": 0.82}[gun]
    for obj in gun_parts:
        obj.scale = (scale, scale, scale)
        rotate(obj, (0, -90, 0) if gun == "molotov" else (0, -90, 90), pivot=(0, 0, 0))  # lie along the crate
        obj.location.z += 0.36
        parts.append(obj)
    return parts


def health_kit(m):
    return [
        box("health_kit_box", (0.55, 0.4, 0.22), (0, 0, 0.11), m["white"], bevel=0.02),
        box("health_kit_cross_a", (0.3, 0.09, 0.012), (0, 0, 0.225), m["red"]),
        box("health_kit_cross_b", (0.09, 0.3, 0.012), (0, 0, 0.225), m["red"]),
        box("health_kit_handle", (0.2, 0.04, 0.05), (0, 0, 0.25), m["red"]),
        box("health_kit_side", (0.12, 0.012, 0.12), (0, -0.205, 0.11), m["red"]),
    ]


def package(m):
    return [
        box("package_box", (0.5, 0.42, 0.34), (0, 0, 0.17), m["cardboard"]),
        box("package_tape_a", (0.52, 0.08, 0.35), (0, 0, 0.17), m["tape"]),
        box("package_tape_b", (0.08, 0.44, 0.35), (0, 0, 0.17), m["tape"]),
    ]


def cash(m):
    parts = []
    for i, (x, y, z, a) in enumerate(((0, 0, 0, 0), (0.06, 0.02, 0.06, 12), (-0.04, 0.04, 0.12, -8))):
        stack = box(f"cash_stack{i}", (0.32, 0.15, 0.06), (x, y, 0.03 + z), m["note"])
        band = box(f"cash_band{i}", (0.06, 0.155, 0.062), (x, y, 0.03 + z), m["band"])
        for obj in (stack, band):
            rotate(obj, (0, 0, a), pivot=(x, y, 0))
            parts.append(obj)
    return parts


def armour(m):
    # Folded body-armour vest: a padded slab with a plate panel and shoulder straps.
    return [
        box("armour_vest", (0.5, 0.42, 0.09), (0, 0, 0.045), m["vest"], bevel=0.02),
        box("armour_fold", (0.5, 0.2, 0.07), (0, 0.1, 0.12), m["vest"], bevel=0.02),
        box("armour_plate", (0.3, 0.16, 0.02), (0, -0.08, 0.1), m["gunmetal"]),
        box("armour_strap_a", (0.08, 0.36, 0.02), (-0.16, 0, 0.165), m["grip"]),
        box("armour_strap_b", (0.08, 0.36, 0.02), (0.16, 0, 0.165), m["grip"]),
    ]


def ammo_box(m):
    return [
        box("ammo_box_body", (0.45, 0.22, 0.24), (0, 0, 0.12), m["olive"]),
        box("ammo_box_lid", (0.47, 0.24, 0.04), (0, 0, 0.25), m["olive"]),
        box("ammo_box_handle", (0.18, 0.03, 0.03), (0, 0, 0.285), m["gunmetal"]),
        box("ammo_box_band", (0.46, 0.23, 0.05), (0, 0, 0.12), m["ammo_band"]),
        box("ammo_box_stencil", (0.3, 0.06, 0.01), (0, -0.07, 0.275), m["ammo_band"]),
    ]


PICKUPS = {
    "crate_pistol": lambda m: crate(m, "pistol"),
    "crate_smg": lambda m: crate(m, "smg"),
    "crate_shotgun": lambda m: crate(m, "shotgun"),
    "crate_grenade": lambda m: crate(m, "grenade"),
    "crate_molotov": lambda m: crate(m, "molotov"),
    "crate_rocket": lambda m: crate(m, "rocket_launcher"),
    "armour": armour,
    "ammo_box": ammo_box,
    "health_kit": health_kit,
    "package": package,
    "cash": cash,
}


def build(out_dir: Path, thumbs: bool = False):
    reset_scene()
    m = mats()
    objects = []
    for i, (name, make) in enumerate(GUNS.items()):
        parts, muzzle = make(m)
        root = group(name, parts, location=(i * 1.0, 0, 0))
        root["muzzle"] = muzzle
        objects += [root, *parts]
    export_glb(out_dir / "weapons.glb", objects)

    reset_scene()
    m = mats()
    objects = []
    for i, (name, make) in enumerate(PICKUPS.items()):
        parts = make(m)
        objects += [group(name, parts, location=(i * 1.2, 0, 0)), *parts]
    export_glb(out_dir / "pickups.glb", objects)
    if thumbs:
        render_thumbnail(THUMBS / "pickups.png", target_height=1)
