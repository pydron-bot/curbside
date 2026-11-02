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


def cylinder(name, radius, depth, location, mat, verts=8, radius2=None, rotation=(0, 0, 0)):
    """Upright cylinder (or a cone/frustum when radius2 is given), centred on location."""
    if radius2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=location)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=radius2, depth=depth,
                                        location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = tuple(math.radians(a) for a in rotation)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(mat)
    shade_flat(obj)
    return obj


def hull(name, points, mat):
    """Convex hull of `points` as a flat-shaded mesh (wedges, ramps, odd panels)."""
    import bmesh

    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts, edges=bm.edges)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    shade_flat(obj)
    return obj


def rotate(obj, rotation, pivot=None):
    """Rotate obj by Euler degrees about `pivot` (default its origin) and apply it to the mesh."""
    from mathutils import Euler, Matrix

    rot = Euler(tuple(math.radians(a) for a in rotation)).to_matrix().to_4x4()
    p = Vector(pivot) if pivot is not None else obj.location.copy()
    bpy.context.view_layer.update()
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.transform(Matrix.Translation(p) @ rot @ Matrix.Translation(-p))
    return obj


def group(name, parts, location=(0, 0, 0)):
    """Parent parts under a new empty called `name` (one root per model in the GLB)."""
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for obj in parts:
        obj.parent = root
    root.location = location
    return root


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


# ---------------------------------------------------------------- low-tri parts (street props, round 2)

def _mesh_object(name, bm, mats):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for m in mats:
        obj.data.materials.append(m)
    shade_flat(obj)
    return obj


def open_box(name, size, location, mat):
    """A box without its bottom face (nobody sees under a prop): 10 tris instead of 12."""
    import bmesh

    obj = box(name, size, location, mat)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.9], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def prism(name, rings, band_mats, cap_mat, verts=6, centre=(0.0, 0.0), spin=0.0):
    """
    An upright drum in bands, no bottom: rings [(z, radius), ...] from the bottom up;
    band_mats[i] colours the sides between ring i and i + 1, cap_mat the top.
    2 * verts tris per band, verts - 2 for the cap.
    """
    import bmesh

    mats = []
    for m in [*band_mats, cap_mat]:
        if m not in mats:
            mats.append(m)
    bm = bmesh.new()
    loops = []
    for z, r in rings:
        loops.append([bm.verts.new((centre[0] + r * math.cos(spin + 2 * math.pi * i / verts),
                                    centre[1] + r * math.sin(spin + 2 * math.pi * i / verts), z)) for i in range(verts)])
    for b, m in enumerate(band_mats):
        lo, hi = loops[b], loops[b + 1]
        for i in range(verts):
            j = (i + 1) % verts
            f = bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
            f.material_index = mats.index(m)
    cap = bm.faces.new(loops[-1])
    cap.material_index = mats.index(cap_mat)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    return _mesh_object(name, bm, mats)


def fan(name, radius, z, apex, mat_for, segs=8, centre=(0.0, 0.0), spin=0.0):
    """
    An umbrella or parasol seen from above: `segs` triangles from a rim at height z up to
    an apex `apex` m higher; mat_for(i) picks each segment's material (top side only).
    """
    import bmesh

    mats = []
    for i in range(segs):
        if mat_for(i) not in mats:
            mats.append(mat_for(i))
    bm = bmesh.new()
    top = bm.verts.new((centre[0], centre[1], z + apex))
    rim = [bm.verts.new((centre[0] + radius * math.cos(spin + 2 * math.pi * i / segs),
                         centre[1] + radius * math.sin(spin + 2 * math.pi * i / segs), z)) for i in range(segs)]
    for i in range(segs):
        f = bm.faces.new((rim[i], rim[(i + 1) % segs], top))
        f.material_index = mats.index(mat_for(i))
    return _mesh_object(name, bm, mats)


def strips(name, x0, x1, ys, z0, z1, mats_cycle):
    """
    A striped canopy or awning, one-sided and facing up: bands across X from x0 to x1 between
    successive ys, sloping from height z0 at ys[0] to z1 at ys[-1], coloured in turn. 2 tris a band.
    """
    import bmesh

    mats = []
    for m in mats_cycle:
        if m not in mats:
            mats.append(m)
    bm = bmesh.new()
    span = ys[-1] - ys[0]
    row = []
    for y in ys:
        z = z0 + (z1 - z0) * (y - ys[0]) / span
        row.append((bm.verts.new((x0, y, z)), bm.verts.new((x1, y, z))))
    for i in range(len(ys) - 1):
        (a, b), (c, d) = row[i], row[i + 1]
        f = bm.faces.new((a, b, d, c))
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        f.material_index = mats.index(mats_cycle[i % len(mats_cycle)])
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    return _mesh_object(name, bm, mats)
