import unittest
import asyncio
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
import heavy
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

    def test_missing_model_is_missing_not_hey_jarvis(self):
        with tempfile.TemporaryDirectory() as tmp:
            name, missing = server.resolve_wake_model("hey_capri", Path(tmp))
            self.assertEqual((name, missing), (None, True))


class MissingWakeModelTests(unittest.TestCase):
    """No custom model on disk: openWakeWord stays off, Whisper still hears "Capri"."""

    def engine(self):
        engine = server.Engine.__new__(server.Engine)
        engine.cfg = {"wakeModel": "hey_absent_test", "wakeMode": "both", "wakeWord": True}
        engine._wake = None
        engine._whisper = object()
        return engine

    def test_openwakeword_is_never_loaded(self):
        engine = self.engine()
        lines = []
        with patch.object(server, "load_openwakeword") as loader, \
             patch.object(server, "log", lines.append):
            self.assertIs(engine._load_wake(), False)
        loader.assert_not_called()
        self.assertTrue(any("hey_absent_test" in line and "Whisper" in line for line in lines), lines)

    def test_whisper_wake_still_live(self):
        engine = self.engine()
        with patch.object(server, "log"):
            engine._wake = engine._load_wake()
        self.assertFalse(engine.oww_live())
        self.assertTrue(engine.whisper_wake_live())


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
        # wake greeting stripped before the LLM sees the order
        self.assertEqual(transcripts[0]["text"], "pon música")


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
        engine.stream = None
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


class WhisperAutoVramTests(unittest.TestCase):
    """GTX 1650 4 GB: auto used to pick medium cuda (usable ~2900) and time out loading."""

    def engine(self, stt="auto"):
        engine = server.Engine.__new__(server.Engine)
        engine.cfg = {"sttModel": stt, "tts": "kokoro", "localLlm": False, "llmBaseUrl": "http://localhost:1235/v1"}
        engine._stt_beam = 5
        engine.boots = []
        engine._whisper_boot = lambda _cls, name, device, compute, _root: (
            engine.boots.append((name, device, compute)) or object()
        )
        return engine

    def load(self, engine, total):
        with patch.object(server, "free_vram_mib", return_value=3000), \
             patch.object(server, "total_vram_mib", return_value=total), \
             patch.object(server, "usable_vram_mib", side_effect=lambda free, loaded, reserve: free), \
             patch.object(server, "import_whisper_model", return_value=object()), \
             patch.object(server, "log"):
            engine._load_whisper()

    def test_auto_on_4gb_gpu_stays_on_small_cpu(self):
        engine = self.engine()
        self.load(engine, total=4096)
        self.assertEqual(engine.boots, [("small", "cpu", "int8")])

    def test_auto_on_6gb_gpu_still_uses_medium_cuda(self):
        engine = self.engine()
        self.load(engine, total=8192)
        self.assertEqual(engine.boots, [("medium", "cuda", "float16")])

    def test_explicit_medium_tries_cuda_on_a_4gb_gpu(self):
        engine = self.engine("medium")
        self.load(engine, total=4096)
        self.assertEqual(engine.boots[0], ("medium", "cuda", "float16"))


class TorchOptionalTests(unittest.TestCase):
    """Light install (setup.ps1 without -OmniVoice): no torch, and the sidecar still boots."""

    def setUp(self):
        self._saved = (heavy._ready, heavy._missing)
        heavy._ready = False
        heavy._missing = False

    def tearDown(self):
        heavy._ready, heavy._missing = self._saved

    def test_preload_without_torch_does_not_raise(self):
        lines = []
        with patch.dict(sys.modules, {"torch": None}):
            self.assertFalse(heavy.preload_torch(lines.append))
        self.assertTrue(any("torch not installed" in line for line in lines), lines)

    def test_missing_torch_is_logged_once(self):
        lines = []
        with patch.dict(sys.modules, {"torch": None}):
            heavy.preload_torch(lines.append)
            heavy.preload_torch(lines.append)
        self.assertEqual(len(lines), 1)

    def test_only_the_gpu_tts_asks_for_torch(self):
        engine = server.Engine.__new__(server.Engine)
        for kind, wants in (("auto", True), ("omnivoice", True), ("kokoro", False), ("off", False)):
            engine.cfg = {"tts": kind}
            self.assertEqual(engine._tts_wants_gpu(), wants, kind)


