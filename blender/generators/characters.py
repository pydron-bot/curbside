"""Low-poly characters with rigid-part animation.

Each body part is its own mesh parented to an armature bone (no skinning), so
the GLB stays tiny and animation is cheap: top-down, a ped mostly reads as
head + shoulders, with swinging arms and legs showing at the sides.

One GLB per body (the game's CharacterBatch merges every mesh in a file into
one person, so each body is one more batch / draw call):
  player.glb    the player (yellow jacket)
  ped_slim.glb  tall and narrow, with a backpack
  ped_stocky.glb broad, with a baseball cap
  ped_coat.glb  long coat / dress silhouette
  cop.glb       peaked cap, short sleeves, duty belt and holster

All share the same bone names and clips (glTF animation names):
  Idle 2 s loop, Walk 1 s loop, Run 0.625 s loop, Punch 0.333 s, Aim 0.292 s
  hold, AimBoth (two-handed), Shoot 0.125 s, ShootBoth, Fall 0.5 s, Down 1 s
  loop, GetUp 0.917 s, EnterCar 0.5 s, Arrested 1 s loop (kneeling, hands on head),
  Throw 0.417 s, AimRocket 0.292 s hold, ShootRocket 0.208 s, Punch2 0.333 s (left hook),
  Uppercut 0.417 s, Stagger 0.292 s, Hail / Cower / Cheer 1 s loops, Ride 1 s loop (hips at 0.75 m).
Story bodies for the payphone missions: vex.glb, tuna.glb, pike.glb.
Every clip keys every bone, so any clip can be played or crossfaded alone.
The game scales Walk/Run playback with speed; `walkSpeed` / `runSpeed` (the
ground speeds the cycles are authored for) are exported as custom properties.
"""
from pathlib import Path

import bmesh
import bpy

from lib.common import (
    box,
    export_glb,
    ico,
    key_location,
    key_rotation,
    material,
    new_action,
    parent_to_bone,
    render_thumbnail,
    cylinder,
    reset_scene,
    shade_flat,
)

THUMBS = Path(__file__).resolve().parents[1] / "thumbs"

# Metres per second the cycles match (Walk: 1.6 m per 1 s; Run: 3.44 m per 0.625 s).
WALK_SPEED = 1.6
RUN_SPEED = 5.5
FPS = 24
RIDE_HIP_Z = 0.75  # hip height in the Ride clip, above the character's root (= the vehicles' `<arch>_seat` empties)
BONES = ("root", "hips", "chest", "head", "arm.L", "arm.R", "leg.L", "leg.R")

PLAYER = {
    "skin": (224, 172, 132),
    "hair": (40, 28, 22),
    "shirt": (230, 196, 60),  # yellow jacket: easy to spot from above
    "pants": (52, 62, 92),
    "shoes": (30, 30, 30),
}

