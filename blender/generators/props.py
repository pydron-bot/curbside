"""Low-poly street furniture, rooftop clutter, trees and stunt ramps: props.glb.

One root node per prop, named as the game will instance it, with its origin at
the ground contact point (laid out side by side here; the game re-centres each
root, as it does for vehicles.glb). Flat colours from material base colours,
no textures. Front is Blender -Y (game +Z). Budget: <= 300 tris per prop.

Materials with a meaning for the game:
  lamp                                 streetlamp head, glows at night
  light_red / light_amber / light_green traffic light lenses (for working lights)
  police_lamp                          blue lamp on police_sign (glow it too)
  spray_sign                           Pay 'n' Spray sign and stripes
Everything else is a fixed colour.
"""
from pathlib import Path

from mathutils import Matrix

from lib.common import (
    box,
    cylinder,
    export_glb,
    group,
    hull,
    ico,
    material,
    render_thumbnail,
    reset_scene,
    rotate,
)

THUMBS = Path(__file__).resolve().parents[1] / "thumbs"


def mats():
    return {
        "pole": material("pole", (70, 76, 82), 0.5),
        "metal": material("metal", (150, 156, 162), 0.4),
        "dark": material("dark", (36, 38, 42), 0.7),
        "lamp": material("lamp", (255, 236, 180), 0.3),
        "light_red": material("light_red", (220, 40, 30), 0.3),
        "light_amber": material("light_amber", (245, 170, 30), 0.3),
        "light_green": material("light_green", (40, 200, 90), 0.3),
        "signal_box": material("signal_box", (40, 44, 30), 0.6),
        "hydrant": material("hydrant", (200, 40, 32), 0.5),
        "wood": material("wood", (150, 100, 60), 0.9),
        "bin_green": material("bin_green", (46, 92, 62), 0.7),
        "dumpster": material("dumpster", (40, 100, 140), 0.7),
        "hazard": material("hazard", (240, 196, 30), 0.6),
        "news_blue": material("news_blue", (40, 90, 170), 0.5),
        "mail_blue": material("mail_blue", (30, 60, 130), 0.5),
        "glass": material("glass", (32, 42, 56), 0.15),
        "payphone": material("payphone", (230, 190, 40), 0.5),
        "payphone_sign": material("payphone_sign", (30, 140, 220), 0.4),
        "concrete": material("concrete", (160, 158, 150), 0.95),
        "ac": material("ac", (205, 208, 210), 0.6),
        "tank_wood": material("tank_wood", (120, 82, 50), 0.9),
        "white": material("white", (230, 232, 235), 0.5),
        "trunk": material("trunk", (92, 64, 42), 0.9),
        "leaf": material("leaf", (60, 130, 60), 0.85),
        "leaf_dark": material("leaf_dark", (36, 96, 52), 0.85),
        "palm_leaf": material("palm_leaf", (88, 150, 60), 0.85),
        "ramp": material("ramp", (110, 116, 124), 0.5),
        "barrier_orange": material("barrier_orange", (235, 110, 30), 0.6),
        "booth_wall": material("booth_wall", (196, 190, 176), 0.9),
        "booth_roof": material("booth_roof", (80, 84, 90), 0.7),
        "spray_sign": material("spray_sign", (230, 60, 140), 0.4),
        "police_lamp": material("police_lamp", (60, 120, 255), 0.3),
        "police_blue": material("police_blue", (24, 48, 120), 0.5),
    }


# ---------------------------------------------------------------- street

def streetlamp(m):
    # ~6 m pole at the kerb, arm reaching 1.8 m out over the road (toward -Y), lamp head at the tip.
    return [
        cylinder("streetlamp_base", 0.17, 0.5, (0, 0, 0.25), m["pole"], verts=8),
        cylinder("streetlamp_pole", 0.08, 6.0, (0, 0, 3.0), m["pole"], verts=6, radius2=0.06),
        box("streetlamp_arm", (0.08, 1.9, 0.08), (0, -0.9, 6.0), m["pole"]),
        box("streetlamp_head", (0.36, 0.7, 0.14), (0, -1.85, 5.96), m["pole"]),
        box("streetlamp_lamp", (0.3, 0.6, 0.04), (0, -1.85, 5.87), m["lamp"]),
    ]


