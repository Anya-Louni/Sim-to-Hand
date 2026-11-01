// npm run results [-- --check]: rebuild every table, figure and doc number from committed data (no API calls).
// Uses research/.venv if it exists, otherwise `python` on PATH (needs research/requirements.txt installed).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const venv = ['research/.venv/Scripts/python.exe', 'research/.venv/bin/python'].find((p) => fs.existsSync(p));
const py = process.env.PYTHON ?? venv ?? 'python';
const r = spawnSync(py, ['research/scripts/regenerate.py', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
