const test = require('node:test');
const assert = require('node:assert/strict');
const Export = require('../export-engine.js');
const Engine = require('../audio-engine.js');

function fakeAudioBuffer(channels, sampleRate = 44100) {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    getChannelData(index) { return channels[index]; },
  };
}

test('WAV encoder writes valid 16-bit stereo metadata and interleaved data', async () => {
  const input = fakeAudioBuffer([
    new Float32Array([0, 1, -1]),
    new Float32Array([0.5, -0.5, 0.25]),
  ]);
  const blob = Export.encodeWav(input, 16);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...bytes.subarray(8, 12)), 'WAVE');
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(bytes.length, 44 + 3 * 2 * 2);
  assert.equal(view.getInt16(46, true), 16384);
});

test('WAV encoder writes real 24-bit PCM payload size', async () => {
  const input = fakeAudioBuffer([new Float32Array([0, 1, -1, 0.25])], 48000);
  const blob = Export.encodeWav(input, 24);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(34, true), 24);
  assert.equal(view.getUint32(40, true), 12);
  assert.equal(bytes.length, 56);
});

test('effect tail and output metadata reflect the selected format', () => {
  assert.equal(Export.effectTailSeconds({ reverb: 0, echo: 0 }), 0);
  assert.equal(Export.effectTailSeconds({ reverb: 0, echo: 0, pitch: 5, fineTune: 0 }), 0.12);
  assert.ok(Export.effectTailSeconds({ reverb: 50, echo: 0 }) >= 2);
  assert.equal(Export.extensionFor('m4a'), 'm4a');
  assert.equal(Export.mimeFor('flac'), 'audio/flac');
});

test('playback rate follows speed without being changed by pitch or fine tune', () => {
  assert.equal(Engine.playbackRateForState({ speed: 1, pitch: 0, fineTune: 0 }, 'modified'), 1);
  assert.equal(Engine.playbackRateForState({ speed: 0.75, pitch: 0, fineTune: 0 }, 'modified'), 0.75);
  assert.equal(Engine.playbackRateForState({ speed: 1, pitch: 12, fineTune: 0 }, 'modified'), 1);
  assert.equal(Engine.playbackRateForState({ speed: 0.75, pitch: -12, fineTune: -100 }, 'modified'), 0.75);
  assert.equal(Engine.playbackRateForState({ speed: 0.5, pitch: -12, fineTune: -100 }, 'original'), 1);
});

test('dedicated pitch options use a smooth full analysis window without feedback or extra delay', () => {
  assert.deepEqual(Engine.pitchShiftOptions({ pitch: 0, fineTune: 0 }), {
    pitch: 0, windowSize: 0.1, delayTime: 0, feedback: 0, wet: 0,
  });
  assert.deepEqual(Engine.pitchShiftOptions({ pitch: 12, fineTune: 0 }), {
    pitch: 12, windowSize: 0.1, delayTime: 0, feedback: 0, wet: 1,
  });
  assert.equal(Engine.pitchShiftOptions({ pitch: 0, fineTune: 25 }).windowSize, 0.1);
  const clamped = Engine.pitchShiftOptions({ pitch: 40, fineTune: 500 });
  assert.equal(clamped.pitch, 13);
  assert.equal(clamped.wet, 1);
  assert.equal(clamped.windowSize, 0.1);
});

test('8D orbit speed maps to an intuitive live LFO frequency', () => {
  assert.equal(Engine.eightDOrbitFrequency(0.5), 0.125);
  assert.equal(Engine.eightDOrbitFrequency(1), 0.25);
  assert.equal(Engine.eightDOrbitFrequency(2), 0.5);
  assert.equal(Engine.eightDOrbitFrequency(5), 1.25);
  assert.equal(Engine.eightDOrbitFrequency(99), 1.25);
});

test('pitch-shifted playback creates exactly one regular player source', () => {
  const previousTone = globalThis.Tone;
  const created = { players: 0 };
  class FakePlayer {
    constructor(buffer) { this.buffer = buffer; this.playbackRate = 1; created.players += 1; }
    connect(target) { this.target = target; }
    disconnect() {}
    dispose() {}
  }
  globalThis.Tone = { Player: FakePlayer };
  try {
    const engine = new Engine.AudioEngine();
    engine.graph = { input: {}, bypassInput: {} };
    engine.workingBuffer = { duration: 10, sampleRate: 44100 };
    engine.effectState = { speed: 0.75, pitch: 12, fineTune: 0 };
    engine.createSource();
    assert.equal(created.players, 1);
    assert.equal(engine.sourceKind, 'single');
    assert.equal(engine.source.playbackRate, 0.75);
  } finally {
    globalThis.Tone = previousTone;
  }
});

test('pitch-shifted export keeps the selected tempo and creates one source', async () => {
  const previousTone = globalThis.Tone;
  const previousEngine = globalThis.AudioEditorEngine;
  const observed = { players: 0 };
  class FakePlayer {
    constructor(buffer) { this.buffer = buffer; this.playbackRate = 1; observed.players += 1; }
    set playbackRate(value) { this._playbackRate = value; observed.playbackRate = value; }
    get playbackRate() { return this._playbackRate; }
    connect(target) { this.target = target; }
    start(time, offset) { observed.start = [time, offset]; }
  }
  globalThis.Tone = {
    Player: FakePlayer,
    async Offline(callback, duration, channels, sampleRate) {
      observed.offline = { duration, channels, sampleRate };
      await callback();
      return { get() { return { length: 4 }; } };
    },
  };
  globalThis.AudioEditorEngine = {
    playbackRateForState: Engine.playbackRateForState,
    createToneEffectGraph() { return { input: {} }; },
  };
  try {
    const buffer = { numberOfChannels: 2, length: 441000, duration: 10 };
    await Export.renderProcessedAudio(buffer, { speed: 0.75, pitch: 12, fineTune: 0, reverb: 0, echo: 0 }, { channels: 2, sampleRate: 44100 });
    assert.equal(observed.players, 1);
    assert.equal(observed.playbackRate, 0.75);
    assert.equal(observed.offline.duration, 10 / 0.75 + 0.12);
    assert.deepEqual(observed.start, [0, 0]);
  } finally {
    globalThis.Tone = previousTone;
    globalThis.AudioEditorEngine = previousEngine;
  }
});