def traffic_light(m):
    parts = [
        cylinder("traffic_light_pole", 0.07, 3.6, (0, 0, 1.8), m["pole"], verts=6),
        box("traffic_light_head", (0.34, 0.26, 0.95), (0, 0, 3.55), m["signal_box"]),
        box("traffic_light_back", (0.5, 0.04, 1.15), (0, 0.15, 3.55), m["dark"]),
    ]
    for i, colour in enumerate(("light_red", "light_amber", "light_green")):
        z = 3.85 - i * 0.3
        parts.append(cylinder(f"traffic_light_{colour}", 0.09, 0.04, (0, -0.14, z), m[colour], verts=8,
                              rotation=(90, 0, 0)))
        parts.append(box(f"traffic_light_visor{i}", (0.22, 0.12, 0.02), (0, -0.19, z + 0.11), m["signal_box"]))
    return parts


def hydrant(m):
    h = m["hydrant"]
    return [
        cylinder("hydrant_base", 0.17, 0.08, (0, 0, 0.04), h, verts=8),
        cylinder("hydrant_body", 0.12, 0.5, (0, 0, 0.33), h, verts=8),
        cylinder("hydrant_cap", 0.14, 0.14, (0, 0, 0.63), h, verts=8, radius2=0.05),
        cylinder("hydrant_nozzles", 0.05, 0.38, (0, 0, 0.42), h, verts=6, rotation=(0, 90, 0)),
        cylinder("hydrant_front", 0.065, 0.12, (0, -0.15, 0.4), m["metal"], verts=6, rotation=(90, 0, 0)),
    ]


def bench(m):
    parts = []
    for i in range(3):  # seat slats
        parts.append(box(f"bench_seat{i}", (1.8, 0.12, 0.04), (0, -0.2 + i * 0.15, 0.45), m["wood"]))
    for i in range(2):  # back slats
        parts.append(rotate(box(f"bench_back{i}", (1.8, 0.04, 0.12), (0, 0.15, 0.65 + i * 0.17), m["wood"]),
                            (-12, 0, 0), pivot=(0, 0.15, 0.45)))
    for x in (-0.75, 0.75):
        parts.append(box(f"bench_leg{x:+.0f}", (0.06, 0.5, 0.43), (x, 0, 0.215), m["dark"]))
        parts.append(rotate(box(f"bench_post{x:+.0f}", (0.06, 0.05, 0.5), (x, 0.17, 0.7), m["dark"]),
                            (-12, 0, 0), pivot=(x, 0.17, 0.45)))
    return parts


def trash_bin(m):
    return [
        cylinder("trash_bin_body", 0.25, 0.85, (0, 0, 0.425), m["bin_green"], verts=8, radius2=0.28),
        cylinder("trash_bin_lid", 0.3, 0.1, (0, 0, 0.9), m["dark"], verts=8, radius2=0.22),
        cylinder("trash_bin_hole", 0.12, 0.02, (0, 0, 0.955), m["dark"], verts=8),
    ]