# Default colours only: the game recolours every person through a palette.
BODIES = {
    "player": dict(rig="Player", palette=PLAYER),
    "ped_slim": dict(
        rig="ped_slim", height=1.06, shoulders=0.88, depth=0.9, limbs=0.85, backpack=True,
        palette={"skin": (190, 140, 105), "hair": (25, 20, 18), "shirt": (70, 130, 170),
                 "pants": (60, 60, 64), "shoes": (200, 60, 50)},
    ),
    "ped_stocky": dict(
        rig="ped_stocky", height=0.95, shoulders=1.18, depth=1.2, limbs=1.2, belly=True, cap=True,
        palette={"skin": (140, 95, 70), "hair": (180, 40, 40), "shirt": (90, 150, 80),
                 "pants": (120, 100, 70), "shoes": (40, 34, 30)},
    ),
    "ped_coat": dict(
        rig="ped_coat", height=1.0, shoulders=0.92, depth=0.95, limbs=0.9, coat=True, long_hair=True,
        palette={"skin": (236, 190, 160), "hair": (120, 70, 40), "shirt": (150, 60, 90),
                 "pants": (40, 40, 48), "shoes": (25, 25, 25)},
    ),
    # Cap crown uses the hair slot (the game sets it navy); brim, belt and holster use shoes.
    "cop": dict(
        rig="cop", height=1.02, shoulders=1.05, depth=1.05, limbs=1.05, police=True,
        palette={"skin": (205, 150, 115), "hair": (28, 36, 70), "shirt": (60, 80, 130),
                 "pants": (28, 36, 70), "shoes": (18, 18, 20)},
    ),
    # Story characters (payphone missions). Built to read as different silhouettes from above.
    # Vex: overalls (bib and straps in the pants slot) over a tee, tool belt with side pouches (shoes).
    "vex": dict(
        rig="vex", height=0.98, shoulders=1.0, depth=1.0, limbs=1.0, short_hair=True, overalls=True, toolbelt=True,
        palette={"skin": (176, 120, 88), "hair": (230, 120, 40), "shirt": (220, 220, 210),
                 "pants": (60, 90, 140), "shoes": (70, 50, 34)},
    ),
    # Lil' Tuna: short and wide, hoodie with the hood down (shirt), big headphones (shoes slot).
    "tuna": dict(
        rig="tuna", height=0.86, shoulders=1.25, depth=1.2, limbs=1.2, belly=True, short_hair=True, hood=True,
        headphones=True,
        palette={"skin": (120, 84, 60), "hair": (20, 18, 16), "shirt": (240, 120, 160),
                 "pants": (50, 56, 70), "shoes": (30, 200, 190)},
    ),
    # Deacon Pike: tall, ankle-length coat over a suit (coat = shirt, suit = pants), raised collar, slicked hair.
    "pike": dict(
        rig="pike", height=1.06, shoulders=1.05, depth=1.0, limbs=0.95, slick_hair=True, long_coat=True,
        palette={"skin": (226, 196, 176), "hair": (30, 30, 34), "shirt": (34, 34, 40),
                 "pants": (70, 26, 34), "shoes": (16, 16, 18)},
    ),
}


class Dims:
    """Joint heights for one body; height scales the skeleton, the rest scale widths."""

    def __init__(self, spec):
        h = spec.get("height", 1.0)
        self.hip_z = 0.92 * h
        self.shoulder_z = 1.42 * h
        self.neck_z = 1.5 * h
        self.sw = spec.get("shoulders", 1.0)  # shoulder / torso width
        self.dp = spec.get("depth", 1.0)  # torso depth
        self.lw = spec.get("limbs", 1.0)  # limb thickness
        self.arm_x = 0.27 * self.sw


