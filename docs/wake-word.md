# Wake word "Hey Capri"

Capri listens for `hey_capri.onnx` in `voice/models/` and falls back to the built-in `hey_jarvis`
model (one log line says so) when the file isn't there.

## Train it (no personal recordings)

Use openWakeWord's official automatic training notebook: synthetic TTS samples, nothing of your
voice leaves the PC.

1. Open the notebook from the openWakeWord repo (`notebooks/automatic_model_training.ipynb`) in
   Google Colab and run it top to bottom.
2. Set the target phrase to `hey capri`. Optionally add variants like `hey ca pri` or `oye capri`;
   more variants usually means more false triggers.
3. Run all cells, then download the resulting `.onnx`.

## Install it

- Drop the file at `voice/models/hey_capri.onnx`, or set `voice.wakeModel` in config to its path
  (relative paths resolve from `voice/models/`).
- Restart the app. `voice.log` should say `wake word .../hey_capri.onnx ready`.
- Tune `voice.wakeThreshold` (start at 0.5): raise it if she wakes on the TV, lower it if she
  misses you.

Models stay out of git: `voice/models/*` is ignored except the folder's `.gitkeep`.
