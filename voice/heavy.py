"""Serialize torch / transformers / omnivoice imports (they are not thread-safe)."""
from __future__ import annotations

import threading

IMPORT_LOCK = threading.Lock()
_ready = False
_missing = False


def preload_torch(log=None) -> bool:
    """Import torch and transformers once on the caller thread before worker threads start.

    OmniVoice is imported lazily by import_omnivoice() when the engine is actually
    loaded: importing it at boot used to fail when a pip install was rewriting the
    venv, and it is wasted work when Capri runs in blips/silent mode.

    A light install (setup.ps1 without -OmniVoice) has no torch: that is not fatal,
    STT/wake/Kokoro run on CPU.
    """
    global _ready, _missing
    with IMPORT_LOCK:
        if _ready:
            return True
        if _missing:
            return False
        try:
            import torch  # noqa: F401
        except ImportError as err:
            _missing = True
            if log:
                log(f"torch not installed ({err}); voice runs on CPU (STT, wake, Kokoro)")
            return False

        if log:
            log(f"torch ready version={torch.__version__} cuda={torch.cuda.is_available()}")
        try:
            import transformers  # noqa: F401

            if log:
                log(f"transformers ready version={getattr(transformers, '__version__', '?')}")
        except Exception as err:
            if log:
                log(f"transformers skip: {err}")
        _ready = True
        return True


def import_torch():
    with IMPORT_LOCK:
        import torch

        return torch


def import_whisper_model():
    with IMPORT_LOCK:
        from faster_whisper import WhisperModel

        return WhisperModel


def import_omnivoice(log=None):
    with IMPORT_LOCK:
        import torch
        from omnivoice import OmniVoice, VoiceClonePrompt

        if log:
            log("omnivoice imported")
        return torch, OmniVoice, VoiceClonePrompt