def dumpster(m):
    d = m["dumpster"]
    parts = [
        hull("dumpster_body", [(-0.95, -0.55, 0.15), (0.95, -0.55, 0.15), (-0.95, 0.5, 0.15), (0.95, 0.5, 0.15),
                               (-1.0, -0.65, 1.2), (1.0, -0.65, 1.2), (-1.0, 0.6, 1.25), (1.0, 0.6, 1.25)], d),
        # Two lids, one propped open (reads from above as a dark gap).
        box("dumpster_lid_a", (0.98, 1.3, 0.05), (-0.5, -0.02, 1.26), m["dark"]),
        rotate(box("dumpster_lid_b", (0.98, 1.3, 0.05), (0.5, -0.02, 1.26), m["dark"]), (-35, 0, 0),
               pivot=(0.5, 0.63, 1.26)),
        box("dumpster_rim", (2.04, 0.1, 0.12), (0, -0.66, 1.1), d),
    ]
    for x in (-0.8, 0.8):
        for y in (-0.4, 0.35):
            parts.append(cylinder(f"dumpster_wheel{x:+.0f}{y:+.0f}", 0.08, 0.06, (x, y, 0.08), m["dark"], verts=6,
                                  rotation=(0, 90, 0)))
    return parts


def bollard(m):
    return [
        cylinder("bollard_post", 0.1, 0.9, (0, 0, 0.45), m["pole"], verts=8),
        cylinder("bollard_band", 0.105, 0.1, (0, 0, 0.75), m["hazard"], verts=8),
        cylinder("bollard_top", 0.1, 0.06, (0, 0, 0.93), m["pole"], verts=8, radius2=0.06),
    ]


def newspaper_box(m):
    return [
        box("newspaper_box_body", (0.5, 0.42, 0.6), (0, 0, 0.62), m["news_blue"], bevel=0.02),
        box("newspaper_box_window", (0.38, 0.02, 0.24), (0, -0.21, 0.7), m["glass"]),
        box("newspaper_box_top", (0.54, 0.46, 0.05), (0, 0, 0.945), m["news_blue"]),
        box("newspaper_box_legs", (0.42, 0.34, 0.32), (0, 0, 0.16), m["dark"]),
    ]


def mailbox(m):
    b = m["mail_blue"]
    parts = [
        box("mailbox_body", (0.5, 0.55, 0.7), (0, 0, 0.75), b),
        cylinder("mailbox_dome", 0.25, 0.55, (0, 0, 1.1), b, verts=8, rotation=(90, 0, 0)),
        box("mailbox_slot", (0.3, 0.02, 0.05), (0, -0.28, 0.95), m["dark"]),
    ]
    for x in (-0.2, 0.2):
        for y in (-0.22, 0.22):
            parts.append(box(f"mailbox_leg{x:+.1f}{y:+.1f}", (0.05, 0.05, 0.42), (x, y, 0.21), m["dark"]))
    return parts


def payphone(m):
    # Mission givers: the bright sign roof makes it visible from 20-50 m up.
    return [
        box("payphone_post", (0.12, 0.12, 2.1), (0, 0.12, 1.05), m["pole"]),
        box("payphone_box", (0.5, 0.25, 0.7), (0, 0, 1.35), m["payphone"]),
        box("payphone_handset", (0.08, 0.06, 0.24), (0.15, -0.14, 1.4), m["dark"]),
        box("payphone_keypad", (0.18, 0.02, 0.2), (-0.06, -0.13, 1.3), m["dark"]),
        box("payphone_hood", (0.9, 0.7, 0.08), (0, -0.05, 2.12), m["payphone"]),
        box("payphone_sign", (0.8, 0.6, 0.06), (0, -0.05, 2.19), m["payphone_sign"]),
        box("payphone_sign_band", (0.86, 0.04, 0.24), (0, -0.4, 2.0), m["payphone_sign"]),
    ]


# ---------------------------------------------------------------- rooftops

def ac_unit(m):
    return [
        box("ac_unit_body", (1.2, 0.9, 0.75), (0, 0, 0.4), m["ac"], bevel=0.03),
        cylinder("ac_unit_fan", 0.32, 0.04, (-0.2, 0, 0.79), m["dark"], verts=10),
        box("ac_unit_grille", (1.1, 0.02, 0.5), (0, -0.46, 0.4), m["metal"]),
        box("ac_unit_feet", (1.1, 0.8, 0.04), (0, 0, 0.02), m["dark"]),
    ]


