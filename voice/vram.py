"""How much GPU memory the sidecar may spend, given Gemma may load later."""
from __future__ import annotations

import json
import urllib.request

GEMMA_RESERVE_MIB = 4500


def usable_vram_mib(free_mib, llm_loaded, reserve_mib=GEMMA_RESERVE_MIB) -> int:
    free = max(0, int(free_mib or 0))
    if llm_loaded:
        return free
    return max(0, free - max(0, int(reserve_mib or 0)))


def llm_has_model(base_url: str, timeout: float = 1.0) -> bool:
    url = str(base_url or "").rstrip("/") + "/models"
    if not url.startswith("http"):
        return False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "capri-desktop"})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            data = json.loads(res.read().decode("utf-8") or "{}")
        rows = data.get("data") if isinstance(data, dict) else None
        return bool(rows)
    except Exception:
        return False
