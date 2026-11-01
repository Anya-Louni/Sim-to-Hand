"""Run each task once per variant and print the outcome."""
import sys, time
import numpy as np
from vcf.model import compiled, TASKS
from vcf.tasks import TASK_CLASSES

for name in (sys.argv[1].split(",") if len(sys.argv) > 1 else TASKS):
    t0 = time.time(); task = TASK_CLASSES[name](compiled(name)); tc = time.time() - t0
    for variant in ("success", "failure"):
        rng = np.random.default_rng(1)
        L = task.reset(rng)
        lo, hi = task.fail_range
        t = time.time()
        a = task.attempt(L, variant, (lo + hi) / 2, rng)
        s = a.sensors
        print(f"{name:6s} {variant:7s} label={a.label} realized={a.realized*1000:6.2f}mm  {a.rule}  "
              f"[touch max {s[:,1].max():.2f}/{s[:,2].max():.2f} N, grip {s[-1,3]:.1f} N, wrist z {s[-1,4]:.2f} N, n={len(s)}] {time.time()-t:.1f}s (compile {tc:.1f}s)")