def vent(m):
    return [
        cylinder("vent_pipe", 0.15, 0.7, (0, 0, 0.35), m["metal"], verts=8),
        cylinder("vent_cap", 0.3, 0.18, (0, 0, 0.8), m["metal"], verts=8, radius2=0.04),
        cylinder("vent_skirt", 0.24, 0.06, (0, 0, 0.03), m["dark"], verts=8),
    ]


def water_tank(m):
    parts = [
        cylinder("water_tank_barrel", 1.15, 2.0, (0, 0, 2.6), m["tank_wood"], verts=10),
        cylinder("water_tank_roof", 1.25, 0.6, (0, 0, 3.9), m["dark"], verts=10, radius2=0.1),
        cylinder("water_tank_hoop", 1.17, 0.08, (0, 0, 2.2), m["dark"], verts=10),
        cylinder("water_tank_hoop2", 1.17, 0.08, (0, 0, 3.0), m["dark"], verts=10),
        box("water_tank_deck", (2.4, 2.4, 0.1), (0, 0, 1.55), m["dark"]),
    ]
    for x in (-0.85, 0.85):
        for y in (-0.85, 0.85):
            parts.append(box(f"water_tank_leg{x:+.0f}{y:+.0f}", (0.12, 0.12, 1.5), (x, y, 0.75), m["pole"]))
    return parts


def satellite_dish(m):
    dish = cylinder("satellite_dish_dish", 0.6, 0.18, (0, 0, 0), m["white"], verts=10, radius2=0.12)
    rotate(dish, (-125, 0, 0))
    dish.location = (0, -0.1, 1.0)
    return [
        box("satellite_dish_base", (0.5, 0.5, 0.1), (0, 0, 0.05), m["dark"]),
        cylinder("satellite_dish_post", 0.05, 0.9, (0, 0, 0.5), m["metal"], verts=6),
        dish,
        rotate(box("satellite_dish_feed", (0.03, 0.03, 0.55), (0, -0.35, 1.05), m["metal"]), (40, 0, 0)),
    ]


def rooftop_door(m):
    return [
        box("rooftop_door_hut", (1.5, 1.8, 2.4), (0, 0, 1.2), m["concrete"]),
        hull("rooftop_door_roof", [(-0.85, -1.0, 2.4), (0.85, -1.0, 2.4), (-0.85, 1.0, 2.4), (0.85, 1.0, 2.4),
                                   (-0.85, -1.0, 2.55), (0.85, -1.0, 2.55), (-0.85, 1.0, 2.75),
                                   (0.85, 1.0, 2.75)], m["dark"]),
        box("rooftop_door_door", (0.9, 0.04, 2.0), (0, -0.91, 1.0), m["pole"]),
        box("rooftop_door_light", (0.2, 0.1, 0.12), (0, -0.95, 2.2), m["lamp"]),
    ]


def antenna(m):
    parts = [
        cylinder("antenna_mast", 0.04, 3.2, (0, 0, 1.6), m["metal"], verts=6),
        box("antenna_base", (0.4, 0.4, 0.08), (0, 0, 0.04), m["dark"]),
    ]
    for i, w in enumerate((1.2, 0.9, 0.6)):
        parts.append(box(f"antenna_bar{i}", (w, 0.03, 0.03), (0, 0, 2.3 + i * 0.35), m["metal"]))
    parts.append(box("antenna_tip", (0.08, 0.08, 0.08), (0, 0, 3.24), m["light_red"]))
    return parts


# ---------------------------------------------------------------- trees

def tree_round(m):
    return [
        cylinder("tree_round_trunk", 0.14, 2.2, (0, 0, 1.1), m["trunk"], verts=6, radius2=0.1),
        ico("tree_round_canopy", 1.6, (0, 0, 3.4), m["leaf"], subdiv=1, scale=(1, 1, 0.85)),
        ico("tree_round_top", 1.0, (0.4, -0.3, 4.3), m["leaf"], subdiv=1, scale=(1, 1, 0.8)),
    ]


