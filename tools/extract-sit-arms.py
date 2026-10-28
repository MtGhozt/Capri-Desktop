"""Extract candidate arm layers from a lying pose sheet.

The source poses are 2x standing-sprite pixels. The output is intentionally
separate from the originals and is not used by the renderer until the angle
matches the sitting rig.
"""
from pathlib import Path
import json
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "capri" / "poses" / "lying_A.png"
OUT = ROOT / "assets" / "capri" / "parts"
BOXES = {
    "arm_L": (112, 382, 286, 616),
    "arm_R": (248, 398, 478, 574),
}
PIVOTS = {
    "arm_L": {"x": 169, "y": 414},
    "arm_R": {"x": 278, "y": 438},
}


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE
    image = Image.open(source).convert("RGBA")
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"source": str(source.relative_to(ROOT)), "scale": 0.5, "parts": {}}
    for name, box in BOXES.items():
        image.crop(box).save(OUT / f"{name}.png", optimize=True)
        pivot = PIVOTS[name]
        meta["parts"][name] = {
            "file": f"{name}.png",
            "pivot": {
                "x": pivot["x"] - box[0],
                "y": pivot["y"] - box[1],
            },
            "sourceBox": box,
        }
    (OUT / "parts.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
