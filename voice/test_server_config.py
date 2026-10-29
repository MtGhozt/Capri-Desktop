import unittest
import asyncio
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
import server


class WakeModelTests(unittest.TestCase):
    def test_bare_name_resolves_to_the_custom_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp) / "hey_capri.onnx"
            model.write_bytes(b"onnx")
            name, fell_back = server.resolve_wake_model("hey_capri", Path(tmp))
            self.assertEqual((name, fell_back), (str(model), False))

    def test_relative_path_resolves_from_the_models_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp) / "custom.onnx"
            model.write_bytes(b"onnx")
            name, fell_back = server.resolve_wake_model("custom.onnx", Path(tmp))
            self.assertEqual((name, fell_back), (str(model), False))

    def test_builtin_name_stays_builtin(self):
        with tempfile.TemporaryDirectory() as tmp:
            name, fell_back = server.resolve_wake_model("hey_jarvis", Path(tmp))
            self.assertEqual((name, fell_back), ("hey_jarvis", False))

    def test_missing_model_falls_back_to_hey_jarvis(self):
        with tempfile.TemporaryDirectory() as tmp:
            name, fell_back = server.resolve_wake_model("hey_capri", Path(tmp))
            self.assertEqual((name, fell_back), ("hey_jarvis", True))


class UtteranceTests(unittest.TestCase):
    def test_one_utterance_is_one_transcript(self):
        engine = server.Engine.__new__(server.Engine)
        engine._lock = __import__("threading").Lock()
        engine.capturing = True
        engine.buffer = np.zeros(4000, dtype=np.float32)
        engine.speech_ms = 400.0
        engine.silence_ms = 800.0
        engine.follow = False
        engine.follow_s = 0.0
        engine.cfg = {"debugSave": False}
        engine.arm_wake = lambda: None
        engine.transcribe = lambda _audio: "Hola Capri, pon música"
        seen = []
        engine.broadcast = seen.append
        asyncio.run(engine.finish(reason="vad"))
        transcripts = [item for item in seen if item.get("type") == "transcript"]
        self.assertEqual(len(transcripts), 1)
        self.assertEqual(transcripts[0]["text"], "Hola Capri, pon música")


class ServerConfigTests(unittest.TestCase):
    def engine(self, cfg=None):
        engine = server.Engine.__new__(server.Engine)
        engine.cfg = {
            "enabled": True,
            "inputDevice": None,
            "muted": False,
            "sleeping": False,
            "replyMode": "voice",
            "tts": "auto",
            "localLlm": True,
        }
        engine.cfg.update(cfg or {})
        engine._omni = None
        engine._omni_loading = False
        engine._tts = None
        engine._want_tts = False
        engine._cfg_ready = False
        engine._sleep_since = 0
        engine._mic_off_since = 0
        engine.restart_stream = lambda: None
        engine.stop_speak = lambda: None
        engine._drop_tts = lambda _reason: setattr(engine, "_want_tts", False)
        engine.start_tts = lambda: setattr(engine, "_want_tts", True)
        return engine

    def test_apply_cfg_accepts_local_llm_and_retries_tts(self):
        engine = self.engine()
        engine.apply_cfg({"localLlm": False})
        self.assertIs(engine.cfg["localLlm"], False)
        self.assertTrue(engine._want_tts)

    def test_cloud_config_has_no_gemma_reserve(self):
        engine = self.engine({"localLlm": False})
        with patch.object(server, "free_vram_mib", return_value=2400), \
             patch.object(server, "usable_vram_mib", side_effect=lambda free, loaded, reserve: free - reserve):
            free, usable, loaded = engine._vram_budget()
        self.assertEqual((free, usable, loaded), (2400, 2400, False))


if __name__ == "__main__":
    unittest.main()
