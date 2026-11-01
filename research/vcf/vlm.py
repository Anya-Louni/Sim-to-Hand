"""One interface for all VLM judges, with a disk cache keyed by (model, image hashes, prompt).

Providers: gemini (Google AI Studio free tier), groq (free tier), ollama (local).
A cached call is never re-sent.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()
CACHE = Path(__file__).resolve().parent.parent / "cache" / "vlm"

TASK_TEXT = {
    "stack": "The robot is lowering the small cube it holds onto the larger cube. Success means the held cube is resting in contact on top of the larger cube, not hovering above it.",
    "grasp": "The robot closed its gripper to grasp the cube on the table. Success means the cube is held between the two fingers, so lifting the gripper would lift the cube.",
    "button": "The robot is pressing the round button with its closed fingertips. Success means the button is pressed down past its click point, about 4 mm of travel.",
    "peg": "The robot is inserting the square peg into the square hole. Success means the peg is fully seated at the bottom of the hole, not resting on the rim.",
    "push": "The robot pushed the block toward the wall. Success means the block is touching the wall with no gap.",
}


def prompt_for(task: str, n_views: int) -> str:
    views = "this camera image" if n_views == 1 else f"these {n_views} camera images of the same moment from different angles"
    return (
        f"{TASK_TEXT[task]}\nLook at {views}. Did the robot succeed?\n"
        'Reply with only JSON: {"success": true or false, "confidence": number from 0 to 1 that your answer is correct}'
    )


def _key(model: str, images: list[bytes], prompt: str) -> str:
    h = hashlib.sha256(model.encode())
    for b in images:
        h.update(hashlib.sha256(b).digest())
    h.update(prompt.encode())
    return h.hexdigest()


def parse(text: str) -> tuple[bool | None, float | None]:
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            j = json.loads(m.group(0))
            s = j.get("success")
            c = j.get("confidence")
            if isinstance(s, str):
                s = s.strip().lower() in ("true", "yes")
            return (bool(s) if s is not None else None), (float(c) if c is not None else None)
        except (ValueError, TypeError):
            pass
    low = text.lower()
    if re.search(r"\b(true|yes|succeed|success)\b", low) and not re.search(r"\b(false|no|fail)", low):
        return True, None
    if re.search(r"\b(false|no|fail)", low):
        return False, None
    return None, None


def shrink(jpeg: bytes, max_side: int) -> bytes:
    import io

    from PIL import Image

    im = Image.open(io.BytesIO(jpeg))
    if max(im.size) <= max_side:
        return jpeg
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92)
    return buf.getvalue()


class Provider:
    max_side: int | None = None  # local CPU models get smaller images

    def __init__(self, name: str, model: str):
        self.name, self.model = name, model

    @property
    def id(self) -> str:
        return f"{self.name}/{self.model}"

    def _call(self, images: list[bytes], prompt: str) -> str:
        raise NotImplementedError

    def judge(self, images: list[bytes], prompt: str, retries: int = 6) -> dict:
        if self.max_side:
            images = [shrink(b, self.max_side) for b in images]
        key = _key(self.id, images, prompt)
        path = CACHE / self.id.replace("/", "__").replace(":", "_") / f"{key}.json"
        if path.exists():
            return json.loads(path.read_text())
        delay = 10.0
        for attempt in range(retries):
            t0 = time.time()
            try:
                text = self._call(images, prompt)
                success, conf = parse(text)
                out = {"model": self.id, "success": success, "confidence": conf, "raw": text[:2000], "latency_s": round(time.time() - t0, 2)}
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(out))
                return out
            except RateLimited as e:
                if e.daily:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, 300)
            except (requests.RequestException, KeyError, IndexError) as e:
                if attempt == retries - 1:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, 300)
        raise RuntimeError("unreachable")


class RateLimited(Exception):
    def __init__(self, msg: str, daily: bool = False):
        super().__init__(msg)
        self.daily = daily


def _check(r: requests.Response):
    if r.status_code == 429:
        body = r.text.lower()
        raise RateLimited(r.text[:300], daily=("per day" in body or "perday" in body or "requests_per_day" in body or "rpd" in body))
    if r.status_code >= 500:
        raise requests.RequestException(f"{r.status_code} {r.text[:200]}")
    r.raise_for_status()


class Gemini(Provider):
    def __init__(self, model: str):
        super().__init__("gemini", model)

    def _call(self, images, prompt):
        parts = [{"text": prompt}] + [{"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(b).decode()}} for b in images]
        r = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
            headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
            json={"contents": [{"parts": parts}], "generationConfig": {"temperature": 0}},
            timeout=180,
        )
        _check(r)
        return "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"] if not p.get("thought"))


class Groq(Provider):
    def __init__(self, model: str):
        super().__init__("groq", model)

    def _call(self, images, prompt):
        content = [{"type": "text", "text": prompt}] + [
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(b).decode()}} for b in images
        ]
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
            json={"model": self.model, "temperature": 0, "messages": [{"role": "user", "content": content}]},
            timeout=180,
        )
        _check(r)
        return r.json()["choices"][0]["message"]["content"]


class Ollama(Provider):
    max_side = 384

    def __init__(self, model: str):
        super().__init__("ollama", model)

    def _call(self, images, prompt):
        host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
        r = requests.post(
            f"{host}/api/generate",
            json={"model": self.model, "prompt": prompt, "images": [base64.b64encode(b).decode() for b in images], "stream": False, "options": {"temperature": 0}},
            timeout=900,
        )
        _check(r)
        return r.json()["response"]


def provider(spec: str) -> Provider:
    name, model = spec.split("/", 1)
    return {"gemini": Gemini, "groq": Groq, "ollama": Ollama}[name](model)
