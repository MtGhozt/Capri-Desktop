import unittest
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import server


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
