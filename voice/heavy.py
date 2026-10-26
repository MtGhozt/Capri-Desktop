"""Serialize torch / transformers / omnivoice imports (they are not thread-safe)."""
from __future__ import annotations

import threading

IMPORT_LOCK = threading.Lock()
_ready = False


def preload_torch(log=None) -> None:
    """Import heavy ML packages once on the caller thread before worker threads start."""
    global _ready
    with IMPORT_LOCK:
        if _ready:
            return
        import torch  # noqa: F401

        if log:
            log(f"torch ready version={torch.__version__} cuda={torch.cuda.is_available()}")
        try:
            import transformers  # noqa: F401

            if log:
                log(f"transformers ready version={getattr(transformers, '__version__', '?')}")
        except Exception as err:
            if log:
                log(f"transformers skip: {err}")
        try:
            import omnivoice  # noqa: F401

            if log:
                log("omnivoice imported")
        except Exception as err:
            if log:
                log(f"omnivoice import skip: {err}")
        _ready = True


def import_torch():
    with IMPORT_LOCK:
        import torch

        return torch


def import_whisper_model():
    with IMPORT_LOCK:
        from faster_whisper import WhisperModel

        return WhisperModel


def import_omnivoice():
    with IMPORT_LOCK:
        import torch
        from omnivoice import OmniVoice, VoiceClonePrompt

        return torch, OmniVoice, VoiceClonePrompt
