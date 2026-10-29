"""Normalize LLM text so Kokoro can read it in Spanish."""
from __future__ import annotations

import re
import unicodedata

_MD_FENCE = re.compile(r"```[\s\S]*?```")
_INLINE_CODE = re.compile(r"`([^`]+)`")
_BOLD = re.compile(r"\*\*|__")
_ITALIC = re.compile(r"(?<!\w)[*_]([^*_]+)[*_](?!\w)")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s*", re.M)
_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_STRIKE = re.compile(r"~~([^~]+)~~")
_TIME = re.compile(r"\b(\d{1,2}):(\d{2})\b")
_NUM = re.compile(r"\b\d{1,6}\b")
_SPACE = re.compile(r"\s+")

_ONES = [
    "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
    "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
    "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
    "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
]
_TENS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]
_HUNDREDS = [
    "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
    "seiscientos", "setecientos", "ochocientos", "novecientos",
]


def int_es(n: int) -> str:
    if n < 0:
        return "menos " + int_es(-n)
    if n < 30:
        return _ONES[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        if ones == 0:
            return _TENS[tens]
        return f"{_TENS[tens]} y {_ONES[ones]}"
    if n == 100:
        return "cien"
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        head = "cien" if hundreds == 1 and rest == 0 else _HUNDREDS[hundreds]
        return head if rest == 0 else f"{head} {int_es(rest)}"
    if n < 1_000_000:
        thousands, rest = divmod(n, 1000)
        head = "mil" if thousands == 1 else f"{int_es(thousands)} mil"
        return head if rest == 0 else f"{head} {int_es(rest)}"
    return str(n)


def _time_es(match: re.Match) -> str:
    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour > 23 or minute > 59:
        return match.group(0)
    spoken = int_es(hour)
    if minute == 0:
        return spoken
    if minute < 10:
        return f"{spoken} cero {int_es(minute)}"
    return f"{spoken} {int_es(minute)}"


def _strip_emoji(text: str) -> str:
    out = []
    for ch in text:
        if ch in "*#":
            continue
        cat = unicodedata.category(ch)
        if cat.startswith("S") or cat in ("So", "Sk", "Cs"):
            continue
        code = ord(ch)
        if 0x1F000 <= code <= 0x1FAFF or 0x2600 <= code <= 0x27BF or 0xFE00 <= code <= 0xFE0F:
            continue
        if code == 0x200D:
            continue
        out.append(ch)
    return "".join(out)


def pause_for_tts(text: str) -> str:
    """Turn colon / dash / ellipsis / line breaks into spoken pauses so she breathes."""
    raw = str(text or "")
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    raw = re.sub(r"\n+", ". ", raw)
    raw = raw.replace("…", ". ").replace("...", ". ")
    raw = raw.replace("—", ", ").replace("–", ", ")
    # times already expanded by _TIME; leftover "Spoiler:" becomes a pause
    raw = re.sub(r"\s*:\s*", ". ", raw)
    return raw


def clean_for_tts(text: str) -> str:
    raw = str(text or "")
    raw = _MD_FENCE.sub(" ", raw)
    raw = _INLINE_CODE.sub(r"\1", raw)
    raw = _LINK.sub(r"\1", raw)
    raw = _STRIKE.sub(r"\1", raw)
    raw = _BOLD.sub("", raw)
    raw = _ITALIC.sub(r"\1", raw)
    raw = _HEADING.sub("", raw)
    raw = raw.replace("\\n", "\n")
    raw = _strip_emoji(raw)
    raw = _TIME.sub(_time_es, raw)
    raw = pause_for_tts(raw)
    raw = _NUM.sub(lambda m: int_es(int(m.group(0))), raw)
    raw = raw.replace(">", " ").replace("<", " ")
    return _SPACE.sub(" ", raw).strip(" -—,:;")
