"""Low-poly street furniture, rooftop clutter, trees and stunt ramps: props.glb.

One root node per prop, named as the game will instance it, with its origin at
the ground contact point (laid out side by side here; the game re-centres each
root, as it does for vehicles.glb). Flat colours from material base colours,
no textures. Front is Blender -Y (game +Z). Budget: <= 300 tris per prop.

Materials with a meaning for the game:
  lamp                                 streetlamp head and safehouse door light, glow at night
  light_red / light_amber / light_green traffic light lenses (for working lights)
  police_lamp                          blue lamp on police_sign (glow it too)
  spray_sign                           Pay 'n' Spray sign and stripes
  export_sign                          export bay '$' and lintel
  frenzy                               frenzy token (glow it)
Everything else is a fixed colour.
"""
from pathlib import Path

from mathutils import Matrix

from lib.common import (
    box,
    cylinder,
    export_glb,
    fan,
    open_box,
    prism,
    strips,
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
        # Lighter tops for the kit seen from above: weathered boards and tar felt.
        "tank_lid": material("tank_lid", (97, 70, 48), 0.9),
        "tar_roof": material("tar_roof", (97, 97, 99), 0.9),
        "white": material("white", (230, 232, 235), 0.5),
        "trunk": material("trunk", (92, 64, 42), 0.9),
        "leaf": material("leaf", (60, 130, 60), 0.85),
        "leaf_dark": material("leaf_dark", (36, 96, 52), 0.85),
        "palm_leaf": material("palm_leaf", (88, 150, 60), 0.85),
        "ramp": material("ramp", (110, 116, 124), 0.5),
        "barrier_orange": material("barrier_orange", (235, 110, 30), 0.6),
        "booth_wall": material("booth_wall", (196, 190, 176), 0.9),
        "booth_roof": material("booth_roof", (140, 144, 152), 0.7),
        "spray_sign": material("spray_sign", (230, 60, 140), 0.4),
        "police_lamp": material("police_lamp", (60, 120, 255), 0.3),
        "police_blue": material("police_blue", (24, 48, 120), 0.5),
        "chequer_black": material("chequer_black", (20, 20, 22), 0.6),
        "export_sign": material("export_sign", (40, 200, 90), 0.4),
        "garage_door": material("garage_door", (120, 126, 132), 0.6),
        "frenzy": material("frenzy", (255, 60, 60), 0.3),
        "cone_orange": material("cone_orange", (250, 100, 20), 0.6),
        # Street props, round 2 (colours from src/render/propStandIns.ts).
        "blink_amber": material("blink_amber", (255, 176, 32), 0.3),
        "roadwork_sign": material("roadwork_sign", (255, 148, 24), 0.5),
        "sign_black": material("sign_black", (20, 20, 20), 0.6),
        "steel_plate": material("steel_plate", (92, 98, 103), 0.5),
        "trench": material("trench", (36, 28, 20), 0.95),
        "spoil": material("spoil", (125, 100, 72), 0.95),
        "skip_paint": material("skip_paint", (230, 174, 23), 0.6),
        "rubble": material("rubble", (123, 116, 106), 0.95),
        "rubble_dark": material("rubble_dark", (89, 75, 61), 0.95),
        "digger_paint": material("digger_paint", (240, 180, 24), 0.5),
        "track": material("track", (35, 35, 35), 0.8),
        "toilet_blue": material("toilet_blue", (45, 111, 194), 0.6),
        "toilet_door": material("toilet_door", (32, 84, 150), 0.6),
        "toilet_roof": material("toilet_roof", (228, 230, 226), 0.6),
        "cart_steel": material("cart_steel", (201, 204, 208), 0.35),
        "umbrella_red": material("umbrella_red", (200, 48, 42), 0.7),
        "umbrella_yellow": material("umbrella_yellow", (242, 194, 27), 0.7),
        "coffee_brown": material("coffee_brown", (107, 66, 40), 0.7),
        "canopy_green": material("canopy_green", (31, 90, 68), 0.7),
        "canopy_cream": material("canopy_cream", (239, 226, 200), 0.7),
        "fruit_red": material("fruit_red", (216, 50, 42), 0.7),
        "fruit_orange": material("fruit_orange", (240, 138, 26), 0.7),
        "fruit_yellow": material("fruit_yellow", (242, 208, 42), 0.7),
        "fruit_green": material("fruit_green", (108, 184, 58), 0.7),
        "awning_green": material("awning_green", (47, 138, 74), 0.7),
        "shelter_glass": material("shelter_glass", (127, 159, 174), 0.15),
        "shelter_roof": material("shelter_roof", (214, 218, 221), 0.6),
        "stripe_bus": material("stripe_bus", (31, 111, 209), 0.4),
        "ad_panel": material("ad_panel", (243, 231, 200), 0.3),
        "bike_frame": material("bike_frame", (47, 163, 107), 0.5),
        "flowers": material("flowers", (216, 72, 122), 0.7),
        "meter": material("meter", (61, 68, 72), 0.5),
        "meter_cap": material("meter_cap", (201, 162, 39), 0.5),
        "recycle_blue": material("recycle_blue", (42, 98, 184), 0.6),
        "recycle_lid": material("recycle_lid", (75, 134, 214), 0.6),
        "umbrella_cream": material("umbrella_cream", (239, 228, 204), 0.7),
        "paint": material("paint", (200, 42, 42), 0.5),
        "atm_body": material("atm_body", (91, 102, 112), 0.5),
        "screen": material("screen", (89, 198, 255), 0.2),
        "stripe_atm": material("stripe_atm", (42, 125, 225), 0.4),
        "cart_red": material("cart_red", (200, 48, 42), 0.5),
    }