def tree_tall(m):
    parts = [cylinder("tree_tall_trunk", 0.16, 1.6, (0, 0, 0.8), m["trunk"], verts=6)]
    for i, (r, z) in enumerate(((1.5, 2.4), (1.15, 3.6), (0.75, 4.7))):
        parts.append(cylinder(f"tree_tall_cone{i}", r, 1.8, (0, 0, z), m["leaf_dark"], verts=8, radius2=0.05))
    return parts


def palm(m):
    parts = []
    # Gently curving trunk in four segments.
    lean = z = 0.0
    for i in range(4):
        h = 1.8
        seg = cylinder(f"palm_trunk{i}", 0.17 - i * 0.02, h, (lean, 0, z + h / 2), m["trunk"], verts=6,
                       radius2=0.15 - i * 0.02)
        rotate(seg, (0, 4 + i * 2, 0), pivot=(lean, 0, z))
        parts.append(seg)
        lean += 0.15 + i * 0.07
        z += h * 0.995
    top = Matrix.Translation((lean, 0, z))
    # Fronds radiate from the crown and droop: a star from directly above.
    for i in range(7):
        frond = hull(f"palm_frond{i}", [(0, -0.05, 0), (0, 0.05, 0), (2.4, -0.35, -0.35), (2.4, 0.35, -0.35),
                                        (3.3, 0, -1.0), (1.2, 0, 0.12)], m["palm_leaf"])
        rotate(frond, (0, 0, 360 * i / 7), pivot=(0, 0, 0))
        frond.data.transform(top)
        parts.append(frond)
    parts.append(ico("palm_crown", 0.3, (lean, 0, z), m["trunk"], subdiv=1))
    return parts


# ---------------------------------------------------------------- stunts

def ramp(m, name="ramp", length=6.0, height=1.6, width=3.2):
    # Low edge at +Y, lip at -Y: drive up it travelling toward the model's front (game +Z).
    hl, hw = length / 2, width / 2
    deck = hull(f"{name}_deck", [(-hw, hl, 0), (hw, hl, 0), (-hw, -hl, 0), (hw, -hl, 0),
                                 (-hw, -hl, height), (hw, -hl, height)], m["ramp"])
    stripe = hull(f"{name}_lip", [(-hw - 0.01, -hl - 0.01, height - 0.25), (hw + 0.01, -hl - 0.01, height - 0.25),
                                  (-hw - 0.01, -hl - 0.01, height + 0.01), (hw + 0.01, -hl - 0.01, height + 0.01),
                                  (-hw - 0.01, -hl + 0.95, height + 0.01), (hw + 0.01, -hl + 0.95, height + 0.01)],
                  m["hazard"])
    parts = [deck, stripe]
    for x in (-hw + 0.1, hw - 0.1):
        parts.append(box(f"{name}_strut{x:+.0f}", (0.1, 0.1, height), (x, -hl + 0.06, height / 2), m["dark"]))
    return parts


def kicker(m):
    return ramp(m, "kicker", length=2.5, height=0.6, width=2.2)


# ---------------------------------------------------------------- police

def barrier(m):
    # Police sawhorse, 2.4 m wide: two striped boards on A-frame legs.
    parts = []
    for b, z in enumerate((0.95, 0.6)):
        for i in range(6):  # alternating orange / white blocks read as stripes
            mat = m["barrier_orange"] if (i + b) % 2 == 0 else m["white"]
            parts.append(box(f"barrier_board{b}_{i}", (0.4, 0.04, 0.2), (-1.0 + i * 0.4, -0.05, z), mat))
    for x in (-1.0, 1.0):
        for y in (-1, 1):
            parts.append(rotate(box(f"barrier_leg{x:+.0f}{y:+d}", (0.06, 0.06, 1.12), (x, 0, 0.53), m["dark"]),
                                (y * 14, 0, 0), pivot=(x, 0, 1.05)))
        parts.append(box(f"barrier_foot{x:+.0f}", (0.1, 0.6, 0.04), (x, 0, 0.02), m["dark"]))
    return parts


