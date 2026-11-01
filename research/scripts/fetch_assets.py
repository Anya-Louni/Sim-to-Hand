"""Download the Franka Panda model from MuJoCo Menagerie (Apache-2.0) at a pinned commit."""
import shutil
import subprocess
import tempfile
from pathlib import Path

COMMIT = "f3b6013629c7b94f8ee93fd977b161fa8350f9bc"
DEST = Path(__file__).resolve().parent.parent / "assets" / "menagerie_panda"

if (DEST / "panda.xml").exists():
    print("assets already present")
else:
    with tempfile.TemporaryDirectory() as tmp:
        run = lambda *a: subprocess.run(a, cwd=tmp, check=True)
        run("git", "init", "-q")
        run("git", "remote", "add", "origin", "https://github.com/google-deepmind/mujoco_menagerie")
        run("git", "sparse-checkout", "set", "franka_emika_panda")
        run("git", "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", COMMIT)
        run("git", "checkout", "-q", "FETCH_HEAD")
        DEST.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(Path(tmp) / "franka_emika_panda", DEST)
    print("fetched", DEST)
