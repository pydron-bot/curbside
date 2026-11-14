"""Parametric low-poly vehicles, one root per archetype in vehicles.glb.

Per archetype: a bevelled lower body, a tapered glass cabin with a paint roof
slab on top, four wheels (separate objects, origin at the hub, rotation
applied so the game can yaw front wheels freely) and light bars.

Material names are a contract with the game (src/render/vehicleModels.ts):
  "paint"      tinted per car at runtime
  "paint2"     a second tint (V3: roof panels, stripes, sills, mirror caps); charcoal until the code tints it
  "glass", "tyre", "headlight", "taillight", "trim", fixed colours
Wheel objects are named "<arch>_wheel_FL/FR/RL/RR".
"""
import math
from pathlib import Path

import bmesh
import bpy

from lib.common import box, cylinder, export_glb, hull, ico, material, render_thumbnail, reset_scene, rotate, shade_flat

THUMBS = Path(__file__).resolve().parents[1] / "thumbs"

# Dimensions in metres. Length runs along Blender Y (front = -Y).
ARCHETYPES = {
    "sedan": dict(length=4.4, width=1.9, body_h=0.62, clearance=0.32, cabin_len=2.2, cabin_off=0.2,
                  cabin_h=0.58, taper=0.32, wheelbase=2.7, wheel_r=0.34,
                  sunroof=True, sills=True, rear_rake=0.6, rear_window=True),
    "compact": dict(length=3.8, width=1.75, body_h=0.62, clearance=0.3, cabin_len=2.0, cabin_off=0.15,
                    cabin_h=0.62, taper=0.25, wheelbase=2.4, wheel_r=0.31,
                    roof2=True, rails=True, rear_rake=0.1),
    "sports": dict(length=4.4, width=1.95, body_h=0.48, clearance=0.24, cabin_len=1.6, cabin_off=0.35,
                   cabin_h=0.42, taper=0.45, wheelbase=2.6, wheel_r=0.34,
                   wedge=True, wing=True, intakes=True, stripes=True, rake=0.9),
    # Short bonnet up front, tall box to the back: from above, the low end reads as the nose.
    "van": dict(length=4.8, width=2.0, body_h=0.95, clearance=0.38, cabin_len=3.95, cabin_off=0.33,
                cabin_h=0.85, taper=0.12, wheelbase=3.0, wheel_r=0.38,
                van_roof=True),
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
                   cabin_h=0.48, taper=0.4, wheelbase=2.85, wheel_r=0.36, scoop=True, spoiler=True,
                   hips=True, stripes="full"),
    "limo": dict(length=6.8, width=1.95, body_h=0.6, clearance=0.3, cabin_len=4.3, cabin_off=0.3,
                 cabin_h=0.56, taper=0.12, wheelbase=4.6, wheel_r=0.34, chrome=True,
                 glass_roof=True, sills=True),
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
    # Tow crew's truck: cab, low deck, boom and hook at the back, amber beacon.
    "tow_truck": dict(length=6.3, width=2.2, height=1.25, clearance=0.45, wheel_r=0.45, axles=(-2.05, 1.75),
                      cab_len=2.1, cab_h=1.3, kind="tow"),
    # Pastel paint, serving hatch with a striped awning, a giant cone on the roof.
    "ice_cream_van": dict(length=5.4, width=2.1, height=2.55, clearance=0.38, wheel_r=0.4, axles=(-1.8, 1.65),
                          cab_len=1.6, cab_h=1.15, kind="icecream"),
    "garbage_truck": dict(length=8.6, width=2.5, height=3.2, clearance=0.45, wheel_r=0.52,
                          axles=(-2.85, 2.0, 3.35), cab_len=2.3, cab_h=1.35, kind="garbage"),
}


def wheel(name, radius, width, location, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius, depth=width, location=location,
                                        rotation=(0, 1.5707963, 0))
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(mat)
    shade_flat(obj)
    return obj