class MicDeviceTests(unittest.TestCase):
    def test_extra_settings_only_for_wasapi(self):
        default = type("Default", (), {"device": (3, 4)})()
        with patch.object(server.sys, "platform", "win32"), \
             patch.object(server.sd, "default", default), \
             patch.object(server.sd, "query_devices", return_value={"hostapi": 0}), \
             patch.object(server.sd, "query_hostapis", return_value={"name": "MME"}), \
             patch.object(server.sd, "WasapiSettings") as wasapi:
            self.assertIsNone(server.wasapi_extra_settings(None))
            wasapi.assert_not_called()

    def test_extra_settings_for_wasapi_host(self):
        sentinel = object()
        default = type("Default", (), {"device": (3, 4)})()
        with patch.object(server.sys, "platform", "win32"), \
             patch.object(server.sd, "default", default), \
             patch.object(server.sd, "query_devices", return_value={"hostapi": 0}), \
             patch.object(server.sd, "query_hostapis", return_value={"name": "Windows WASAPI"}), \
             patch.object(server.sd, "WasapiSettings", return_value=sentinel) as wasapi:
            self.assertIs(server.wasapi_extra_settings(None), sentinel)
            wasapi.assert_called_once_with(exclusive=False)

    def test_stream_retries_once_without_extra_settings(self):
        engine = server.Engine.__new__(server.Engine)
        engine.cfg = {"enabled": True, "muted": False, "sleeping": False, "wakeWord": True, "inputDevice": None}
        engine.stream = None
        engine._audio_thread = None
        engine._audio_run = False
        engine._audio_q = server.Queue(maxsize=4)
        engine.events = []
        engine.broadcast = engine.events.append

        class FakeStream:
            samplerate = server.SAMPLE_RATE
            channels = 1

            def start(self):
                pass

            def stop(self):
                pass

            def close(self):
                pass

        calls = []

        def open_stream(**kwargs):
            calls.append(kwargs.get("extra_settings"))
            if len(calls) == 1:
                raise RuntimeError("Incompatible host API specific stream info [PaErrorCode -9984]")
            return FakeStream()

        sentinel = object()
        with patch.object(server, "wasapi_extra_settings", return_value=sentinel), \
             patch.object(server.sd, "InputStream", side_effect=open_stream):
            engine.restart_stream()

        self.assertEqual(calls, [sentinel, None])
        self.assertIsNotNone(engine.stream)
        self.assertIsNone(engine._mic_error)


class TranscriptFilterTests(unittest.TestCase):
    def test_whisper_echoes_on_silence_are_dropped(self):
        for heard in (
            "Matías, Matías, Matías.",
            "Capri",
            "Capri, choom",
            "Sí, sí, sí, sí",
            "   ",
        ):
            self.assertTrue(server.is_hallucination(heard), heard)

    def test_real_speech_is_kept(self):
        for heard in (
            "Hola Capri, ¿cómo estás?",
            "Pon música",
            "Sí, cuéntame",
        ):
            self.assertFalse(server.is_hallucination(heard), heard)


class WakePhraseTests(unittest.TestCase):
    def test_spoken_capri_variants_wake_her(self):
        for heard in ("Capri", "¡Capri!", "oye capri", "Hola, Kapri.", "hey cabri", "capry", "ACAPRI", "HEACAPRI."):
            self.assertTrue(server.wake_phrase_match(heard), heard)

    def test_other_speech_does_not_wake_her(self):
        for heard in ("quiero hablar contigo", "¿cómo estás?", "pon música", "hablar con capri"):
            self.assertFalse(server.wake_phrase_match(heard), heard)

    def test_strip_wake_phrase(self):
        cases = [
            ("Hey Capri", ""),
            ("ACAPRI", ""),
            ("HEACAPRI.", ""),
            ("hey capri pon tu canción", "pon tu canción"),
            ("oye kapri abre spotify", "abre spotify"),
        ]
        for heard, want in cases:
            self.assertEqual(server.strip_wake_phrase(heard), want, heard)


class LowVramWarningTests(unittest.TestCase):
    def test_warning_text_is_neutral_on_cloud(self):
        engine = server.Engine.__new__(server.Engine)
        engine.cfg = {"localLlm": False}
        seen = []
        engine.broadcast = seen.append
        with patch.object(server, "free_vram_mib", return_value=50):
            engine._warn_low_vram()
        message = seen[-1]["message"]
        self.assertIn("La voz puede fallar", message)
        self.assertNotIn("Gemma y OmniVoice", message)
        self.assertNotIn("LM Studio", message)

    def test_warning_text_mentions_lm_studio_when_local(self):
        engine = server.Engine.__new__(server.Engine)
        engine.cfg = {"localLlm": True}
        seen = []
        engine.broadcast = seen.append
        with patch.object(server, "free_vram_mib", return_value=50):
            engine._warn_low_vram()
        self.assertIn("LM Studio", seen[-1]["message"])


if __name__ == "__main__":
    unittest.main()