# ---------------------------------------------------------------- street

def streetlamp(m):
    # ~6 m pole at the kerb, arm reaching 1.8 m out over the road (toward -Y), lamp head at the tip.
    return [
        cylinder("streetlamp_base", 0.17, 0.5, (0, 0, 0.25), m["pole"], verts=8),
        cylinder("streetlamp_pole", 0.08, 6.0, (0, 0, 3.0), m["pole"], verts=6, radius2=0.06),
        box("streetlamp_arm", (0.08, 1.9, 0.08), (0, -0.9, 6.0), m["pole"]),
        box("streetlamp_head", (0.46, 0.9, 0.14), (0, -1.85, 5.96), m["pole"]),
        box("streetlamp_lamp", (0.38, 0.8, 0.04), (0, -1.85, 5.87), m["lamp"]),
        # A lens on top too: the camera looks down on the head, never up into it.
        box("streetlamp_toplens", (0.3, 0.66, 0.02), (0, -1.85, 6.04), m["lamp"]),
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
        # The same light on the head's top (lit by the cycle like the lens): what reads from above.
        parts.append(box(f"traffic_light_top{i}", (0.1, 0.2, 0.02), (-0.11 + i * 0.11, 0, 4.035), m[colour]))
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
        cylinder("water_tank_roof", 1.25, 0.6, (0, 0, 3.9), m["tank_lid"], verts=10, radius2=0.1),
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
                                   (0.85, 1.0, 2.75)], m["tar_roof"]),
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
        # Lit too (a dark cap read as a black square from above).
        cylinder("police_sign_cap", 0.26, 0.14, (0, -0.7, 3.68), m["police_lamp"], verts=4, radius2=0.05,
                 rotation=(0, 0, 45)),
    ]


# ---------------------------------------------------------------- activities (§8)

def start_gantry(m):
    # Start/finish arch over the 16 m road (spans X): pillars on the kerb lines either side, 17.2 m
    # apart, so the game draws it at 1:1. A white beam with black squares laid over it (chequered from
    # the side and above, half the boxes of a full chequer).
    span, h = 17.2, 5.5
    parts = []
    for x in (-1, 1):
        parts.append(box(f"start_gantry_pillar{x:+d}", (0.5, 0.5, h), (x * span / 2, 0, h / 2), m["pole"]))
        parts.append(box(f"start_gantry_foot{x:+d}", (0.9, 0.9, 0.2), (x * span / 2, 0, 0.1), m["concrete"]))
    parts.append(box("start_gantry_beam", (span, 1.0, 1.0), (0, 0, h + 0.5), m["white"]))
    cols = 11
    w = span / cols
    for i in range(cols):
        for j, y in enumerate((-0.255, 0.255)):
            if (i + j) % 2:
                parts.append(box(f"start_gantry_check{i}_{j}", (w, 0.51, 1.02), (-span / 2 + (i + 0.5) * w, y, h + 0.5),
                                 m["chequer_black"]))
    return parts


