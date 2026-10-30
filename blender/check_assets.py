"""Check the exported GLBs against the contracts the game code relies on.

    python3 blender/check_assets.py [public/assets]

Plain Python (no Blender): parses each GLB's JSON chunk and reports, per root
node, triangle count, materials and (for characters) bones and clips. Exits 1
if any budget or naming contract in docs/BLENDER_TODO.md is broken.
"""
import json
import re
import struct
import sys
from pathlib import Path

CHAR_SLOTS = ("skin", "hair", "shirt", "pants", "shoes")
CAR_KINDS = {"paint", "glass", "headlight", "taillight", "tyre", "trim", "siren_red", "siren_blue"}
CHAR_BONES = {"root", "hips", "chest", "head", "arm.L", "arm.R", "leg.L", "leg.R"}
CHAR_CLIPS = {
    # name: (seconds, tolerance)
    "Idle": (2.0, 0.05), "Walk": (1.0, 0.05), "Run": (0.6, 0.05), "Punch": (0.35, 0.05),
    "Aim": (0.3, 0.05), "Shoot": (0.12, 0.02), "Fall": (0.5, 0.05), "Down": (1.0, 0.05),
    "GetUp": (0.9, 0.05), "EnterCar": (0.5, 0.05), "Arrested": (1.0, 0.05),
    "Throw": (0.4, 0.05), "AimRocket": (0.3, 0.05), "ShootRocket": (0.2, 0.03), "Punch2": (0.33, 0.05),
    "Uppercut": (0.4, 0.05), "Stagger": (0.3, 0.05), "Hail": (1.0, 0.05), "Cower": (1.0, 0.05), "Cheer": (1.0, 0.05),
}
CHARACTER_FILES = re.compile(r"^(player|ped_\w+|cop|vex|tuna|pike)\.glb$")
BUDGET = {"character": 600, "vehicle": 1500, "vehicle_heli": 1500, "prop": 300, "debris": 80}
# Large props that are allowed more than the small-prop budget.
PROP_BUDGET_OVERRIDE = {"spray_booth": 300, "streetlamp": 300, "traffic_light": 300, "water_tank": 300, "palm": 300, "ramp": 300}

problems = []


def problem(msg):
    problems.append(msg)
    print(f"  !! {msg}")


def read_glb(path):
    data = path.read_bytes()
    magic, _version, _length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", f"{path} is not a GLB"
    chunk_len, chunk_type = struct.unpack_from("<I4s", data, 12)
    assert chunk_type == b"JSON"
    return json.loads(data[20 : 20 + chunk_len])


def mesh_tris(gltf, mesh_index):
    tris = 0
    for prim in gltf["meshes"][mesh_index]["primitives"]:
        if "indices" in prim:
            tris += gltf["accessors"][prim["indices"]]["count"] // 3
        else:
            tris += gltf["accessors"][prim["attributes"]["POSITION"]]["count"] // 3
    return tris


def mesh_materials(gltf, mesh_index):
    names = set()
    for prim in gltf["meshes"][mesh_index]["primitives"]:
        if "material" in prim:
            names.add(gltf["materials"][prim["material"]].get("name", "?"))
    return names


def walk(gltf, node_index, depth=0):
    yield node_index, depth
    for c in gltf["nodes"][node_index].get("children", []):
        yield from walk(gltf, c, depth + 1)


def subtree_stats(gltf, root):
    tris, mats, names = 0, set(), []
    for n, _ in walk(gltf, root):
        node = gltf["nodes"][n]
        names.append(node.get("name", ""))
        if "mesh" in node:
            tris += mesh_tris(gltf, node["mesh"])
            mats |= mesh_materials(gltf, node["mesh"])
    return tris, mats, names


def clip_seconds(gltf, anim):
    return max(gltf["accessors"][s["input"]]["max"][0] for s in anim["samplers"])


