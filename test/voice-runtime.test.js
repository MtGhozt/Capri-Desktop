'use strict';

// Native DLL failures are not transient: no VC++ x64 runtime means no wake word and no STT.
// She must classify them, stop retrying, and keep STT marked unavailable instead of raising
// from the executor ("Future exception was never retrieved") on every utterance.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { skip, py } = require('./voice-py');

const WAKE_DLL = 'DLL load failed while importing onnxruntime_pybind11_state: No se puede encontrar el módulo especificado.';
const STT_DLL = "Could not find module 'C:\\voice\\.venv\\Lib\\site-packages\\ctranslate2\\ctranslate2.dll' (or one of its dependencies). Try using the full path with constructor syntax.";

test('DLL errors are classified as a missing native runtime', { skip: skip() }, () => {
  const out = py(`
from server import native_runtime_module
print(native_runtime_module(Exception(${JSON.stringify(WAKE_DLL)})))
print(native_runtime_module(FileNotFoundError(${JSON.stringify(STT_DLL)})))
print(native_runtime_module(Exception('mic failed: device busy')))
`);
  assert.deepEqual(out.split(/\r?\n/), ['onnxruntime_pybind11_state', 'ctranslate2.dll', 'None']);
});

test('the wake word does not retry a DLL load error', { skip: skip() }, () => {
  const out = py(`
import asyncio
import server

calls = []
def boom():
    calls.append(1)
    raise Exception(${JSON.stringify(WAKE_DLL)})

server.load_openwakeword = boom
server.time.sleep = lambda s: None
engine = server.Engine(asyncio.new_event_loop(), 'test')
engine.cfg['wakeModel'] = 'hey_mycroft'  # a builtin name: no model file needed
ok = engine._load_wake()
print(len(calls), ok, engine.cfg['wakeMode'], engine._runtime_reported)
`);
  assert.deepEqual(out.trim().split(/\r?\n/).pop().split(/\s+/), ['1', 'False', 'whisper', 'True']);
});

test('an STT load failure is kept, not raised on every utterance', { skip: skip() }, () => {
  const out = py(`
import asyncio
import server

calls = []
def boom():
    calls.append(1)
    raise FileNotFoundError(${JSON.stringify(STT_DLL)})

engine = server.Engine(asyncio.new_event_loop(), 'test')
engine.cfg['wakeWord'] = False
engine._vad = server.EnergyVAD()
engine._load_whisper = boom
engine.ensure_stt()
engine.ensure_stt()
try:
    engine.transcribe(None)
    print('no error')
except RuntimeError as err:
    print(len(calls), bool(engine._stt_error), 'ctranslate2' in str(err))
`);
  assert.deepEqual(out.trim().split(/\r?\n/).pop().split(/\s+/), ['1', 'True', 'True']);
});

test('the whisper load timeout outlasts a slow CPU first load', { skip: skip() }, () => {
  const out = py('import server; print(server.WHISPER_LOAD_S)');
  assert.equal(Number(out), 240, 'a 60 s timeout killed the ~180 s CPU warmup');
});

test('a warmup already in progress is not started again', { skip: skip() }, () => {
  const out = py(`
import asyncio
import threading
import server

calls = []
started = threading.Event()
release = threading.Event()

def slow():
    calls.append(1)
    started.set()
    release.wait(5)
    return object()

engine = server.Engine(asyncio.new_event_loop(), 'test')
engine.cfg['wakeWord'] = False
engine._vad = server.EnergyVAD()
engine._load_whisper = slow
worker = threading.Thread(target=engine.ensure_stt)
worker.start()
started.wait(2)
engine.ensure_stt()  # must return at once instead of queueing a second warmup
print(len(calls))
release.set()
worker.join(5)
print(len(calls), engine._whisper is not None)
`);
  assert.deepEqual(out.trim().split(/\r?\n/).slice(-2), ['1', '1 True']);
});
