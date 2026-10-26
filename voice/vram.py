"""How much GPU memory the sidecar may spend, given Gemma may load later."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
from urllib.parse import urlparse

GEMMA_RESERVE_MIB = 4500
VRAM_WARN_MIB = 300


def usable_vram_mib(free_mib, llm_loaded, reserve_mib=GEMMA_RESERVE_MIB) -> int:
    free = max(0, int(free_mib or 0))
    if llm_loaded:
        return free
    return max(0, free - max(0, int(reserve_mib or 0)))


def origin_from_base_url(base_url: str) -> str:
    raw = str(base_url or "").strip() or "http://localhost:1235/v1"
    parsed = urlparse(raw if "://" in raw else f"http://{raw}")
    if not parsed.scheme or not parsed.netloc:
        return "http://localhost:1235"
    return f"{parsed.scheme}://{parsed.netloc}"


def model_is_loaded(payload) -> bool:
    rows = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return False
    for row in rows:
        if not isinstance(row, dict):
            continue
        state = str(row.get("state") or row.get("status") or "").strip().lower()
        if state == "loaded":
            return True
    return False


def _fetch_json(url: str, timeout: float = 1.0):
    req = urllib.request.Request(url, headers={"User-Agent": "capri-desktop"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8") or "{}")


def lms_ps_loaded() -> bool:
    bin_name = "lms.exe" if sys.platform == "win32" else "lms"
    home = os.path.expanduser("~")
    candidates = [
        bin_name,
        os.path.join(home, ".lmstudio", "bin", bin_name),
    ]
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    for path in candidates:
        try:
            out = subprocess.check_output(
                [path, "ps"],
                text=True,
                timeout=3,
                stderr=subprocess.DEVNULL,
                creationflags=flags,
            )
        except Exception:
            continue
        text = (out or "").lower()
        if "loaded" in text and "identifier" in text:
            return True
        lines = [ln.strip() for ln in (out or "").splitlines() if ln.strip()]
        if len(lines) >= 2 and not lines[-1].lower().startswith("no "):
            # a body row under the header usually means something is resident
            if "loaded" in text:
                return True
    return False


def llm_has_model(base_url: str, timeout: float = 1.0) -> bool:
    origin = origin_from_base_url(base_url)
    try:
        data = _fetch_json(f"{origin}/api/v0/models", timeout=timeout)
        return model_is_loaded(data)
    except Exception:
        pass
    return lms_ps_loaded()
