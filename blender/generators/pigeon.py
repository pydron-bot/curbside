"""Pigeon for flocks that scatter when a car comes through: pigeon.glb.

One rigid body (parented to the armature object) plus a 2-bone rig, `wing.L`
and `wing.R`, each carrying one wing. The rest pose has the wings folded along
the back (standing on the ground). `Flap` (0.25 s loop) spreads them and beats
them; play it while the bird is in the air. Origin on the ground under the
feet, beak toward game +Z. Fixed colours only, <= 40 tris.
"""
from pathlib import Path

import bpy

from lib.common import export_glb, hull, key_rotation, material, new_action, parent_to_bone, reset_scene

FPS = 24
SHOULDER_Z = 0.17


def build(out_dir: Path, thumbs: bool = False):
    reset_scene()
    grey = material("pigeon", (140, 146, 160), 0.8)
    dark = material("pigeon_dark", (84, 88, 100), 0.8)
    beak = material("beak", (60, 50, 44), 0.7)

    arm = bpy.data.armatures.new("pigeon_rig")
    rig = bpy.data.objects.new("pigeon", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for side, x in (("L", 1), ("R", -1)):
        b = arm.edit_bones.new(f"wing.{side}")
        b.head, b.tail = (x * 0.05, -0.04, SHOULDER_Z), (x * 0.05, 0.12, SHOULDER_Z)  # along the back
        b.roll = 0
    bpy.ops.object.mode_set(mode="OBJECT")

    # Plump body with the head forward (-Y) and a flat tail behind.
    body = hull("pigeon_body", [
        (0, -0.2, 0.22), (0.03, -0.17, 0.2), (-0.03, -0.17, 0.2), (0, -0.15, 0.25),  # head
        (0.07, -0.05, 0.12), (-0.07, -0.05, 0.12), (0.06, -0.06, 0.2), (-0.06, -0.06, 0.2),  # chest
        (0.05, 0.1, 0.11), (-0.05, 0.1, 0.11), (0, 0.06, 0.06),  # belly / rump
        (0.04, 0.22, 0.12), (-0.04, 0.22, 0.12),  # tail tip
    ], grey)
    bill = hull("pigeon_beak", [(0, -0.26, 0.215), (0.012, -0.2, 0.225), (-0.012, -0.2, 0.225), (0, -0.2, 0.205)],
                beak)
    body.parent = rig
    bill.parent = rig
    parts = [body, bill]
    for side, x in (("L", 1), ("R", -1)):
        wing = hull(f"pigeon_wing.{side}", [(x * 0.05, -0.04, SHOULDER_Z), (x * 0.07, -0.02, SHOULDER_Z - 0.01),
                                            (x * 0.06, 0.2, SHOULDER_Z - 0.03), (x * 0.05, 0.08, SHOULDER_Z + 0.015)],
                    dark)
        parent_to_bone(wing, rig, f"wing.{side}")
        parts.append(wing)

    # Flap: wings spread out sideways (z) and beat up/down (x), 6 frames.
    new_action(rig, "Flap")
    for f, beat in ((0, 45), (3, -35), (6, 45)):
        key_rotation(rig, "wing.L", f, x=beat, z=-90)
        key_rotation(rig, "wing.R", f, x=beat, z=90)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_euler = (0, 0, 0)

    export_glb(out_dir / "pigeon.glb", [rig, *parts])
