"""Shared helpers for asset generators.

Conventions (see PLAN.md section 6): 1 unit = 1 m, origin at ground centre,
models face Blender -Y (which glTF/three.js sees as +Z, the game's "forward").
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector


def reset_scene():
    """Start each generator from an empty file so generators can't leak into each other."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 24


_materials = {}


def material(name, rgb, roughness=0.8):
    """Flat principled material; cached by name within one generator run."""
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*srgb_to_linear(rgb), 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        mat.diffuse_color = (*srgb_to_linear(rgb), 1.0)
    return mat


def srgb_to_linear(rgb):
    def ch(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return tuple(ch(c) for c in rgb)


def box(name, size, location, mat, bevel=0.0):
    """Axis-aligned box with optional bevel (applied on export)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 1
    obj.data.materials.append(mat)
    shade_flat(obj)
    return obj


def ico(name, radius, location, mat, subdiv=1, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    shade_flat(obj)
    return obj


def shade_flat(obj):
    for poly in obj.data.polygons:
        poly.use_smooth = False


def parent_to_bone(obj, armature, bone_name):
    """Rigidly attach obj to a bone, keeping its current world transform."""
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    bpy.context.view_layer.update()
    obj.matrix_world = world


def key_rotation(armature, bone, frame, x=0.0, y=0.0, z=0.0):
    """Keyframe a pose bone's Euler rotation (degrees, bone-local axes)."""
    pb = armature.pose.bones[bone]
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
    pb.keyframe_insert("rotation_euler", frame=frame)


def key_location(armature, bone, frame, loc):
    pb = armature.pose.bones[bone]
    pb.location = loc
    pb.keyframe_insert("location", frame=frame)


def new_action(armature, name):
    """Make `name` the armature's active action; later keyframes land in it."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = action
    return action


def export_glb(path, objects):
    """Export the given objects (and their animations) as one binary glTF."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_def_bones=False,
        export_materials="EXPORT",
        export_extras=True,
    )
    print(f"exported {path} ({path.stat().st_size} bytes)")


def render_thumbnail(path, target_height=1.8):
    """Quick EEVEE preview from a high 3/4 angle (slow without GPU access)."""
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("thumb_cam")
    cam = bpy.data.objects.new("thumb_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (target_height * 1.6, -target_height * 1.6, target_height * 1.8)
    direction = Vector((0, 0, target_height / 2)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new("thumb_sun", bpy.data.lights.new("thumb_sun", "SUN"))
    sun.rotation_euler = (math.radians(40), 0, math.radians(30))
    scene.collection.objects.link(sun)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.render.film_transparent = True
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
