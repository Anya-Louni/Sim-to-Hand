"""docs/demo.gif: each task's minimal pair, alternating success and failure, with ground truth."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
rows = [json.loads(l) for l in open(ROOT / "data/large/samples.jsonl")]
font = ImageFont.load_default(size=22)
frames = []
for task in ["stack", "grasp", "button", "peg", "push"]:
    pair = next(r["pair"] for r in rows if r["task"] == task and r["valid_pair"] and r["intended"] == "failure" and r["mag_mm"] < 1.5)
    for _ in range(2):
        for side in ("success", "failure"):
            r = next(x for x in rows if x["id"] == f"{pair}-{side}")
            im = Image.open(ROOT / "data/large" / r["images"]["left"]).resize((420, 420)).convert("RGB")
            d = ImageDraw.Draw(im)
            text = f"{task}: {'SUCCESS' if r['label'] else 'FAILURE'}"
            if not r["label"]:
                text += f" ({r['mag_mm']:.1f} mm)"
            d.rectangle([0, 0, 420, 34], fill=(20, 20, 20))
            d.text((10, 5), text, fill=(120, 230, 140) if r["label"] else (250, 120, 110), font=font)
            frames.append(im)
frames[0].save(ROOT / "docs/demo.gif", save_all=True, append_images=frames[1:], duration=900, loop=0, optimize=True)
print("frames", len(frames), (ROOT / "docs/demo.gif").stat().st_size // 1024, "KB")
