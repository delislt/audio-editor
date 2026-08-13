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
  assert.ok(Export.effectTailSeconds({ reverb: 50, echo: 0 }) >= 2);
  assert.equal(Export.extensionFor('m4a'), 'm4a');
  assert.equal(Export.mimeFor('flac'), 'audio/flac');
});

test('tape-style playback combines speed, pitch and fine tune into one rate', () => {
  assert.equal(Engine.playbackRateForState({ speed: 1, pitch: 0, fineTune: 0 }, 'modified'), 1);
  assert.equal(Engine.playbackRateForState({ speed: 0.75, pitch: 0, fineTune: 0 }, 'modified'), 0.75);
  assert.equal(Engine.playbackRateForState({ speed: 1, pitch: 12, fineTune: 0 }, 'modified'), 2);
  assert.equal(Engine.playbackRateForState({ speed: 1, pitch: -12, fineTune: 0 }, 'modified'), 0.5);
  assert.ok(Engine.playbackRateForState({ speed: 1, pitch: 0, fineTune: 50 }, 'modified') > 1);
  assert.equal(Engine.playbackRateForState({ speed: 0.5, pitch: -12, fineTune: -100 }, 'original'), 1);
});

test('tape-style playback clamps unsafe control values before calculating its rate', () => {
  const expected = 2 * Math.pow(2, 13 / 12);
  assert.equal(Engine.playbackRateForState({ speed: 9, pitch: 40, fineTune: 500 }, 'modified'), expected);
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
    assert.equal(engine.source.playbackRate, 1.5);
  } finally {
    globalThis.Tone = previousTone;
  }
});