def export_bay(m):
    # Open garage at the docks, 7 x 10 x 5 m, mouth facing game -Z (Blender +Y), with a big '$' on the roof.
    W, D, H, t = 7.0, 10.0, 5.0, 0.3
    parts = [
        box("export_bay_back", (W, t, H), (0, -D / 2 + t / 2, H / 2), m["booth_wall"]),
        box("export_bay_roof", (W + 0.3, D + 0.3, 0.3), (0, 0, H + 0.15), m["booth_roof"]),
        box("export_bay_lintel", (W, 0.3, 0.8), (0, D / 2 - 0.15, H - 0.4), m["export_sign"]),
    ]
    for x in (-1, 1):
        parts.append(box(f"export_bay_wall{x:+d}", (t, D, H), (x * (W / 2 - t / 2), 0, H / 2), m["booth_wall"]))
    # '$' lying flat on the roof, readable from directly above (top of the glyph toward game -Z).
    z = H + 0.33
    g, bar = 0.5, 2.6  # stroke width, glyph width
    for name, (sx, sy, x, y) in {
        "top": (bar, g, 0, 2.0), "mid": (bar, g, 0, 0), "bot": (bar, g, 0, -2.0),
        "ul": (g, 2.0, -bar / 2 + g / 2, 1.0), "lr": (g, 2.0, bar / 2 - g / 2, -1.0),
        "stem": (g * 0.6, 5.4, 0, 0),
    }.items():
        parts.append(box(f"export_bay_dollar_{name}", (sx, sy, 0.06 if name != "stem" else 0.08), (x, y, z),
                         m["export_sign"]))
    return parts


def safehouse_door(m):
    # Roller garage door set in a wall: origin on the ground at the wall face; door faces game +Z,
    # with a lamp (material `lamp`, glows at night) over it.
    W, H = 3.2, 2.9
    parts = [
        box("safehouse_door_frame", (W + 0.4, 0.12, H + 0.25), (0, -0.03, (H + 0.25) / 2), m["dark"]),
        box("safehouse_door_door", (W, 0.08, H), (0, -0.1, H / 2), m["garage_door"]),
        box("safehouse_door_lampbracket", (0.08, 0.4, 0.08), (0, -0.2, H + 0.55), m["dark"]),
        box("safehouse_door_lamp", (0.5, 0.25, 0.14), (0, -0.4, H + 0.5), m["lamp"]),
        # The shade's top lit (seen from above, a dark one hid the lamp).
        box("safehouse_door_shade", (0.6, 0.35, 0.06), (0, -0.4, H + 0.6), m["lamp"]),
    ]
    for i in range(4):
        parts.append(box(f"safehouse_door_rib{i}", (W - 0.1, 0.04, 0.05), (0, -0.15, 0.5 + i * 0.65), m["pole"]))
    return parts


def frenzy_token(m):
    # Chunky floating '!' gem: origin at its centre (the game spins and bobs it). <= 120 tris.
    bar = hull("frenzy_token_bar", [(0, 0, 0.75), (0.22, 0, 0.45), (-0.22, 0, 0.45), (0, 0.22, 0.45),
                                    (0, -0.22, 0.45), (0.12, 0, -0.1), (-0.12, 0, -0.1), (0, 0.12, -0.1),
                                    (0, -0.12, -0.1), (0, 0, -0.22)], m["frenzy"])
    dot = hull("frenzy_token_dot", [(0, 0, -0.38), (0.15, 0, -0.53), (-0.15, 0, -0.53), (0, 0.15, -0.53),
                                    (0, -0.15, -0.53), (0, 0, -0.68)], m["frenzy"])
    return [bar, dot]


def traffic_cone(m):
    return [
        box("traffic_cone_base", (0.38, 0.38, 0.04), (0, 0, 0.02), m["cone_orange"]),
        cylinder("traffic_cone_body", 0.15, 0.66, (0, 0, 0.37), m["cone_orange"], verts=8, radius2=0.03),
        cylinder("traffic_cone_band", 0.113, 0.1, (0, 0, 0.36), m["white"], verts=8, radius2=0.093),
    ]


