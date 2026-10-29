"""Low-poly characters with rigid-part animation.

Each body part is its own mesh parented to an armature bone (no skinning), so
the GLB stays tiny and animation is cheap: top-down, a ped mostly reads as
head + shoulders, with swinging arms and legs showing at the sides.

Animations (glTF animation names): "Idle" (2 s loop), "Walk" (1 s loop).
The game scales Walk playback with speed; WALK_SPEED is the ground speed the
cycle is authored for, exported as the `walkSpeed` custom property.
"""
from pathlib import Path

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
    reset_scene,
)

THUMBS = Path(__file__).resolve().parents[1] / "thumbs"

# Metres per second the walk cycle matches (stride 1.6 m per 1 s cycle).
WALK_SPEED = 1.6
FPS = 24

PLAYER = {
    "skin": (224, 172, 132),
    "hair": (40, 28, 22),
    "shirt": (230, 196, 60),  # yellow jacket: easy to spot from above
    "pants": (52, 62, 92),
    "shoes": (30, 30, 30),
}

HIP_Z = 0.92
SHOULDER_Z = 1.42
NECK_Z = 1.5


def build_armature(name):
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
    bone("hips", (0, 0, HIP_Z), (0, 0, HIP_Z + 0.2), "root")
    bone("chest", (0, 0, HIP_Z + 0.2), (0, 0, NECK_Z), "hips")
    bone("head", (0, 0, NECK_Z), (0, 0, NECK_Z + 0.3), "chest")
    for side, x in (("L", 1), ("R", -1)):
        bone(f"arm.{side}", (0.27 * x, 0, SHOULDER_Z), (0.29 * x, 0, SHOULDER_Z - 0.62), "chest")
        bone(f"leg.{side}", (0.11 * x, 0, HIP_Z), (0.11 * x, 0, 0.06), "hips")
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def build_body(rig, palette, name):
    skin = material(f"{name}_skin", palette["skin"])
    hair = material(f"{name}_hair", palette["hair"], 0.9)
    shirt = material(f"{name}_shirt", palette["shirt"])
    pants = material(f"{name}_pants", palette["pants"])
    shoes = material(f"{name}_shoes", palette["shoes"])

    parts = []

    def attach(obj, bone_name):
        parent_to_bone(obj, rig, bone_name)
        parts.append(obj)

    # Torso: broad shoulders, narrower waist. Blender -Y is the character's front.
    attach(box(f"{name}_torso", (0.5, 0.28, 0.5), (0, 0, 1.2), shirt, bevel=0.04), "chest")
    attach(box(f"{name}_pelvis", (0.36, 0.24, 0.2), (0, 0, HIP_Z + 0.02), pants, bevel=0.03), "hips")
    attach(ico(f"{name}_head", 0.13, (0, 0, NECK_Z + 0.13), skin, subdiv=2, scale=(1, 1.05, 1.1)), "head")
    attach(
        ico(f"{name}_hair", 0.14, (0, 0.025, NECK_Z + 0.18), hair, subdiv=2, scale=(1, 1.05, 0.75)),
        "head",
    )
    # Nose nub so facing direction reads from above.
    attach(box(f"{name}_nose", (0.04, 0.05, 0.05), (0, -0.135, NECK_Z + 0.12), skin), "head")

    for side, x in (("L", 1), ("R", -1)):
        attach(box(f"{name}_arm.{side}", (0.12, 0.13, 0.5), (0.31 * x, 0, SHOULDER_Z - 0.27), shirt, 0.03), f"arm.{side}")
        attach(box(f"{name}_hand.{side}", (0.09, 0.1, 0.1), (0.32 * x, 0, SHOULDER_Z - 0.58), skin), f"arm.{side}")
        attach(box(f"{name}_leg.{side}", (0.15, 0.17, 0.82), (0.11 * x, 0, 0.5), pants, 0.03), f"leg.{side}")
        attach(box(f"{name}_shoe.{side}", (0.14, 0.26, 0.09), (0.11 * x, -0.04, 0.045), shoes, 0.02), f"leg.{side}")
    return parts


def animate(rig):
    # --- Walk: 1 s cycle. Legs and arms swing in opposition; hips bob twice. ---
    new_action(rig, "Walk")
    n = FPS  # frames per cycle
    swing_leg, swing_arm = 32, 24
    for i, phase in enumerate((1, 0, -1, 0, 1)):
        f = 1 + i * n // 4
        key_rotation(rig, "leg.L", f, x=swing_leg * phase)
        key_rotation(rig, "leg.R", f, x=-swing_leg * phase)
        key_rotation(rig, "arm.L", f, x=-swing_arm * phase)
        key_rotation(rig, "arm.R", f, x=swing_arm * phase)
        key_rotation(rig, "chest", f, z=6 * phase)
        # Low at full stride, high when legs pass (bone-local Y is world up for root).
        key_location(rig, "root", f, (0, -0.04 * abs(phase), 0))

    # --- Idle: 2 s breathing loop. ---
    new_action(rig, "Idle")
    for i, (chest, arm) in enumerate(((0, 4), (2, 6), (0, 4))):
        f = 1 + i * FPS
        key_rotation(rig, "chest", f, x=-chest)
        key_rotation(rig, "arm.L", f, y=arm)
        key_rotation(rig, "arm.R", f, y=-arm)
        key_rotation(rig, "leg.L", f)
        key_rotation(rig, "leg.R", f)
        key_location(rig, "root", f, (0, 0, 0))

    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)


def build(out_dir: Path, thumbs: bool = False):
    reset_scene()
    rig = build_armature("Player")
    parts = build_body(rig, PLAYER, "player")
    animate(rig)
    rig["walkSpeed"] = WALK_SPEED  # exported as glTF extras
    export_glb(out_dir / "player.glb", [rig, *parts])
    if thumbs:
        render_thumbnail(THUMBS / "player.png")
