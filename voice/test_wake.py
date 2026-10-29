"""Feed 16 kHz mono PCM through the same hey_jarvis path as server.py."""
from __future__ import annotations

import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from server import (  # noqa: E402
    SAMPLE_RATE,
    WAKE_FRAME,
    WAKE_THRESHOLD,
    as_pcm16,
    load_openwakeword,
    resolve_wake_model,
    wake_score_max,
)


def resample_int16(pcm: np.ndarray, sr: int) -> np.ndarray:
    if sr == SAMPLE_RATE:
        return pcm.astype(np.int16)
    n = int(round(len(pcm) * SAMPLE_RATE / sr))
    x_old = np.linspace(0.0, 1.0, num=len(pcm), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n, endpoint=False)
    y = np.interp(x_new, x_old, pcm.astype(np.float32))
    return np.clip(y, -32768, 32767).astype(np.int16)


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wav:
        sr = wav.getframerate()
        ch = wav.getnchannels()
        raw = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)
    if ch > 1:
        raw = raw.reshape(-1, ch).mean(axis=1).astype(np.int16)
    return resample_int16(raw, sr)


def write_wav16(path: Path, pcm: np.ndarray) -> None:
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(np.ascontiguousarray(pcm, dtype=np.int16).tobytes())


def tts_hey_jarvis(dest: Path) -> None:
    ps = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        f"$s.SetOutputToWaveFile('{str(dest).replace(chr(39), chr(39)+chr(39))}'); "
        "$s.Rate = -2; $s.Speak('hey jarvis'); $s.Dispose()"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)


def load_model():
    Model, download_models = load_openwakeword()
    # the clip below says "hey jarvis": score it against whatever that name resolves to
    model, _fell_back = resolve_wake_model("hey_jarvis")
    if not model.lower().endswith(".onnx"):
        download_models(model_names=[model])
    return Model(wakeword_models=[model], inference_framework="onnx")


def score_clip(model, wav_path: Path) -> float:
    peak = 0.0
    for rec in model.predict_clip(str(wav_path)):
        p, named = wake_score_max(rec)
        peak = max(peak, p)
        if p >= 0.1:
            print(f"  predict_clip score={p:.3f} {named}")
    return peak


def score_frames(model, pcm: np.ndarray) -> float:
    peak = 0.0
    model.reset()
    for i in range(0, max(0, pcm.size - WAKE_FRAME + 1), WAKE_FRAME):
        f32 = pcm[i:i + WAKE_FRAME].astype(np.float32) / 32768.0
        p, named = wake_score_max(model.predict(as_pcm16(f32)))
        peak = max(peak, p)
        if p >= 0.1:
            print(f"  frame {i} score={p:.3f} {named}")
    return peak


def main() -> int:
    dest = Path(tempfile.gettempdir()) / "capri-hey-jarvis.wav"
    print("synthesizing hey jarvis via SAPI...")
    tts_hey_jarvis(dest)
    pcm = read_wav(dest)
    silence = np.zeros(SAMPLE_RATE, dtype=np.int16)
    pcm = np.concatenate([silence, pcm, silence])
    clip16 = Path(tempfile.gettempdir()) / "capri-hey-jarvis-16k.wav"
    write_wav16(clip16, pcm)
    rms = float(np.sqrt(np.mean(pcm.astype(np.float32) ** 2)))
    print(f"clip n={pcm.size} sr={SAMPLE_RATE} dtype={pcm.dtype} rms={rms:.1f} mono=1")
    model = load_model()
    clip_peak = score_clip(model, clip16)
    frame_peak = score_frames(model, pcm)
    peak = max(clip_peak, frame_peak)
    print(f"predict_clip peak={clip_peak:.3f} frame-loop peak={frame_peak:.3f} threshold={WAKE_THRESHOLD}")
    print("HIT" if peak >= WAKE_THRESHOLD else "MISS")
    return 0 if peak >= WAKE_THRESHOLD else 1


if __name__ == "__main__":
    raise SystemExit(main())