def spray_booth(m):
    # Open-fronted garage shell 6 m wide x 9 m deep x 4.5 m; the mouth faces game -Z (Blender +Y).
    W, D, H, t = 6.0, 9.0, 4.5, 0.25
    parts = [
        box("spray_booth_back", (W, t, H), (0, -D / 2 + t / 2, H / 2), m["booth_wall"]),
        box("spray_booth_roof", (W + 0.3, D + 0.3, 0.3), (0, 0, H + 0.15), m["booth_roof"]),
        box("spray_booth_door", (W - 2 * t, 0.5, 0.6), (0, D / 2 - 0.3, H - 0.3), m["metal"]),
        box("spray_booth_sign", (W * 0.75, 0.15, 0.9), (0, D / 2 + 0.1, H + 0.45), m["spray_sign"]),
        box("spray_booth_signtop", (W * 0.75, 1.2, 0.08), (0, D / 2 - 0.45, H + 0.94), m["spray_sign"]),
        box("spray_booth_nozzles", (W - 1.0, 0.25, 0.25), (0, 0, H - 0.4), m["dark"]),
    ]
    for x in (-1, 1):
        parts.append(box(f"spray_booth_wall{x:+d}", (t, D, H), (x * (W / 2 - t / 2), 0, H / 2), m["booth_wall"]))
        parts.append(box(f"spray_booth_stripe{x:+d}", (t + 0.02, D, 0.4), (x * (W / 2 - t / 2), 0, 1.0),
                         m["spray_sign"]))
    return parts


def police_sign(m):
    # Blue lamp and POLICE board over a station door: origin on the ground at the wall face,
    # everything sticks out toward the front (game +Z), the lamp at ~3.4 m.
    return [
        box("police_sign_board", (2.4, 0.12, 0.55), (0, -0.08, 3.0), m["police_blue"]),
        box("police_sign_border", (2.5, 0.1, 0.65), (0, -0.04, 3.0), m["white"]),
        box("police_sign_letters", (1.8, 0.02, 0.18), (0, -0.15, 3.0), m["white"]),
        box("police_sign_bracket", (0.08, 0.7, 0.08), (0, -0.35, 3.6), m["dark"]),
        box("police_sign_lamp", (0.34, 0.34, 0.42), (0, -0.7, 3.4), m["police_lamp"]),
        cylinder("police_sign_cap", 0.26, 0.14, (0, -0.7, 3.68), m["dark"], verts=4, radius2=0.05,
                 rotation=(0, 0, 45)),
    ]


PROPS = {
    "streetlamp": streetlamp, "traffic_light": traffic_light, "hydrant": hydrant, "bench": bench,
    "trash_bin": trash_bin, "dumpster": dumpster, "bollard": bollard, "newspaper_box": newspaper_box,
    "mailbox": mailbox, "payphone": payphone,
    "ac_unit": ac_unit, "vent": vent, "water_tank": water_tank, "satellite_dish": satellite_dish,
    "rooftop_door": rooftop_door, "antenna": antenna,
    "tree_round": tree_round, "tree_tall": tree_tall, "palm": palm,
    "ramp": ramp, "kicker": kicker,
    "barrier": barrier, "spray_booth": spray_booth, "police_sign": police_sign,
}


def build(out_dir: Path, thumbs: bool = False):
    reset_scene()
    m = mats()
    objects = []
    for i, (name, make) in enumerate(PROPS.items()):
        parts = make(m)
        root = group(name, parts, location=(i * 4.0, 0, 0))  # side by side; the game re-centres
        objects += [root, *parts]
    export_glb(out_dir / "props.glb", objects)
    if thumbs:
        render_thumbnail(THUMBS / "props.png", target_height=8)