def road_barrier_long(m):
    # 4 m concrete jersey barrier along X: wide foot, sloped faces, narrow top; hazard band along the top.
    L = 4.0
    prof = [(-0.3, 0.0), (0.3, 0.0), (-0.3, 0.08), (0.3, 0.08), (-0.2, 0.3), (0.2, 0.3), (-0.1, 0.81), (0.1, 0.81)]
    parts = [hull("road_barrier_long_body", [(x, y, z) for x in (-L / 2, L / 2) for (y, z) in prof], m["concrete"])]
    parts.append(box("road_barrier_long_band", (L - 0.4, 0.21, 0.08), (0, 0, 0.77), m["hazard"]))
    return parts


# ---------------------------------------------------------------- street props, round 2 (§10)
# Low-tri: everything joins the one `street` family draw, and each copy in view runs its model's
# vertices, so faces nobody sees (undersides) are left out (open_box, prism, fan, strips).

def lamp_pyramid(name, x, y, z, size, m):
    """A small blinking warning lamp: a square pyramid (6 tris), reads from above."""
    h = size / 2
    return hull(name, [(x - h, y - h, z), (x + h, y - h, z), (x - h, y + h, z), (x + h, y + h, z),
                       (x, y, z + size * 0.9)], m["blink_amber"])


def traffic_barrel(m):
    o, w = m["barrier_orange"], m["white"]
    return [
        prism("traffic_barrel_drum", [(0, 0.28), (0.3, 0.3), (0.44, 0.3), (0.7, 0.3), (0.84, 0.29)], [o, w, o, w], o,
              verts=6),
        lamp_pyramid("traffic_barrel_lamp", 0, 0, 0.84, 0.18, m),
    ]


def work_barrier(m):
    # Long side along X; the face (game +Z) is Blender -Y.
    return [
        open_box("work_barrier_panel", (1.8, 0.16, 0.7), (0, 0, 0.47), m["barrier_orange"]),
        open_box("work_barrier_band", (1.82, 0.18, 0.18), (0, 0, 0.68), m["white"]),
        open_box("work_barrier_foot_l", (0.16, 0.5, 0.12), (-0.72, 0, 0.06), m["dark"]),
        open_box("work_barrier_foot_r", (0.16, 0.5, 0.12), (0.72, 0, 0.06), m["dark"]),
        lamp_pyramid("work_barrier_lamp", 0.78, 0, 0.82, 0.16, m),
    ]


def roadwork_sign(m):
    # A-frame: the face leans back from the front (Blender -Y), the dark back panel from +Y.
    tilt = 13.0
    front = rotate(open_box("roadwork_sign_face", (1.1, 0.05, 1.15), (0, -0.165, 0.6), m["roadwork_sign"]),
                   (-tilt, 0, 0), pivot=(0, -0.165, 0.6))
    band = rotate(open_box("roadwork_sign_band", (0.7, 0.03, 0.16), (0, -0.2, 0.78), m["sign_black"]),
                  (-tilt, 0, 0), pivot=(0, -0.165, 0.6))
    back = rotate(open_box("roadwork_sign_back", (1.1, 0.05, 1.15), (0, 0.165, 0.6), m["dark"]),
                  (tilt, 0, 0), pivot=(0, 0.165, 0.6))
    # From above it's two slivers: a bold amber ridge along the top.
    ridge = open_box("roadwork_sign_ridge", (1.14, 0.16, 0.08), (0, 0, 1.18), m["roadwork_sign"])
    return [front, band, back, ridge]


def steel_plate(m):
    # Lying flat over a trench, long side along Z (game), drawn only.
    return [open_box("steel_plate_plate", (1.6, 2.4, 0.04), (0, 0, 0.02), m["steel_plate"])]


def work_trench(m):
    # The cut on the +X side, the spoil heap on -X, both along the game's Z.
    parts = [open_box("work_trench_cut", (0.8, 3.6, 0.02), (0.3, 0, 0.01), m["trench"])]
    parts.append(hull("work_trench_spoil", [(-0.75, -1.5, 0), (-0.15, -1.5, 0), (-0.75, 1.5, 0), (-0.15, 1.5, 0),
                                             (-0.45, -1.2, 0.3), (-0.45, 1.1, 0.35)], m["spoil"]))
    parts.append(hull("work_trench_lump", [(-0.7, -0.4, 0), (-0.2, -0.4, 0), (-0.45, 0.3, 0), (-0.5, -0.1, 0.35)],
                      m["rubble_dark"]))
    return parts


