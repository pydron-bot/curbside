"""Guns and pickups: weapons.glb and pickups.glb.

weapons.glb: `pistol`, `smg`, `shotgun` as loose models for the game to attach
at the hand. Origin at the grip (where the fist closes), barrel toward Blender
-Y (game +Z), up is up; `muzzle` (metres ahead of the grip, along the barrel)
is exported as a custom property on each root for muzzle flashes.

pickups.glb: things lying in the street, designed to read from above:
`crate_pistol` / `crate_smg` / `crate_shotgun` (the gun on the lid and a
coloured stripe per gun), `health_kit`, `package` (hidden-package
collectible) and `cash`. Origin at ground centre. Budget <= 300 tris each.
"""
from pathlib import Path

from lib.common import box, cylinder, export_glb, group, hull, material, render_thumbnail, reset_scene, rotate

THUMBS = Path(__file__).resolve().parents[1] / "thumbs"

GUN_STRIPES = {"pistol": (240, 200, 40), "smg": (240, 120, 30), "shotgun": (210, 40, 40)}


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


GUNS = {"pistol": pistol, "smg": smg, "shotgun": shotgun}


# ---------------------------------------------------------------- pickups (origin on the ground)

def crate(m, gun):
    name = f"crate_{gun}"
    parts = [
        box(f"{name}_body", (0.7, 0.5, 0.32), (0, 0, 0.16), m["crate"], bevel=0.015),
        box(f"{name}_stripe", (0.72, 0.12, 0.33), (0, 0, 0.16), m[f"stripe_{gun}"]),
        box(f"{name}_edge_a", (0.72, 0.04, 0.04), (0, -0.24, 0.32), m["crate_dark"]),
        box(f"{name}_edge_b", (0.72, 0.04, 0.04), (0, 0.24, 0.32), m["crate_dark"]),
    ]
    # The gun itself lying on the lid, turned sideways, scaled up a little to read from above.
    gun_parts, _ = GUNS[gun](m, f"{name}_gun")
    scale = {"pistol": 1.6, "smg": 1.2, "shotgun": 0.62}[gun]
    for obj in gun_parts:
        obj.scale = (scale, scale, scale)
        rotate(obj, (0, -90, 90), pivot=(0, 0, 0))
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


PICKUPS = {
    "crate_pistol": lambda m: crate(m, "pistol"),
    "crate_smg": lambda m: crate(m, "smg"),
    "crate_shotgun": lambda m: crate(m, "shotgun"),
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