def build_armature(name, d):
    arm_data = bpy.data.armatures.new(f"{name}_rig")
    rig = bpy.data.objects.new(name, arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(bname, head, tail, parent=None):
        b = eb.new(bname)
        b.head, b.tail = head, tail
        b.roll = 0
        if parent:
            b.parent = eb[parent]
        return b

    bone("root", (0, 0, 0), (0, 0, 0.3))
    bone("hips", (0, 0, d.hip_z), (0, 0, d.hip_z + 0.2), "root")
    bone("chest", (0, 0, d.hip_z + 0.2), (0, 0, d.neck_z), "hips")
    bone("head", (0, 0, d.neck_z), (0, 0, d.neck_z + 0.3), "chest")
    for side, x in (("L", 1), ("R", -1)):
        bone(f"arm.{side}", (d.arm_x * x, 0, d.shoulder_z), ((d.arm_x + 0.02) * x, 0, d.shoulder_z - 0.62), "chest")
        bone(f"leg.{side}", (0.11 * x, 0, d.hip_z), (0.11 * x, 0, 0.06), "hips")
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def frustum(name, bottom, top, z0, z1, mat, sides=6, y_off=0.0):
    """Closed tapered prism: `bottom`/`top` are (half-width x, half-depth y)."""
    import math

    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for (rx, ry), z in ((bottom, z0), (top, z1)):
        ring = []
        for i in range(sides):
            a = 2 * math.pi * (i + 0.5) / sides
            ring.append(bm.verts.new((rx * math.cos(a), ry * math.sin(a) + y_off, z)))
        rings.append(ring)
    lo, hi = rings
    bm.faces.new(list(reversed(lo)))
    bm.faces.new(hi)
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    shade_flat(obj)
    return obj


def build_body(rig, spec, name, d):
    palette = spec["palette"]
    skin = material(f"{name}_skin", palette["skin"])
    hair = material(f"{name}_hair", palette["hair"], 0.9)
    shirt = material(f"{name}_shirt", palette["shirt"])
    pants = material(f"{name}_pants", palette["pants"])
    shoes = material(f"{name}_shoes", palette["shoes"])

    parts = []

    def attach(obj, bone_name):
        parent_to_bone(obj, rig, bone_name)
        parts.append(obj)

    sw, dp, lw = d.sw, d.dp, d.lw
    torso_h = d.shoulder_z - d.hip_z
    torso_mid = d.hip_z + 0.03 + torso_h / 2
    # Torso: broad shoulders, narrower waist. Blender -Y is the character's front.
    if spec.get("belly"):
        attach(frustum(f"{name}_torso", (0.27 * sw, 0.17 * dp), (0.26 * sw, 0.14 * dp),
                       d.hip_z + 0.03, d.shoulder_z + 0.03, shirt, sides=8, y_off=-0.01), "chest")
    else:
        attach(box(f"{name}_torso", (0.5 * sw, 0.28 * dp, torso_h), (0, 0, torso_mid), shirt, bevel=0.04), "chest")
    attach(box(f"{name}_pelvis", (0.36 * sw, 0.24 * dp, 0.2), (0, 0, d.hip_z + 0.02), pants, bevel=0.03), "hips")
    attach(ico(f"{name}_head", 0.13, (0, 0, d.neck_z + 0.13), skin, subdiv=2, scale=(1, 1.05, 1.1)), "head")
    # Nose nub so facing direction reads from above.
    attach(box(f"{name}_nose", (0.04, 0.05, 0.05), (0, -0.135, d.neck_z + 0.12), skin), "head")

    if spec.get("police"):
        # Peaked cap: crown (hair slot, set navy by the game), a black brim and a silver band
        # (fixed-colour badge slot) that sets officers apart from above at night.
        badge = material(f"{name}_badge", (214, 218, 226), 0.4)
        attach(frustum(f"{name}_cap", (0.135, 0.14), (0.16, 0.17), d.neck_z + 0.2, d.neck_z + 0.3, hair, sides=8),
               "head")
        attach(box(f"{name}_brim", (0.22, 0.12, 0.025), (0, -0.14, d.neck_z + 0.205), shoes), "head")
        attach(box(f"{name}_capband", (0.28, 0.29, 0.035), (0, 0, d.neck_z + 0.215), badge), "head")
        attach(box(f"{name}_badge", (0.07, 0.03, 0.08), (0.12 * sw, -0.14 * dp - 0.01, d.shoulder_z - 0.1), badge),
               "chest")
    elif spec.get("short_hair"):
        attach(ico(f"{name}_hair", 0.145, (0, 0.02, d.neck_z + 0.2), hair, subdiv=1, scale=(1, 1.05, 0.62)), "head")
    elif spec.get("slick_hair"):
        attach(ico(f"{name}_hair", 0.145, (0, 0.04, d.neck_z + 0.2), hair, subdiv=1, scale=(0.98, 1.12, 0.55)),
               "head")
    elif spec.get("cap"):
        attach(ico(f"{name}_hair", 0.14, (0, 0.02, d.neck_z + 0.18), hair, subdiv=1, scale=(1, 1.05, 0.7)), "head")
        attach(box(f"{name}_peak", (0.2, 0.14, 0.025), (0, -0.16, d.neck_z + 0.2), hair), "head")
    else:
        attach(ico(f"{name}_hair", 0.14, (0, 0.025, d.neck_z + 0.18), hair, subdiv=2, scale=(1, 1.05, 0.75)),
               "head")
    if spec.get("long_hair"):
        attach(box(f"{name}_hairback", (0.26, 0.1, 0.3), (0, 0.1, d.neck_z + 0.02), hair), "head")

    if spec.get("backpack"):
        attach(box(f"{name}_backpack", (0.34 * sw, 0.16, 0.4), (0, 0.14 * dp + 0.08, torso_mid + 0.04), pants, 0.04),
               "chest")
    if spec.get("coat"):
        # Long coat / dress: an A-line skirt off the hips down to the knees.
        attach(frustum(f"{name}_coat", (0.27 * sw, 0.19 * dp), (0.22 * sw, 0.155 * dp),
                       d.hip_z - 0.5, d.hip_z + 0.11, shirt, sides=8), "hips")
    if spec.get("overalls"):
        attach(box(f"{name}_bib", (0.34 * sw, 0.03, 0.34), (0, -0.14 * dp - 0.015, d.hip_z + 0.24), pants), "chest")
        for x in (-1, 1):
            attach(box(f"{name}_strap{x:+d}", (0.06, 0.3 * dp, 0.03), (x * 0.13 * sw, 0, d.shoulder_z + 0.02), pants),
                   "chest")
    if spec.get("toolbelt"):
        attach(box(f"{name}_toolbelt", (0.4 * sw, 0.27 * dp, 0.07), (0, 0, d.hip_z + 0.06), shoes), "hips")
        for x in (-1, 1):
            attach(box(f"{name}_pouch{x:+d}", (0.1, 0.16, 0.18), (x * (0.2 * sw + 0.05), -0.02, d.hip_z - 0.02), shoes),
                   "hips")
    if spec.get("hood"):
        attach(box(f"{name}_hood", (0.3 * sw, 0.14, 0.2), (0, 0.15 * d.dp + 0.04, d.shoulder_z + 0.05), shirt, 0.03),
               "chest")
    if spec.get("headphones"):
        for x in (-1, 1):
            attach(cylinder(f"{name}_earcup{x:+d}", 0.075, 0.07, (x * 0.155, 0, d.neck_z + 0.13), shoes, verts=6,
                            rotation=(0, 90, 0)), "head")
        attach(box(f"{name}_headband", (0.33, 0.05, 0.04), (0, 0, d.neck_z + 0.27), shoes), "head")
    if spec.get("long_coat"):
        # Ankle-length coat flaring out below the hips, and a raised collar.
        attach(frustum(f"{name}_coat", (0.32 * sw, 0.22 * dp), (0.23 * sw, 0.155 * dp),
                       0.14, d.hip_z + 0.11, shirt, sides=8), "hips")
        attach(box(f"{name}_collar", (0.4 * sw, 0.1, 0.16), (0, 0.11 * dp, d.shoulder_z + 0.06), shirt), "chest")
    if spec.get("police"):
        attach(box(f"{name}_belt", (0.38 * sw, 0.26 * dp, 0.07), (0, 0, d.hip_z + 0.1), shoes), "hips")
        attach(box(f"{name}_holster", (0.07, 0.12, 0.2), (-0.22 * sw, 0, d.hip_z - 0.02), shoes), "hips")

    for side, x in (("L", 1), ("R", -1)):
        ax = (d.arm_x + 0.04) * x
        if spec.get("police"):
            # Short sleeves: shirt to mid upper arm, bare forearm below.
            attach(box(f"{name}_sleeve.{side}", (0.13 * lw, 0.14 * lw, 0.2), (ax, 0, d.shoulder_z - 0.1), shirt, 0.02),
                   f"arm.{side}")
            attach(box(f"{name}_arm.{side}", (0.1 * lw, 0.11 * lw, 0.32), (ax, 0, d.shoulder_z - 0.36), skin),
                   f"arm.{side}")
        else:
            attach(box(f"{name}_arm.{side}", (0.12 * lw, 0.13 * lw, 0.5), (ax, 0, d.shoulder_z - 0.27), shirt, 0.03),
                   f"arm.{side}")
        attach(box(f"{name}_hand.{side}", (0.09, 0.1, 0.1), (ax + 0.01 * x, 0, d.shoulder_z - 0.58), skin), f"arm.{side}")
        leg_h = d.hip_z - 0.1
        attach(box(f"{name}_leg.{side}", (0.15 * lw, 0.17 * lw, leg_h), (0.11 * x, 0, 0.09 + leg_h / 2), pants, 0.03),
               f"leg.{side}")
        attach(box(f"{name}_shoe.{side}", (0.14, 0.26, 0.09), (0.11 * x, -0.04, 0.045), shoes, 0.02), f"leg.{side}")
    return parts


# ---------------------------------------------------------------- animation

def key_pose(rig, frame, pose, root_loc=(0.0, 0.0, 0.0)):
    """Key every bone at `frame`: pose maps bone → (x, y, z) degrees; missing bones rest.

    Bone-local axes (all bones have roll 0): for the upright bones (root, hips,
    chest, head) +x tips forward, +y turns the right shoulder forward and +z
    leans to the character's right. For the hanging bones (arms, legs) -x
    swings forward; -z on arm.L / +z on arm.R lifts the arm out to the side.
    `root_loc` is in the root bone's rest frame: +y is up, +z is forward.
    """
    for b in BONES:
        x, y, z = pose.get(b, (0, 0, 0))
        key_rotation(rig, b, frame, x=x, y=y, z=z)
    key_location(rig, "root", frame, root_loc)


def mirror(pose):
    """Swap left and right (for the second half of a gait cycle)."""
    out = {}
    for b, (x, y, z) in pose.items():
        if b.endswith(".L"):
            out[b[:-2] + ".R"] = (x, -y, -z)
        elif b.endswith(".R"):
            out[b[:-2] + ".L"] = (x, -y, -z)
        else:
            out[b] = (x, -y, -z)
    return out


def gait(rig, name, frames, contact, passing, contact_drop, passing_lift):
    """Symmetric loop: contact, passing, mirrored contact, mirrored passing, contact."""
    new_action(rig, name)
    q = frames / 4
    for i, (pose, lift) in enumerate((
        (contact, -contact_drop), (passing, passing_lift),
        (mirror(contact), -contact_drop), (mirror(passing), passing_lift), (contact, -contact_drop),
    )):
        key_pose(rig, i * q, pose, (0, lift, 0))


# Common poses.
STAND = {}
AIM = {"arm.R": (-88, 0, 4), "arm.L": (-8, 0, -6), "chest": (0, 16, 0), "head": (0, -16, 0)}
AIM_BOTH = {"arm.R": (-84, 0, -14), "arm.L": (-80, 0, 18), "chest": (2, 14, 0), "head": (0, -14, 0)}
DOWN_LIFT = 0.15  # root raise so the back rests on the ground, not through it
DOWN = {"root": (-90, 0, 0), "arm.L": (0, 0, -30), "arm.R": (0, 0, 30), "leg.L": (0, 0, -6), "leg.R": (0, 0, 6),
        "head": (8, 0, 0)}


def animate(rig, d):
    # --- Walk: 1 s cycle. Legs and arms swing in opposition; shoulders turn. ---
    gait(rig, "Walk", FPS,
         contact={"leg.L": (32, 0, 0), "leg.R": (-32, 0, 0), "arm.L": (-24, 0, 0), "arm.R": (24, 0, 0),
                  "chest": (0, -6, 0)},
         passing={"leg.L": (0, 0, 0), "leg.R": (0, 0, 0), "chest": (0, 0, 0)},
         contact_drop=0.04, passing_lift=0.0)

    # --- Run: 0.625 s sprint, forward lean, arms pumping high, airborne at passing. ---
    gait(rig, "Run", 15,
         contact={"hips": (8, 0, 0), "chest": (8, -10, 0), "head": (-10, 8, 0),
                  "leg.L": (50, 0, 0), "leg.R": (-46, 0, 0), "arm.L": (-55, 0, 8), "arm.R": (45, 0, 0)},
         passing={"hips": (8, 0, 0), "chest": (8, 0, 0), "head": (-10, 0, 0),
                  "leg.L": (-8, 0, 0), "leg.R": (-8, 0, 0), "arm.L": (-5, 0, -5), "arm.R": (-5, 0, 5)},
         contact_drop=0.07, passing_lift=0.05)

    # --- Idle: 2 s breathing loop. ---
    new_action(rig, "Idle")
    for i, (chest, arm) in enumerate(((0, 4), (2, 6), (0, 4))):
        key_pose(rig, i * FPS, {"chest": (-chest, 0, 0), "arm.L": (0, 0, -arm), "arm.R": (0, 0, arm)})

    # --- Punch: 0.333 s right jab: wind up, extend (shoulder turns in), recover. ---
    new_action(rig, "Punch")
    guard = {"arm.L": (-35, 0, 0), "arm.R": (-20, 0, 0)}
    key_pose(rig, 0, STAND)
    key_pose(rig, 2, {**guard, "arm.R": (15, 0, 0), "chest": (0, -14, 0), "head": (0, 10, 0)})
    key_pose(rig, 4, {**guard, "arm.R": (-92, 0, -6), "chest": (6, 24, 0), "head": (0, -18, 0),
                      "hips": (0, 6, 0)}, (0, -0.02, 0.06))
    key_pose(rig, 5, {**guard, "arm.R": (-88, 0, -6), "chest": (6, 22, 0), "head": (0, -16, 0),
                      "hips": (0, 6, 0)}, (0, -0.02, 0.06))
    key_pose(rig, 8, STAND)

    # --- Aim: held pose (0.292 s loop with a tiny sway). AimBoth: two-handed guns. ---
    for clip, pose in (("Aim", AIM), ("AimBoth", AIM_BOTH)):
        new_action(rig, clip)
        key_pose(rig, 0, pose)
        sway = {b: (x + (1.5 if b.startswith("arm") else 0), y, z) for b, (x, y, z) in pose.items()}
        key_pose(rig, 3.5, sway)
        key_pose(rig, 7, pose)

    # --- Shoot: 0.125 s recoil kick from the aim pose, back to it. ---
    for clip, pose in (("Shoot", AIM), ("ShootBoth", AIM_BOTH)):
        new_action(rig, clip)
        kick = {b: (x - (14 if b.startswith("arm") else 0), y, z) for b, (x, y, z) in pose.items()}
        kick["chest"] = (pose["chest"][0] - 5, *pose["chest"][1:])
        key_pose(rig, 0, pose)
        key_pose(rig, 1, kick, (0, 0, -0.03))
        key_pose(rig, 3, pose)

    # --- Fall: 0.5 s knocked backwards, ending flat on the back (head behind the feet). ---
    new_action(rig, "Fall")
    key_pose(rig, 0, STAND)
    key_pose(rig, 3, {"root": (-12, 0, 0), "chest": (-22, 0, 0), "head": (20, 0, 0),
                      "arm.L": (-70, 0, -40), "arm.R": (-70, 0, 40), "leg.L": (-15, 0, 0)})
    key_pose(rig, 7, {"root": (-55, 0, 0), "chest": (-15, 0, 0), "head": (25, 0, 0),
                      "arm.L": (-120, 0, -45), "arm.R": (-120, 0, 45), "leg.L": (-25, 0, 0), "leg.R": (-10, 0, 0)},
             (0, 0.08, 0))
    key_pose(rig, 10, {**DOWN, "root": (-94, 0, 0), "head": (14, 0, 0), "leg.L": (-18, 0, -6),
                       "leg.R": (-12, 0, 6)}, (0, DOWN_LIFT, 0))
    key_pose(rig, 12, DOWN, (0, DOWN_LIFT, 0))

    # --- Down: 1 s loop lying on the back, breathing. ---
    new_action(rig, "Down")
    breathe = {**DOWN, "chest": (-3, 0, 0), "head": (11, 0, 0)}
    key_pose(rig, 0, DOWN, (0, DOWN_LIFT, 0))
    key_pose(rig, 12, breathe, (0, DOWN_LIFT, 0))
    key_pose(rig, 24, DOWN, (0, DOWN_LIFT, 0))

    # --- GetUp: 0.917 s from Down: sit up, then pivot up over the feet (no knees to tuck). ---
    new_action(rig, "GetUp")
    key_pose(rig, 0, DOWN, (0, DOWN_LIFT, 0))
    key_pose(rig, 6, {"root": (-90, 0, 0), "chest": (75, 0, 0), "head": (5, 0, 0),
                      "arm.L": (-10, 0, -25), "arm.R": (-10, 0, 25)}, (0, DOWN_LIFT, 0))
    key_pose(rig, 12, {"root": (-55, 0, 0), "chest": (70, 0, 0), "head": (-10, 0, 0),
                       "arm.L": (-50, 0, -15), "arm.R": (-50, 0, 15)}, (0, 0.08, 0))
    key_pose(rig, 17, {"root": (-18, 0, 0), "chest": (30, 0, 0), "head": (-5, 0, 0),
                       "arm.L": (-25, 0, -8), "arm.R": (-25, 0, 8)}, (0, 0.0, 0))
    key_pose(rig, 22, STAND)

    # --- EnterCar: 0.5 s reach for the door and duck in (the game hides the body at the end). ---
    new_action(rig, "EnterCar")
    key_pose(rig, 0, STAND)
    key_pose(rig, 5, {"arm.R": (-70, 0, -10), "arm.L": (-15, 0, 0), "chest": (15, 10, 0)}, (0, 0, 0.1))
    key_pose(rig, 12, {"hips": (25, 0, 0), "chest": (30, 10, 0), "head": (15, 0, 0),
                       "arm.R": (-50, 0, -5), "arm.L": (-40, 0, 0), "leg.L": (-25, 0, 0), "leg.R": (-50, 0, 0)},
             (0, -0.15, 0.3))

    # --- Arrested: 1 s loop kneeling, hands behind the head (BUSTED). No knees, so the
    # hips drop and the straight legs sweep back to lie along the ground behind. ---
    new_action(rig, "Arrested")
    kneel = {"hips": (-6, 0, 0), "chest": (4, 0, 0), "head": (12, 0, 0),
             "leg.L": (72, 0, -4), "leg.R": (72, 0, 4), "arm.L": (-198, 0, -48), "arm.R": (-198, 0, 48)}
    sag = {**kneel, "chest": (8, 0, 0), "head": (16, 0, 0), "arm.L": (-194, 0, -50), "arm.R": (-194, 0, 50)}
    key_pose(rig, 0, kneel, (0, -0.56, 0))
    key_pose(rig, 12, sag, (0, -0.57, 0))
    key_pose(rig, 24, kneel, (0, -0.56, 0))

    # ---------------- second round (§8) ----------------
    # --- Throw: 0.417 s overhand (grenade, molotov); release at frame 5.5 (~55%). ---
    new_action(rig, "Throw")
    key_pose(rig, 0, STAND)
    key_pose(rig, 3, {"arm.R": (-200, 0, 20), "arm.L": (-60, 0, 0), "chest": (-8, -25, 0), "head": (0, 20, 0)},
             (0, 0, -0.05))
    key_pose(rig, 5.5, {"arm.R": (-110, 0, 0), "arm.L": (-10, 0, 0), "chest": (12, 25, 0), "head": (0, -18, 0)},
             (0, 0, 0.05))
    key_pose(rig, 8, {"arm.R": (-40, 0, -10), "chest": (15, 20, 0), "head": (0, -12, 0)}, (0, 0, 0.05))
    key_pose(rig, 10, STAND)

    # --- AimRocket: 0.292 s hold, launcher on the right shoulder. ShootRocket: 0.208 s heavy kick. ---
    aim_rocket = {"arm.R": (-55, 0, -18), "arm.L": (-80, 0, 22), "chest": (0, 18, 0), "head": (8, -18, 10)}
    new_action(rig, "AimRocket")
    key_pose(rig, 0, aim_rocket)
    key_pose(rig, 3.5, {**aim_rocket, "chest": (1, 18, 0)})
    key_pose(rig, 7, aim_rocket)
    new_action(rig, "ShootRocket")
    key_pose(rig, 0, aim_rocket)
    key_pose(rig, 1, {"arm.R": (-43, 0, -18), "arm.L": (-68, 0, 22), "chest": (-14, 18, 0), "head": (-5, -18, 10),
                      "leg.L": (10, 0, 0)}, (0, 0, -0.12))
    key_pose(rig, 5, aim_rocket)

    # --- Punch2: 0.333 s left hook (second hit of the combo). ---
    new_action(rig, "Punch2")
    key_pose(rig, 0, STAND)
    key_pose(rig, 2, {"arm.L": (-40, 0, -60), "arm.R": (-35, 0, 0), "chest": (0, 18, 0), "head": (0, -12, 0)})
    key_pose(rig, 4, {"arm.L": (-88, 0, 35), "arm.R": (-35, 0, 0), "chest": (6, -26, 0), "head": (0, 16, 0),
                      "hips": (0, -6, 0)}, (0, -0.02, 0.05))
    key_pose(rig, 5, {"arm.L": (-86, 0, 38), "arm.R": (-35, 0, 0), "chest": (6, -24, 0), "head": (0, 15, 0),
                      "hips": (0, -6, 0)}, (0, -0.02, 0.05))
    key_pose(rig, 8, STAND)

    # --- Uppercut: 0.417 s right uppercut (third hit): dip, drive up, recover. ---
    new_action(rig, "Uppercut")
    key_pose(rig, 0, STAND)
    key_pose(rig, 3, {"arm.R": (15, 0, 0), "arm.L": (-35, 0, 0), "chest": (12, -10, 0), "head": (-8, 8, 0)},
             (0, -0.08, 0))
    key_pose(rig, 5, {"arm.R": (-160, 0, -10), "arm.L": (-30, 0, 0), "chest": (-12, 20, 0), "head": (-6, -14, 0)},
             (0, 0.04, 0.06))
    key_pose(rig, 6, {"arm.R": (-158, 0, -10), "arm.L": (-30, 0, 0), "chest": (-12, 20, 0), "head": (-6, -14, 0)},
             (0, 0.04, 0.06))
    key_pose(rig, 10, STAND)

    # --- Stagger: 0.292 s rocked back by a hit, back to neutral. ---
    new_action(rig, "Stagger")
    key_pose(rig, 0, STAND)
    key_pose(rig, 2, {"root": (-6, 0, 0), "chest": (-22, 0, 4), "head": (-15, 0, 0), "arm.L": (-30, 0, -35),
                      "arm.R": (-30, 0, 35), "leg.R": (15, 0, 0)}, (0, 0, -0.15))
    key_pose(rig, 7, STAND)

    # --- Hail: 1 s loop, right arm up waving down a taxi. ---
    new_action(rig, "Hail")
    for i, wave in enumerate((15, 40, 15, 40, 15)):
        key_pose(rig, i * 6, {"arm.R": (-165, 0, wave), "chest": (0, 0, -4), "head": (-10, 0, 0),
                              "arm.L": (0, 0, -4)})

    # --- Cower: 1 s loop crouched (kneeling, no knees), hunched, arms over the head, trembling. ---
    new_action(rig, "Cower")
    for i in range(9):
        t = (1, -1)[i % 2] if 0 < i < 8 else 0
        key_pose(rig, i * 3, {"hips": (-6, 0, 0), "chest": (45 + t * 2, t * 2, 0), "head": (22, 0, 0),
                              "leg.L": (72, 0, -4), "leg.R": (72, 0, 4),
                              "arm.L": (-182, 0, -6 - t * 2), "arm.R": (-182, 0, 6 + t * 2)}, (0, -0.52, 0))

    # --- Cheer: 1 s loop, both arms up and pumping with a little bounce. ---
    new_action(rig, "Cheer")
    up = {"arm.L": (-165, 0, -30), "arm.R": (-165, 0, 30), "head": (-10, 0, 0)}
    pump = {"arm.L": (-178, 0, -18), "arm.R": (-178, 0, 18), "head": (-14, 0, 0), "chest": (-4, 0, 0)}
    for i, (pose, lift) in enumerate(((up, 0), (pump, 0.06), (up, 0), (pump, 0.06), (up, 0))):
        key_pose(rig, i * 6, pose, (0, lift, 0))

    # --- Ride (§9): 1 s loop seated on a scooter/bike, hips at RIDE_HIP_Z on every body, legs angled
    # down-forward to the deck, hands forward on the bars, a slight sway. The game rolls the root to lean. ---
    new_action(rig, "Ride")
    drop = RIDE_HIP_Z - d.hip_z
    ride = {"hips": (-4, 0, 0), "chest": (12, 0, 0), "head": (-10, 0, 0),
            "leg.L": (-54, 0, -6), "leg.R": (-54, 0, 6), "arm.L": (-72, 0, 8), "arm.R": (-72, 0, -8)}
    key_pose(rig, 0, ride, (0, drop, 0))
    key_pose(rig, 12, {**ride, "chest": (13, 2, 0), "head": (-10, -2, 0)}, (0, drop, 0))
    key_pose(rig, 24, ride, (0, drop, 0))

    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)


def build_one(out_dir, name, spec, thumbs):
    reset_scene()
    d = Dims(spec)
    rig = build_armature(spec["rig"], d)
    parts = build_body(rig, spec, name, d)
    animate(rig, d)
    rig["walkSpeed"] = WALK_SPEED  # exported as glTF extras
    rig["runSpeed"] = RUN_SPEED
    export_glb(out_dir / f"{name}.glb", [rig, *parts])
    if thumbs:
        render_thumbnail(THUMBS / f"{name}.png")


def build(out_dir: Path, thumbs: bool = False):
    for name, spec in BODIES.items():
        build_one(out_dir, name, spec, thumbs)
