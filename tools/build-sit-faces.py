"""Create transparent sitting-face layers from the existing face crops."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "capri"
OUT = SOURCE / "parts"
FACE_BOX = [(76, 76), (165, 76), (184, 112), (181, 207), (76, 207), (74, 115)]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for source in sorted(SOURCE.glob("face-*.png")):
        image = Image.open(source).convert("RGBA")
        alpha = Image.new("L", image.size, 0)
        ImageDraw.Draw(alpha).polygon(FACE_BOX, fill=255)
        image.putalpha(alpha)
        image.save(OUT / source.name, optimize=True)


if __name__ == "__main__":
    main()