def skip(m):
    # Sloped ends, yellow, rubble showing over the top; long side along the game's Z.
    y = m["skip_paint"]
    parts = [
        hull("skip_body", [(-0.75, -1.0, 0), (0.75, -1.0, 0), (-0.75, 1.0, 0), (0.75, 1.0, 0),
                           (-0.8, -1.3, 1.0), (0.8, -1.3, 1.0), (-0.8, 1.3, 1.0), (0.8, 1.3, 1.0)], y),
        open_box("skip_rubble", (1.4, 2.3, 0.06), (0, 0, 1.01), m["rubble"]),
        hull("skip_heap", [(-0.5, -0.6, 1.0), (0.4, -0.7, 1.0), (-0.4, 0.6, 1.0), (0.5, 0.5, 1.0), (0.05, -0.1, 1.3)],
             m["rubble"]),
        hull("skip_chunk", [(0.0, 0.2, 1.02), (0.55, 0.3, 1.02), (0.3, 0.9, 1.02), (0.3, 0.5, 1.3)], m["rubble_dark"]),
        hull("skip_chunk2", [(-0.55, -0.8, 1.02), (-0.15, -1.05, 1.02), (-0.2, -0.5, 1.02), (-0.35, -0.8, 1.22)],
             m["rubble_dark"]),
    ]
    for x in (-1, 1):  # lifting lugs on the sides
        parts.append(open_box(f"skip_lug{x:+d}", (0.12, 0.3, 0.2), (x * 0.82, 0, 0.75), m["dark"]))
    return parts


def mini_digger(m):
    # Tracks along Y, house and cab behind, boom and bucket out in front (Blender -Y) on the -X side.
    p = m["digger_paint"]
    parts = []
    for x in (-0.55, 0.55):
        parts.append(hull(f"mini_digger_track{x:+.0f}", [(x - 0.19, -0.7, 0), (x + 0.19, -0.7, 0), (x - 0.19, 1.3, 0),
                                                          (x + 0.19, 1.3, 0), (x - 0.19, -0.85, 0.4),
                                                          (x + 0.19, -0.85, 0.4), (x - 0.19, 1.45, 0.4),
                                                          (x + 0.19, 1.45, 0.4)], m["track"]))
    parts += [
        open_box("mini_digger_house", (1.3, 1.4, 0.75), (0, 0.35, 0.8), p),
        open_box("mini_digger_weight", (1.3, 0.3, 0.6), (0, 1.15, 0.75), p),
        open_box("mini_digger_cab", (0.85, 0.9, 0.85), (0.15, 0.5, 1.6), m["glass"]),
        open_box("mini_digger_roof", (0.95, 1.0, 0.08), (0.15, 0.5, 2.07), p),
    ]
    # Boom up and out from the house's front, then the arm down to the bucket on the ground.
    parts.append(rotate(box("mini_digger_boom", (0.22, 0.22, 1.1), (-0.35, -0.55, 1.35), p), (-50, 0, 0),
                        pivot=(-0.35, -0.55, 1.35)))
    parts.append(rotate(box("mini_digger_arm", (0.18, 0.18, 1.0), (-0.35, -1.2, 1.0), p), (25, 0, 0),
                        pivot=(-0.35, -1.2, 1.0)))
    parts.append(hull("mini_digger_bucket", [(-0.6, -1.15, 0.0), (-0.1, -1.15, 0.0), (-0.6, -1.45, 0.05),
                                              (-0.1, -1.45, 0.05), (-0.6, -1.1, 0.45), (-0.1, -1.1, 0.45),
                                              (-0.6, -1.4, 0.45), (-0.1, -1.4, 0.45)], m["dark"]))
    return parts


