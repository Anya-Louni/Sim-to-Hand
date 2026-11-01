"""Upload the dataset to the Hugging Face Hub (uses the locally cached login)."""
import shutil
import sys
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent.parent
REPO = sys.argv[1] if len(sys.argv) > 1 else "lilizzz4444/vision-cant-feel"
api = HfApi()
api.create_repo(REPO, repo_type="dataset", exist_ok=True, private=False)
with tempfile.TemporaryDirectory() as tmp:
    t = Path(tmp)
    shutil.copy(ROOT / "docs" / "DATASET_CARD.md", t / "README.md")
    for split, src in [("small", "data/small"), ("large", "data/large"), ("sensor_train_s1", "data/sensor_train_s1"), ("sensor_train_s2", "data/sensor_train_s2")]:
        shutil.copytree(ROOT / src, t / split, ignore=shutil.ignore_patterns("*.tmp.npz"))
    for name in ("attack",):
        if (ROOT / "results" / name).exists():
            shutil.copytree(ROOT / "results" / name, t / "attack")
    api.upload_folder(folder_path=str(t), repo_id=REPO, repo_type="dataset", commit_message="Upload Vision Can't Feel dataset")
print(f"https://huggingface.co/datasets/{REPO}")