def check_character(path, gltf):
    scene = gltf["scenes"][gltf.get("scene", 0)]
    roots = scene["nodes"]
    if len(roots) != 1:
        problem(f"{path.name}: {len(roots)} roots; the character loader merges every mesh into one person")
    root = roots[0]
    tris, mats, _ = subtree_stats(gltf, root)
    bones = [gltf["nodes"][j].get("name") for j in gltf["skins"][0]["joints"]] if gltf.get("skins") else []
    if not bones:  # rigid parts: bones are the nodes meshes hang off
        bones = sorted({gltf["nodes"][n].get("name") for n, _ in walk(gltf, root)
                        if any("mesh" in gltf["nodes"][c] for c in gltf["nodes"][n].get("children", []))})
    extras = gltf["nodes"][root].get("extras", {})
    print(f"  root {gltf['nodes'][root].get('name')}: {tris} tris, extras {extras}")
    if tris > BUDGET["character"]:
        problem(f"{path.name}: {tris} tris > {BUDGET['character']}")
    bad = [m for m in mats if m.split("_")[-1] not in CHAR_SLOTS]
    if bad:
        problem(f"{path.name}: materials without an outfit suffix (would draw as skin): {bad}")
    all_names = {gltf["nodes"][n].get("name") for n, _ in walk(gltf, root)}
    missing = CHAR_BONES - all_names
    if missing:
        problem(f"{path.name}: missing bones {sorted(missing)}")
    print(f"  mesh-carrying bones ({len(bones)}): {', '.join(bones)}")
    if len(bones) > 12:
        problem(f"{path.name}: {len(bones)} bones > 12")
    clips = {a.get("name"): clip_seconds(gltf, a) for a in gltf.get("animations", [])}
    print("  clips: " + ", ".join(f"{k} {v:.3f}s" for k, v in clips.items()))
    for name, (secs, tol) in CHAR_CLIPS.items():
        if name not in clips:
            problem(f"{path.name}: no {name} clip")
        elif abs(clips[name] - secs) > tol:
            problem(f"{path.name}: {name} is {clips[name]:.3f}s, want {secs}s")


def check_multi_root(path, gltf, kind, allowed_kinds=None):
    scene = gltf["scenes"][gltf.get("scene", 0)]
    for root in scene["nodes"]:
        name = gltf["nodes"][root].get("name")
        tris, mats, names = subtree_stats(gltf, root)
        budget = BUDGET[kind]
        if kind == "prop":
            budget = PROP_BUDGET_OVERRIDE.get(name, budget)
        flag = "" if tris <= budget else f"  (> {budget})"
        print(f"  {name:16s} {tris:5d} tris  {', '.join(sorted(mats))}{flag}")
        if tris > budget:
            problem(f"{path.name}/{name}: {tris} tris > {budget}")
        if allowed_kinds is not None:
            other = mats - allowed_kinds
            if other:
                print(f"  {'':16s} fixed-colour parts: {', '.join(sorted(other))}")
        if kind == "vehicle":
            for w in ("FL", "FR"):
                if f"{name}_wheel_{w}" not in names:
                    problem(f"{path.name}/{name}: no {name}_wheel_{w}")


def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "public" / "assets")
    for path in sorted(folder.glob("*.glb")):
        gltf = read_glb(path)
        print(f"{path.name} ({path.stat().st_size // 1024} KB)")
        if CHARACTER_FILES.match(path.name):
            check_character(path, gltf)
        elif path.name == "vehicles.glb":
            check_multi_root(path, gltf, "vehicle", CAR_KINDS)
        elif path.name == "heli.glb":
            check_multi_root(path, gltf, "vehicle_heli")
            names = {n.get("name") for n in gltf["nodes"]}
            for rotor in ("heli_rotor_main", "heli_rotor_tail"):
                if rotor not in names:
                    problem(f"heli.glb: no {rotor} node")
                elif "rotation" in next(n for n in gltf["nodes"] if n.get("name") == rotor):
                    problem(f"heli.glb: {rotor} is rotated; its local axes must match the root's")
        elif path.name == "debris.glb":
            check_multi_root(path, gltf, "debris", {"paint", "trim", "tyre"})
        else:
            check_multi_root(path, gltf, "prop")
    if problems:
        print(f"\n{len(problems)} problem(s)")
        sys.exit(1)
    print("\nall contracts OK")


main()
