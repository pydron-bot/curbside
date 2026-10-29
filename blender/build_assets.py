"""Build all game assets headless.

    blender -b --factory-startup -P blender/build_assets.py -- --out public/assets [--only characters] [--thumbs]

Each module in generators/ exposes build(out_dir: Path, thumbs: bool).
"""
import argparse
import importlib
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

GENERATORS = ["characters"]


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="build_assets")
    p.add_argument("--out", default=str(HERE.parent / "public" / "assets"))
    p.add_argument("--only", action="append", choices=GENERATORS)
    p.add_argument("--thumbs", action="store_true", help="also render EEVEE preview PNGs")
    args = p.parse_args(argv)

    out = Path(args.out).resolve()
    failed = []
    for name in args.only or GENERATORS:
        t = time.time()
        try:
            importlib.import_module(f"generators.{name}").build(out, args.thumbs)
            print(f"[{name}] ok in {time.time() - t:.1f}s")
        except Exception:
            import traceback

            traceback.print_exc()
            failed.append(name)
    if failed:
        print(f"FAILED: {', '.join(failed)}")
        sys.exit(1)


main()