def portable_toilet(m):
    return [
        open_box("portable_toilet_body", (1.1, 1.1, 2.2), (0, 0, 1.1), m["toilet_blue"]),
        open_box("portable_toilet_door", (0.7, 0.03, 1.9), (0, -0.56, 1.0), m["toilet_door"]),
        open_box("portable_toilet_roof", (1.16, 1.16, 0.1), (0, 0, 2.25), m["toilet_roof"]),
        open_box("portable_toilet_vent", (0.14, 0.14, 0.2), (0.35, 0.35, 2.4), m["dark"]),
    ]


def food_cart_hotdog(m):
    # Serving side to the front (Blender -Y); the quartered umbrella is what reads from above.
    return [
        open_box("food_cart_hotdog_body", (1.6, 0.8, 0.6), (0, 0, 0.62), m["cart_steel"]),
        open_box("food_cart_hotdog_glass", (1.2, 0.04, 0.22), (0, -0.3, 1.03), m["glass"]),
        open_box("food_cart_hotdog_leg", (0.08, 0.5, 0.32), (0.7, 0, 0.16), m["dark"]),
        cylinder("food_cart_hotdog_wheel_l", 0.3, 0.06, (-0.5, -0.43, 0.3), m["dark"], verts=6, rotation=(90, 0, 0)),
        cylinder("food_cart_hotdog_wheel_r", 0.3, 0.06, (-0.5, 0.43, 0.3), m["dark"], verts=6, rotation=(90, 0, 0)),
        open_box("food_cart_hotdog_handle", (0.06, 0.6, 0.06), (0.9, 0, 0.95), m["pole"]),
        open_box("food_cart_hotdog_pole", (0.05, 0.05, 1.1), (0, 0, 1.47), m["pole"]),
        fan("food_cart_hotdog_umbrella", 1.0, 1.95, 0.25,
            lambda i: m["umbrella_red"] if (i // 2) % 2 == 0 else m["umbrella_yellow"], segs=8, spin=0.0),
    ]


def food_cart_coffee(m):
    return [
        open_box("food_cart_coffee_body", (1.5, 0.8, 0.75), (0, 0, 0.68), m["coffee_brown"]),
        cylinder("food_cart_coffee_wheel_l", 0.3, 0.06, (0.45, -0.43, 0.3), m["dark"], verts=6, rotation=(90, 0, 0)),
        cylinder("food_cart_coffee_wheel_r", 0.3, 0.06, (0.45, 0.43, 0.3), m["dark"], verts=6, rotation=(90, 0, 0)),
        open_box("food_cart_coffee_leg", (0.08, 0.5, 0.3), (-0.65, 0, 0.15), m["dark"]),
        cylinder("food_cart_coffee_urn", 0.14, 0.32, (-0.35, -0.1, 1.21), m["cart_steel"], verts=6),
        # Two posts at the back (Blender +Y) carrying the striped canopy.
        open_box("food_cart_coffee_post_l", (0.05, 0.05, 0.95), (-0.68, 0.32, 1.5), m["pole"]),
        open_box("food_cart_coffee_post_r", (0.05, 0.05, 0.95), (0.68, 0.32, 1.5), m["pole"]),
        strips("food_cart_coffee_canopy", -0.9, 0.9, [-0.6, -0.3, 0.0, 0.3, 0.6], 1.9, 2.0,
               [m["canopy_green"], m["canopy_cream"]]),
    ]


def fruit_stand(m):
    # Crates at the front (Blender -Y), an awning over the back half only.
    parts = [open_box("fruit_stand_table", (2.0, 1.0, 0.8), (0, 0, 0.4), m["wood"])]
    for i, c in enumerate(("fruit_red", "fruit_orange", "fruit_yellow", "fruit_green")):
        parts.append(open_box(f"fruit_stand_crate{i}", (0.46, 0.5, 0.22), (-0.72 + i * 0.48, -0.2, 0.91), m[c]))
    for x in (-1.0, 1.0):
        parts.append(open_box(f"fruit_stand_post{x:+.0f}", (0.05, 0.05, 1.2), (x, 0.45, 1.4), m["pole"]))
    parts.append(strips("fruit_stand_awning", -1.1, 1.1, [-0.05, 0.13, 0.31, 0.49, 0.7], 1.95, 2.05,
                        [m["awning_green"], m["white"]]))
    return parts


def bus_shelter(m):
    # Open to the road (Blender -Y). The game's walls: back y +0.33..+0.45, ends x ±1.6..±1.72.
    g = m["shelter_glass"]
    return [
        open_box("bus_shelter_back", (3.44, 0.06, 2.1), (0, 0.39, 1.15), g),
        open_box("bus_shelter_end_l", (0.06, 0.75, 2.1), (-1.66, 0.05, 1.15), g),
        open_box("bus_shelter_end_r", (0.08, 0.75, 2.1), (1.66, 0.05, 1.15), m["ad_panel"]),
        open_box("bus_shelter_bench", (2.2, 0.36, 0.06), (0, 0.22, 0.45), m["wood"]),
        open_box("bus_shelter_bench_leg_l", (0.06, 0.3, 0.42), (-0.9, 0.24, 0.21), m["dark"]),
        open_box("bus_shelter_bench_leg_r", (0.06, 0.3, 0.42), (0.9, 0.24, 0.21), m["dark"]),
        open_box("bus_shelter_post_l", (0.07, 0.07, 2.2), (-1.66, -0.31, 1.1), m["pole"]),
        open_box("bus_shelter_post_r", (0.07, 0.07, 2.2), (1.66, -0.31, 1.1), m["pole"]),
        open_box("bus_shelter_roof", (3.6, 0.95, 0.08), (0, 0.06, 2.24), m["shelter_roof"]),
        open_box("bus_shelter_stripe", (3.6, 0.18, 0.1), (0, -0.38, 2.25), m["stripe_bus"]),
        open_box("bus_shelter_flagpole", (0.07, 0.07, 2.55), (1.95, -0.32, 1.275), m["pole"]),
        open_box("bus_shelter_flag", (0.42, 0.12, 0.42), (1.95, -0.32, 2.51), m["stripe_bus"]),
    ]


def bike_rack(m):
    met = m["metal"]
    parts = [open_box("bike_rack_rail", (1.8, 0.08, 0.06), (0, 0, 0.03), met)]
    for i, x in enumerate((-0.62, 0.0, 0.62)):  # hoops along X: thin plates, lines from above
        parts.append(open_box(f"bike_rack_hoop{i}", (0.5, 0.05, 0.8), (x, 0, 0.4), met))
    # One bike locked to it, in front (Blender -Y): wheels and frame are thin plates.
    parts += [
        open_box("bike_rack_bike_frame", (1.1, 0.06, 0.35), (0.1, -0.14, 0.58), m["bike_frame"]),
        open_box("bike_rack_bike_wheel_f", (0.62, 0.04, 0.62), (0.62, -0.14, 0.31), m["dark"]),
        open_box("bike_rack_bike_wheel_b", (0.62, 0.04, 0.62), (-0.42, -0.14, 0.31), m["dark"]),
        open_box("bike_rack_bike_bars", (0.06, 0.5, 0.05), (0.62, -0.14, 0.92), m["dark"]),
    ]
    return parts


def planter(m):
    return [
        open_box("planter_trough", (1.2, 0.7, 0.5), (0, 0, 0.25), m["concrete"]),
        hull("planter_shrub", [(-0.5, -0.25, 0.48), (0.2, -0.27, 0.48), (-0.45, 0.25, 0.48), (0.25, 0.24, 0.48),
                               (-0.15, 0.0, 0.92), (-0.4, -0.05, 0.8), (0.05, 0.15, 0.85)], m["leaf"]),
        hull("planter_flowers", [(0.15, -0.2, 0.5), (0.55, -0.2, 0.5), (0.15, 0.2, 0.5), (0.55, 0.2, 0.5),
                                 (0.35, 0.0, 0.72)], m["flowers"]),
    ]


def parking_meter(m):
    return [
        open_box("parking_meter_pole", (0.07, 0.07, 1.0), (0, 0, 0.5), m["meter"]),
        open_box("parking_meter_head", (0.22, 0.16, 0.36), (0, 0, 1.18), m["meter"]),
        open_box("parking_meter_window", (0.14, 0.02, 0.1), (0, -0.08, 1.26), m["glass"]),
        open_box("parking_meter_cap", (0.24, 0.18, 0.05), (0, 0, 1.385), m["meter_cap"]),
    ]


def recycling_bin(m):
    return [
        open_box("recycling_bin_body", (0.6, 0.6, 0.92), (0, 0, 0.46), m["recycle_blue"]),
        open_box("recycling_bin_lid", (0.64, 0.64, 0.06), (0, 0, 0.95), m["recycle_lid"]),
        open_box("recycling_bin_slot", (0.4, 0.1, 0.015), (0, -0.08, 0.985), m["white"]),
        open_box("recycling_bin_badge", (0.24, 0.02, 0.24), (0, -0.305, 0.6), m["white"]),
    ]


def cafe_table(m):
    parts = [
        open_box("cafe_table_pole", (0.05, 0.05, 2.05), (0, 0, 1.025), m["pole"]),
        open_box("cafe_table_top", (0.7, 0.7, 0.04), (0, 0, 0.74), m["white"]),
    ]
    for x in (-1, 1):  # a chair either side along X, backs outward
        parts.append(open_box(f"cafe_table_seat{x:+d}", (0.4, 0.4, 0.05), (x * 0.6, 0, 0.45), m["dark"]))
        parts.append(open_box(f"cafe_table_back{x:+d}", (0.05, 0.4, 0.85), (x * 0.78, 0, 0.425), m["dark"]))
    parts.append(fan("cafe_table_umbrella", 0.85, 1.95, 0.2,
                     lambda i: m["umbrella_cream"] if (i // 2) % 2 == 0 else m["paint"], segs=8))
    return parts


def vending_machine(m):
    return [
        open_box("vending_machine_body", (1.0, 0.8, 1.85), (0, 0, 0.925), m["paint"]),
        open_box("vending_machine_panel", (0.65, 0.02, 1.1), (-0.1, -0.41, 1.15), m["ad_panel"]),
        open_box("vending_machine_slot", (0.2, 0.02, 0.5), (0.33, -0.41, 1.1), m["dark"]),
        open_box("vending_machine_top", (0.9, 0.22, 0.03), (0, -0.12, 1.865), m["white"]),
    ]


def atm(m):
    return [
        open_box("atm_body", (0.8, 0.6, 1.7), (0, 0, 0.85), m["atm_body"]),
        open_box("atm_screen", (0.45, 0.02, 0.35), (0, -0.31, 1.18), m["screen"]),
        open_box("atm_shelf", (0.6, 0.18, 0.05), (0, -0.38, 0.95), m["dark"]),
        open_box("atm_stripe", (0.84, 0.64, 0.12), (0, 0, 1.76), m["stripe_atm"]),
    ]


def shopping_cart(m):
    # The handle at the back (game -Z, Blender +Y).
    return [
        hull("shopping_cart_basket", [(-0.25, -0.4, 0.4), (0.25, -0.4, 0.4), (-0.27, 0.42, 0.4), (0.27, 0.42, 0.4),
                                      (-0.27, -0.45, 0.9), (0.27, -0.45, 0.9), (-0.28, 0.45, 0.9),
                                      (0.28, 0.45, 0.9)], m["metal"]),
        open_box("shopping_cart_base", (0.45, 0.75, 0.12), (0, 0, 0.14), m["dark"]),
        open_box("shopping_cart_handle", (0.55, 0.06, 0.06), (0, 0.48, 0.97), m["cart_red"]),
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
    "start_gantry": start_gantry, "export_bay": export_bay, "safehouse_door": safehouse_door,
    "frenzy_token": frenzy_token, "traffic_cone": traffic_cone, "road_barrier_long": road_barrier_long,
    # Street props, round 2 (§10).
    "traffic_barrel": traffic_barrel, "work_barrier": work_barrier, "roadwork_sign": roadwork_sign,
    "steel_plate": steel_plate, "work_trench": work_trench, "skip": skip, "mini_digger": mini_digger,
    "portable_toilet": portable_toilet, "food_cart_hotdog": food_cart_hotdog, "food_cart_coffee": food_cart_coffee,
    "fruit_stand": fruit_stand, "bus_shelter": bus_shelter, "bike_rack": bike_rack, "planter": planter,
    "parking_meter": parking_meter, "recycling_bin": recycling_bin, "cafe_table": cafe_table,
    "vending_machine": vending_machine, "atm": atm, "shopping_cart": shopping_cart,
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
