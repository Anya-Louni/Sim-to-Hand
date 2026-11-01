"""Probe which free VLM endpoints accept an image right now. Prints status only, never keys."""
import base64, io, os, time
import requests
from dotenv import load_dotenv
from PIL import Image

load_dotenv()
img = Image.new("RGB", (64, 64), (220, 30, 30))
buf = io.BytesIO(); img.save(buf, "PNG"); b64 = base64.b64encode(buf.getvalue()).decode()
q = "What color is this image? Answer with one word."

def gemini(model):
    r = requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
        json={"contents": [{"parts": [{"text": q}, {"inlineData": {"mimeType": "image/png", "data": b64}}]}]}, timeout=60)
    if not r.ok: return f"HTTP {r.status_code} {r.text[:120]}"
    return r.json()["candidates"][0]["content"]["parts"][-1]["text"].strip()[:40]

def groq(model):
    r = requests.post("https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
        json={"model": model, "messages": [{"role": "user", "content": [{"type": "text", "text": q},
              {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}]}]}, timeout=60)
    lim = {k: v for k, v in r.headers.items() if k.startswith("x-ratelimit")}
    if not r.ok: return f"HTTP {r.status_code} {r.text[:120]} {lim}"
    return r.json()["choices"][0]["message"]["content"].strip()[:40] + f"  {lim}"

for name, fn, m in [("gemini", gemini, x) for x in ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash", "gemma-4-31b-it", "gemma-4-26b-a4b-it"]] + [("groq", groq, "qwen/qwen3.8-27b")]:
    t = time.time()
    try: out = fn(m)
    except Exception as e: out = f"ERR {e}"
    print(f"{name:7s} {m:24s} {time.time()-t:5.1f}s  {out}")