def loft(name, rings, mat, caps=True):
    """A closed shell through `rings` (each a closed loop of (x, y, z), all the same length), flat-shaded.

    Every ring is an edge loop across the body and every ring vertex runs an edge along it, so
    the game's crumple shader (V3, BLENDER_TODO §16) has vertices to push on the bonnet, boot,
    roof edge and flanks.
    """
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    loops = [[bm.verts.new(v) for v in ring] for ring in rings]
    n = len(rings[0])
    for a, b in zip(loops, loops[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps:
        bm.faces.new(loops[0])
        bm.faces.new(list(reversed(loops[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    shade_flat(obj)
    return obj


def body_ring(y, half_w, z0, top, waist=0.5, shoulder=0.86, crown=0.0, tuck=0.94):
    """One cross-section of a car body at station y: a bevelled, slightly tucked-under profile.

    Seven points: sill, flank and shoulder on each side and a centre point on top (the edge
    loop along the bonnet, roof and boot). `shoulder` insets the top edge, which chamfers the
    bonnet and boot edges from above.
    """
    h = top - z0
    side = [(tuck, 0.0), (1.0, waist), (shoulder, 1.0)]
    left = [(half_w * f, y, z0 + h * k) for f, k in side]
    right = [(-x, y, z) for x, y, z in reversed(left)]
    return left + [(0.0, y, top + crown)] + right


# Archetypes whose `paint2` parts take a second tint (V3); the rest have fixed liveries.
PAINT2 = {"sedan", "compact", "sports", "van", "pickup", "muscle", "limo"}


def build_vehicle(arch, p, mats):
    """A car, reworked for the top-down camera (V3, BLENDER_TODO §16).

    Same footprint, wheelbase, height and headlights as before: the body is lofted through
    cross-sections, its corners chamfered in plan, and the details that read from 20-45 m up
    (mirrors, arches, bumpers, raked glass, wrapped tail lamps, each archetype's own top) are
    added round it.
    """
    root = bpy.data.objects.new(arch, None)
    bpy.context.scene.collection.objects.link(root)
    parts = []

    L, W = p["length"], p["width"]
    hw = W / 2
    z0 = p["clearance"]
    body_top = z0 + p["body_h"]
    roof_top = body_top + p["cabin_h"] + 0.045  # the old roof slab's top: the height the game measures
    two = mats["paint2"] if arch in PAINT2 else mats["trim"]
    roof_mat = mats["trim"] if arch == "police" or p.get("police_livery") else mats["paint"]
    cab0 = p["cabin_off"] - p["cabin_len"] / 2  # windscreen base (front is -Y)
    cab1 = p["cabin_off"] + p["cabin_len"] / 2

    # --- the body: stations nose to tail, each a ring; the ends chamfered in plan.
    def top_at(y):
        if p.get("wedge"):  # sports: a low nose rising to the tail
            t = (y + L / 2) / L
            return z0 + p["body_h"] * (0.62 + 0.38 * min(1.0, t * 1.6))
        return body_top

    def width_at(y):
        if p.get("hips"):  # muscle: pinched at the doors, fat over the rear wheels
            rear = p["wheelbase"] / 2
            if abs(y - rear) < 0.7:
                return hw
            if cab0 < y < cab1:
                return hw * 0.93
        return hw

    nose, tail = -L / 2 + 0.03, L / 2 - 0.03
    stations = [nose, -L / 2 + 0.3, (-L / 2 + cab0) / 2, cab0, (cab0 + cab1) / 2, cab1,
                (cab1 + L / 2) / 2, L / 2 - 0.3, tail]
    stations = sorted(set(round(y, 4) for y in stations if nose <= y <= tail))
    rings = []
    for y in stations:
        end = y in (nose, tail)
        w = width_at(y) * (0.86 if end else 1.0)
        top = top_at(y) - (0.06 if end else 0.0)
        crown = 0.0 if end else 0.02
        rings.append(body_ring(y, w, z0, top, shoulder=0.8 if end else 0.88, crown=crown))
    parts.append(loft(f"{arch}_body", rings, mats["paint"]))

    # Police doors and push bar, as before.
    if p.get("police_livery"):
        parts.append(box(f"{arch}_doors", (W + 0.02, p["cabin_len"] * 0.75, p["body_h"] * 0.55),
                         (0, p["cabin_off"], z0 + p["body_h"] * 0.5), mats["trim"]))
        parts.append(box(f"{arch}_pushbar", (W * 0.7, 0.12, p["body_h"] * 0.7),
                         (0, -L / 2 - 0.07, z0 + p["body_h"] * 0.4), mats["trim"]))
    if arch == "police":
        parts.append(box(f"{arch}_doors", (W + 0.02, L * 0.42, p["body_h"] * 0.7),
                         (0, -p["cabin_off"] * 0.5, z0 + p["body_h"] * 0.45), mats["trim"]))

    # --- the glasshouse: a raked windscreen (the front inset more than the back), so it
    # reads from above as its own shape between bonnet and roof.
    ct = top_at(cab0)
    rake_f = p["cabin_len"] * p["taper"] * p.get("rake", 0.75)
    rake_r = p["cabin_len"] * p["taper"] * p.get("rear_rake", 0.35)
    base_w = hw * 0.88
    top_w = hw * (1 - p["taper"] * 0.35) * 0.9
    zr = body_top + p["cabin_h"]
    glass = [(x * base_w, y, ct) for x in (-1, 1) for y in (cab0, cab1)]
    glass += [(x * top_w, y, zr) for x in (-1, 1) for y in (cab0 + rake_f, cab1 - rake_r)]
    parts.append(hull(f"{arch}_cabin", glass, mats["glass"]))

    # The roof: three stations so it can dent, its crown at the old height.
    r0, r1 = cab0 + rake_f + 0.06, cab1 - rake_r - 0.04
    rw = top_w * 0.98
    roof_crown = roof_top - zr - 0.01

    def roof_ring(y):
        return [(rw, y, zr - 0.005), (rw, y, zr + roof_crown * 0.7), (0, y, zr + roof_crown),
                (-rw, y, zr + roof_crown * 0.7), (-rw, y, zr - 0.005)]

    parts.append(loft(f"{arch}_roof", [roof_ring(y) for y in (r0, (r0 + r1) / 2, r1)],
                      mats["paint2"] if p.get("roof2") else roof_mat))

    # --- bumpers: trim, standing proud of the chamfered ends, under the lamps.
    bz = z0 + 0.1
    for end, sgn in (("front", -1), ("rear", 1)):
        parts.append(box(f"{arch}_bumper_{end}", (W * 0.86, 0.14, 0.2), (0, sgn * (L / 2 - 0.035), bz), mats["trim"]))

    # --- lights: the heads where they were (the beams start there); tails wrap onto the top.
    lz = z0 + p["body_h"] * 0.6
    for x in (-W * 0.32, W * 0.32):
        side = "L" if x > 0 else "R"
        parts.append(box(f"{arch}_head_{side}", (0.38, 0.1, 0.14), (x, -L / 2 - 0.01 + 0.02, lz), mats["headlight"]))
        parts.append(box(f"{arch}_tail_{side}", (0.38, 0.1, 0.14), (x, L / 2 - 0.01, lz), mats["taillight"]))
        parts.append(box(f"{arch}_tailtop_{side}", (0.36, 0.16, 0.02), (x, L / 2 - 0.12, top_at(L / 2 - 0.12) - 0.02),
                         mats["taillight"]))

    # --- wing mirrors at the windscreen base, and arches over the wheels (both show past the body).
    for x in (-1, 1):
        side = "L" if x > 0 else "R"
        parts.append(box(f"{arch}_mirror_{side}", (0.16, 0.08, 0.09), (x * (hw - 0.05), cab0 + 0.12, ct + 0.1), two))
        for tag, y in (("F", -p["wheelbase"] / 2), ("R", p["wheelbase"] / 2)):
            r = p["wheel_r"]
            parts.append(hull(f"{arch}_arch_{tag}{side}", [
                (x * (hw - 0.06), y + dy, 2 * r + dz) for dy, dz in ((-r * 1.15, -0.12), (-r * 0.6, 0.06),
                                                                       (r * 0.6, 0.06), (r * 1.15, -0.12))
            ] + [(x * (hw + 0.03), y + dy, 2 * r + dz) for dy, dz in ((-r * 1.05, -0.1), (-r * 0.55, 0.05),
                                                                       (r * 0.55, 0.05), (r * 1.05, -0.1))],
                mats["trim"]))

    # --- each archetype's own top.
    if p.get("sunroof"):
        parts.append(box(f"{arch}_sunroof", (rw * 1.1, (r1 - r0) * 0.4, 0.01),
                         (0, (r0 + r1) / 2 - (r1 - r0) * 0.1, roof_top - 0.012), mats["glass"]))
    if p.get("glass_roof"):  # limo: one long panel
        parts.append(box(f"{arch}_glassroof", (rw * 1.2, (r1 - r0) * 0.75, 0.01), (0, (r0 + r1) / 2, roof_top - 0.012),
                         mats["glass"]))
    if p.get("rear_window"):
        rwy = cab1 - rake_r * 0.5
        parts.append(box(f"{arch}_rearwin", (top_w * 1.4, max(rake_r * 0.7, 0.12), 0.01),
                         (0, rwy, (ct + zr) / 2 + 0.02), mats["glass"]))
    if p.get("sills"):  # a paint2 sill along each side, seen past the doors
        for x in (-1, 1):
            parts.append(box(f"{arch}_sill_{'L' if x > 0 else 'R'}", (0.06, p["wheelbase"] - 2 * p["wheel_r"] - 0.2, 0.1),
                             (x * (hw * 0.95), 0, z0 + 0.06), two))
    if p.get("rails"):  # compact: roof rails
        for x in (-1, 1):
            parts.append(box(f"{arch}_rail_{'L' if x > 0 else 'R'}", (0.05, r1 - r0, 0.03),
                             (x * (rw - 0.04), (r0 + r1) / 2, roof_top - 0.015), mats["trim"]))
    if p.get("stripes"):  # twin stripes, nose over the roof to the tail
        for x in (-0.16, 0.16):
            parts.append(box(f"{arch}_stripe_bonnet{x:+.2f}", (0.16, cab0 - nose - 0.25, 0.012),
                             (x, (nose + cab0) / 2 - 0.05, top_at((nose + cab0) / 2) + 0.022), two))
            parts.append(box(f"{arch}_stripe_boot{x:+.2f}", (0.16, tail - cab1 - 0.3, 0.012),
                             (x, (cab1 + tail) / 2, top_at((cab1 + tail) / 2) + 0.022), two))
            if p.get("stripes") == "full":
                parts.append(box(f"{arch}_stripe_roof{x:+.2f}", (0.16, r1 - r0 - 0.1, 0.01),
                                 (x, (r0 + r1) / 2, roof_top - 0.011), two))
    if p.get("intakes"):  # sports: dark intakes cut into the rear shoulders
        for x in (-1, 1):
            parts.append(box(f"{arch}_intake_{'L' if x > 0 else 'R'}", (0.14, 0.5, 0.03),
                             (x * (hw * 0.82), cab1 + 0.15, top_at(cab1 + 0.15) + 0.006), mats["trim"]))
    if p.get("scoop"):
        parts.append(box(f"{arch}_scoop", (0.55, 0.9, 0.1), (0, -L / 2 + 1.1, body_top + 0.05), mats["trim"]))
    if p.get("spoiler"):
        parts.append(box(f"{arch}_spoiler", (W * 0.92, 0.25, 0.08), (0, L / 2 - 0.15, top_at(L / 2) + 0.04),
                         mats["paint"]))
    if p.get("wing"):  # sports: a wing on two posts, wider than the boot
        sy = L / 2 - 0.22
        st = top_at(sy)
        for x in (-0.55, 0.55):
            parts.append(box(f"{arch}_wingpost{x:+.1f}", (0.05, 0.08, 0.16), (x, sy, st + 0.08), mats["trim"]))
        parts.append(box(f"{arch}_wing", (W * 0.94, 0.26, 0.04), (0, sy, st + 0.18), two))
    if p.get("chrome"):
        for x in (-1, 1):
            parts.append(box(f"{arch}_chrome_{'L' if x > 0 else 'R'}", (0.02, L * 0.8, 0.05),
                             (x * (hw + 0.005), 0, z0 + p["body_h"] * 0.55), mats["chrome"]))

    if p.get("taxi_sign"):
        roof_z = body_top + p["cabin_h"] + 0.14
        parts.append(box(f"{arch}_sign", (0.7, 0.22, 0.2), (0, p["cabin_off"], roof_z), mats["headlight"]))
        # A two-row chequer band along both shoulders of the bonnet and boot: reads as a cab from above.
        sq = 0.17
        for x in (-1, 1):
            for y_from, y_to in ((nose + 0.3, cab0 - 0.05), (cab1 + 0.05, L / 2 - 0.65)):
                n = int((y_to - y_from) / sq)
                for i in range(n):
                    for row in (0, 1):
                        if (i + row) % 2:
                            continue
                        y = y_from + (i + 0.5) * sq
                        cx = x * (hw * 0.78 - (row - 0.5) * sq)
                        parts.append(box(f"{arch}_cheq_{'L' if x > 0 else 'R'}{row}_{y:+.2f}", (sq, sq, 0.012),
                                         (cx, y, top_at(y) + 0.02 * (1 - abs(cx) / (hw * 0.88)) + 0.006), mats["trim"]))
        for i in range(0, 7, 2):
            x = -0.6 + i * 0.2
            parts.append(box(f"{arch}_cheq_boot{i}", (0.2, 0.2, 0.012), (x, L / 2 - 0.45, top_at(L / 2 - 0.45) + 0.02),
                             mats["trim"]))

    if p.get("bed"):
        # Low walls and tailgate around the load bed, behind the cab, and something in it.
        bed_front = cab1
        bed_len = L / 2 - bed_front
        bed_mid = bed_front + bed_len / 2
        wall_h = 0.3
        for x in (-1, 1):
            parts.append(box(f"{arch}_bedwall_{'L' if x > 0 else 'R'}", (0.08, bed_len, wall_h),
                             (x * (hw - 0.04), bed_mid, body_top + wall_h / 2), mats["paint"]))
            parts.append(box(f"{arch}_bedrail_{'L' if x > 0 else 'R'}", (0.1, bed_len, 0.03),
                             (x * (hw - 0.04), bed_mid, body_top + wall_h + 0.015), two))
        parts.append(box(f"{arch}_tailgate", (W - 0.1, 0.08, wall_h), (0, L / 2 - 0.08, body_top + wall_h / 2), mats["paint"]))
        parts.append(box(f"{arch}_bedfloor", (W - 0.16, bed_len - 0.1, 0.02), (0, bed_mid, body_top + 0.01), mats["trim"]))
        # Load: two crates and a lashed tarp bundle.
        parts.append(rotate(box(f"{arch}_crate_a", (0.6, 0.5, 0.4), (-0.38, bed_front + 0.45, body_top + 0.2),
                                mats["cargo"]), (0, 0, 8)))
        parts.append(box(f"{arch}_crate_b", (0.5, 0.45, 0.32), (-0.42, bed_front + 1.0, body_top + 0.16), mats["cargo"]))
        parts.append(hull(f"{arch}_tarp", [(x, y, body_top + z) for x in (0.08, 0.78) for y in (bed_front + 0.2, L / 2 - 0.3)
                                           for z in (0.02,)] +
                          [(x, y, body_top + 0.42) for x in (0.2, 0.66) for y in (bed_front + 0.35, L / 2 - 0.45)],
                          mats["tarp"]))

    if p.get("van_roof"):
        # Ribbed roof, a ladder rack (trim) and a logo block (paint2: only some vans show it).
        for i in range(4):
            y = r0 + (i + 0.5) * (r1 - r0) / 4
            parts.append(box(f"{arch}_rib{i}", (rw * 1.9, 0.06, 0.025), (0, y, zr + roof_crown * 0.75), mats["trim"]))
        rack_z = roof_top - 0.03
        for x in (-0.42, 0.42):
            parts.append(box(f"{arch}_rack{x:+.1f}", (0.05, r1 - r0 - 0.2, 0.04), (x, (r0 + r1) / 2, rack_z), mats["trim"]))
        for i in range(5):
            y = r0 + 0.2 + i * (r1 - r0 - 0.4) / 4
            parts.append(box(f"{arch}_rung{i}", (0.84, 0.04, 0.03), (0, y, rack_z), mats["chrome"]))
        parts.append(box(f"{arch}_logo", (rw * 1.5, 0.7, 0.012), (0, r0 + 0.5, roof_top - 0.005), two))

    if p.get("lightbar"):
        # A bolder bar on a trim base, and a white roof panel with a number behind it.
        roof_z = body_top + p["cabin_h"] + 0.1
        y = p["cabin_off"] - 0.1 if p.get("police_livery") else p["cabin_off"]
        parts.append(box(f"{arch}_bar_base", (1.3, 0.3, 0.05), (0, y, roof_z - 0.07), mats["trim"]))
        parts.append(box(f"{arch}_bar_red", (0.6, 0.3, 0.12), (-0.33, y, roof_z), mats["siren_red"]))
        parts.append(box(f"{arch}_bar_blue", (0.6, 0.3, 0.12), (0.33, y, roof_z), mats["siren_blue"]))
        ny = y + 0.55
        parts.append(box(f"{arch}_number", (0.8, 0.5, 0.01), (0, ny, roof_top - 0.008), mats["livery_white"]))
        # "17": a one and a seven in trim bars, read upright with the car heading up the screen.
        # (Front is -Y: heading up the screen, the car's +X is on the left.)
        parts.append(box(f"{arch}_num1", (0.07, 0.34, 0.006), (0.18, ny, roof_top), mats["trim"]))
        parts.append(box(f"{arch}_num7a", (0.24, 0.07, 0.006), (-0.12, ny - 0.135, roof_top), mats["trim"]))
        parts.append(rotate(box(f"{arch}_num7b", (0.07, 0.3, 0.006), (-0.18, ny + 0.02, roof_top), mats["trim"]),
                            (0, 0, -22)))
        # A stripe along each flank under the windows.
        for x in (-1, 1):
            parts.append(box(f"{arch}_stripe_{'L' if x > 0 else 'R'}", (0.02, L * 0.86, 0.09),
                             (x * (hw + 0.012), 0, z0 + p["body_h"] * 0.72), mats["livery_blue"]))

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
        parts.append(mirror(arch, x, W, -L / 2 + 0.3, z0 + cab_h + glass_h * 0.5, mats))
    return parts, z0 + cab_h + glass_h


def mirror(arch, x, W, y, z, mats):
    """A truck's wing mirror on its arm, inside the wheels' width so the footprint holds (V3)."""
    return box(f"{arch}_mirror_{'L' if x > 0 else 'R'}", (0.12, 0.08, 0.3), (x * (W / 2 + 0.0), y, z), mats["trim"])


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
        for i, y in enumerate((-3.6, -0.6)):  # roof hatches (V3)
            parts.append(box(f"{arch}_hatch{i}", (0.9, 0.9, 0.06), (0, y, H + 0.15), mats["chrome"]))
        for x in (-1, 1):
            parts.append(mirror(arch, x, W, -L / 2 + 0.25, z0 + body_h * 0.75, mats))
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
        elif kind == "tow":
            deck_z = z0 + 0.5
            parts.append(box(f"{arch}_deck", (W, body_len, 0.5), (0, body_mid, z0 + 0.25), mats["paint"], bevel=0.04))
            for x in (-1, 1):  # tool lockers along the deck sides
                parts.append(box(f"{arch}_locker_{'L' if x > 0 else 'R'}", (0.5, body_len * 0.6, 0.45),
                                 (x * (W / 2 - 0.25), body_mid - 0.2, deck_z + 0.22), mats["paint"]))
            # Boom: from a post behind the cab, angled up and back past the tail.
            parts.append(box(f"{arch}_boompost", (0.35, 0.35, 0.9), (0, body_front + 0.6, deck_z + 0.45), mats["trim"]))
            boom = box(f"{arch}_boom", (0.22, 3.0, 0.22), (0, body_front + 0.6 + 1.5, deck_z + 0.9), mats["hazard"])
            rotate(boom, (22, 0, 0), pivot=(0, body_front + 0.6, deck_z + 0.9))
            parts.append(boom)
            tip_y = body_front + 0.6 + 3.0 * math.cos(math.radians(22))
            tip_z = deck_z + 0.9 + 3.0 * math.sin(math.radians(22))
            parts.append(box(f"{arch}_cable", (0.03, 0.03, 0.9), (0, tip_y, tip_z - 0.45), mats["trim"]))
            parts.append(box(f"{arch}_hook", (0.12, 0.08, 0.16), (0, tip_y, tip_z - 0.95), mats["chrome"]))
            # Underlift bar low at the tail.
            parts.append(box(f"{arch}_underlift", (1.4, 0.2, 0.12), (0, L / 2 + 0.25, z0 + 0.1), mats["trim"]))
            parts.append(box(f"{arch}_beacon", (0.9, 0.22, 0.14), (0, -L / 2 + p["cab_len"] / 2, cab_top + 0.07),
                             mats["amber"]))
        elif kind == "icecream":
            parts.append(box(f"{arch}_module", (W, body_len, body_h), (0, body_mid, z0 + body_h / 2), mats["paint"],
                             bevel=0.08))
            # Serving hatch on the kerb side (+X is the van's left) with a striped awning.
            parts.append(box(f"{arch}_hatch", (0.04, body_len * 0.55, body_h * 0.32),
                             (W / 2 + 0.01, body_mid - 0.1, z0 + body_h * 0.62), mats["glass"]))
            parts.append(box(f"{arch}_counter", (0.2, body_len * 0.55, 0.06),
                             (W / 2 + 0.1, body_mid - 0.1, z0 + body_h * 0.45), mats["chrome"]))
            for i in range(5):
                parts.append(rotate(box(f"{arch}_awning{i}", (0.45, body_len * 0.11, 0.03),
                                        (W / 2 + 0.22, body_mid - 0.1 + (i - 2) * body_len * 0.11, z0 + body_h * 0.84),
                                        mats["awning_pink" if i % 2 else "awning_white"]),
                                    (0, 18, 0), pivot=(W / 2, 0, z0 + body_h * 0.84)))
            # Giant cone on the roof: wafer tip-down, two scoops on top.
            roof = H
            parts.append(cylinder(f"{arch}_cone", 0.05, 1.1, (0, body_mid, roof + 0.55), mats["wafer"], verts=8,
                                  radius2=0.42))
            parts.append(ico(f"{arch}_scoop_a", 0.44, (0, body_mid, roof + 1.25), mats["scoop_pink"], subdiv=1))
            parts.append(ico(f"{arch}_scoop_b", 0.32, (0.05, body_mid - 0.05, roof + 1.65), mats["scoop_cream"],
                             subdiv=1))
            parts.append(box(f"{arch}_sign", (0.05, body_len * 0.7, 0.3), (-(W / 2 + 0.01), body_mid, z0 + body_h * 0.8),
                             mats["awning_pink"]))
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


# Two-wheelers (§9): one wheel on the centre line front (_wheel_FL, steers) and back (_wheel_RL), no rider;
# `<arch>_seat` is an empty at the rider's hip position (the Ride clip puts the hips 0.75 m above the
# character's root, so place the rider's root 0.75 m below the seat).
BIKES = {
    "scooter": dict(length=1.8, wheel_r=0.22, wheel_w=0.1, axles=(-0.64, 0.6), seat=(0.32, 0.75)),
    "cop_bike": dict(length=2.2, wheel_r=0.32, wheel_w=0.14, axles=(-0.8, 0.78), seat=(0.28, 0.86), police=True),
}


def build_bike(arch, p, mats):
    root = bpy.data.objects.new(arch, None)
    bpy.context.scene.collection.objects.link(root)
    r, (yf, yr) = p["wheel_r"], p["axles"]
    seat_y, hip_z = p["seat"]
    parts = [
        wheel(f"{arch}_wheel_FL", r, p["wheel_w"], (0, yf, r), mats["tyre"]),
        wheel(f"{arch}_wheel_RL", r, p["wheel_w"], (0, yr, r), mats["tyre"]),
        box(f"{arch}_fender_f", (p["wheel_w"] + 0.06, r * 1.2, 0.04), (0, yf, 2 * r + 0.04), mats["paint"]),
    ]
    if not p.get("police"):
        # Scooter: low flat deck, a front shield up to the bars, a rounded tail under the seat.
        parts += [
            box(f"{arch}_deck", (0.36, 0.72, 0.08), (0, -0.06, 0.26), mats["paint"]),
            box(f"{arch}_mat", (0.3, 0.6, 0.01), (0, -0.06, 0.305), mats["trim"]),
            hull(f"{arch}_tail", [(x * w, y, z) for x in (-1, 1) for (y, w, z) in (
                (0.18, 0.18, 0.24), (0.18, 0.18, 0.62), (0.75, 0.13, 0.3), (0.82, 0.1, 0.58), (0.55, 0.17, 0.66))],
                mats["paint"]),
            box(f"{arch}_saddle", (0.28, 0.6, 0.09), (0, 0.44, 0.7), mats["trim"]),
            hull(f"{arch}_shield", [(x * w, y, z) for x in (-1, 1) for (y, w, z) in (
                (-0.42, 0.19, 0.27), (-0.5, 0.19, 0.3), (-0.62, 0.16, 0.92), (-0.52, 0.16, 0.95))], mats["paint"]),
            box(f"{arch}_column", (0.06, 0.06, 0.32), (0, -0.48, 0.9), mats["trim"]),
            box(f"{arch}_bars", (0.62, 0.05, 0.05), (0, -0.42, 1.04), mats["trim"]),
            box(f"{arch}_head", (0.16, 0.05, 0.1), (0, -0.63, 0.86), mats["headlight"]),
            box(f"{arch}_tail_L", (0.16, 0.05, 0.07), (0, 0.84, 0.55), mats["taillight"]),
            box(f"{arch}_fork", (0.05, 0.05, 0.75), (0, yf + 0.02, 0.62), mats["trim"]),
        ]
    else:
        # Police motorbike: engine, tank, fairing with windscreen, saddlebags, front and rear strobes.
        parts += [
            box(f"{arch}_engine", (0.32, 0.5, 0.34), (0, -0.02, 0.44), mats["trim"]),
            box(f"{arch}_frame", (0.12, 1.2, 0.1), (0, 0.0, 0.66), mats["trim"]),
            hull(f"{arch}_tank", [(x * w, y, z) for x in (-1, 1) for (y, w, z) in (
                (-0.42, 0.13, 0.7), (-0.4, 0.15, 0.96), (0.08, 0.16, 0.72), (0.06, 0.13, 0.9))], mats["paint"]),
            box(f"{arch}_saddle", (0.32, 0.62, 0.1), (0, seat_y + 0.04, 0.8), mats["trim"]),
            hull(f"{arch}_fairing", [(x * w, y, z) for x in (-1, 1) for (y, w, z) in (
                (-0.55, 0.28, 0.72), (-0.78, 0.18, 0.8), (-0.78, 0.22, 1.1), (-0.55, 0.3, 1.18))], mats["paint"]),
            rotate(box(f"{arch}_windscreen", (0.44, 0.03, 0.34), (0, -0.7, 1.32), mats["glass"]), (-25, 0, 0),
                   pivot=(0, -0.72, 1.16)),
            box(f"{arch}_bars", (0.76, 0.05, 0.05), (0, -0.42, 1.15), mats["trim"]),
            box(f"{arch}_head", (0.2, 0.05, 0.14), (0, -0.8, 0.92), mats["headlight"]),
            box(f"{arch}_siren_fr", (0.08, 0.05, 0.06), (-0.22, -0.74, 1.08), mats["siren_red"]),
            box(f"{arch}_siren_fb", (0.08, 0.05, 0.06), (0.22, -0.74, 1.08), mats["siren_blue"]),
            box(f"{arch}_rack", (0.3, 0.3, 0.04), (0, 0.78, 0.86), mats["trim"]),
            box(f"{arch}_mast", (0.04, 0.04, 0.3), (0, 0.9, 1.0), mats["trim"]),
            box(f"{arch}_siren_rr", (0.1, 0.06, 0.08), (-0.07, 0.9, 1.18), mats["siren_red"]),
            box(f"{arch}_siren_rb", (0.1, 0.06, 0.08), (0.07, 0.9, 1.18), mats["siren_blue"]),
            box(f"{arch}_tail_L", (0.18, 0.04, 0.06), (0, 1.0, 0.74), mats["taillight"]),
            box(f"{arch}_fender_r", (p["wheel_w"] + 0.06, 0.5, 0.04), (0, yr + 0.05, 2 * r + 0.04), mats["paint"]),
            cylinder(f"{arch}_exhaust", 0.05, 0.75, (-0.2, 0.5, 0.33), mats["chrome"], verts=6, rotation=(90, 0, 0)),
            rotate(box(f"{arch}_fork", (0.06, 0.06, 0.85), (0, yf, 0.72), mats["trim"]), (-22, 0, 0),
                   pivot=(0, yf, r)),
        ]
        for x in (-1, 1):  # saddlebags
            parts.append(box(f"{arch}_bag_{'L' if x > 0 else 'R'}", (0.16, 0.42, 0.3), (x * 0.27, 0.58, 0.62),
                             mats["trim"]))
    seat = bpy.data.objects.new(f"{arch}_seat", None)  # an empty: no geometry, read by the game
    bpy.context.scene.collection.objects.link(seat)
    seat.location = (0, seat_y, hip_z)
    for obj in parts + [seat]:
        obj.parent = root
    return root, parts + [seat]


def build(out_dir: Path, thumbs: bool = False):
    reset_scene()
    mats = {
        "paint": material("paint", (235, 235, 235), 0.45),
        "glass": material("glass", (32, 42, 56), 0.15),
        "tyre": material("tyre", (22, 22, 22), 0.95),
        "headlight": material("headlight", (255, 244, 194), 0.3),
        "taillight": material("taillight", (220, 40, 30), 0.3),
        "trim": material("trim", (24, 26, 30), 0.6),
        # A second body colour (V3): the code side tints it per car; until then a charcoal (~0.12 linear).
        "paint2": material("paint2", (97, 97, 100), 0.45),
        "siren_red": material("siren_red", (230, 30, 30), 0.3),
        "siren_blue": material("siren_blue", (30, 80, 240), 0.3),
        # Fixed colours (not tinted): liveries and fittings.
        "chrome": material("chrome", (190, 194, 200), 0.25),
        "sign": material("sign", (255, 170, 40), 0.4),
        "amb_red": material("amb_red", (210, 30, 30), 0.5),
        "hazard": material("hazard", (240, 196, 30), 0.6),
        "amber": material("amber", (245, 150, 20), 0.3),
        "dark": material("dark", (12, 12, 14), 0.9),
        "wafer": material("wafer", (214, 160, 90), 0.8),
        "scoop_pink": material("scoop_pink", (250, 160, 190), 0.6),
        "scoop_cream": material("scoop_cream", (250, 238, 210), 0.6),
        "awning_pink": material("awning_pink", (240, 110, 160), 0.6),
        "awning_white": material("awning_white", (245, 245, 245), 0.6),
        "cargo": material("cargo", (168, 120, 66), 0.85),
        "tarp": material("tarp", (52, 92, 70), 0.9),
        "livery_white": material("livery_white", (240, 240, 236), 0.5),
        "livery_blue": material("livery_blue", (30, 70, 200), 0.5),
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
    for k, (arch, params) in enumerate(BIKES.items()):
        root, parts = build_bike(arch, params, mats)
        objects += [root, *parts]
        root.location.x = -(k + 1) * 3.0

    export_glb(out_dir / "vehicles.glb", objects)
    if thumbs:
        render_thumbnail(THUMBS / "vehicles.png", target_height=6)
