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

test('granular playback adapts its window for cleaner slowed audio', () => {
  const neutral = Engine.granularPlaybackOptions({ speed: 1, pitch: 0, fineTune: 0 });
  const slowed = Engine.granularPlaybackOptions({ speed: 0.7, pitch: -2, fineTune: 0 });
  const deepSlowed = Engine.granularPlaybackOptions({ speed: 0.4, pitch: -5, fineTune: -20 });
  assert.deepEqual(neutral, { playbackRate: 1, detune: 0, grainSize: 0.16, overlap: 0.055, loop: false });
  assert.ok(slowed.grainSize > neutral.grainSize);
  assert.ok(slowed.overlap > neutral.overlap);
  assert.ok(deepSlowed.grainSize > slowed.grainSize);
  assert.ok(deepSlowed.overlap > slowed.overlap);
  assert.ok(deepSlowed.overlap < deepSlowed.grainSize);
  assert.ok(deepSlowed.overlap <= 0.095);
});

test('granular playback options clamp unsafe transport values', () => {
  const options = Engine.granularPlaybackOptions({ speed: 9, pitch: -40, fineTune: -500 });
  assert.equal(options.playbackRate, 2);
  assert.equal(options.detune, -1300);
  assert.ok(options.grainSize >= 0.13 && options.grainSize <= 0.27);
  assert.ok(options.overlap >= 0.05 && options.overlap <= 0.095);
});

test('transport restarts only when changing between dry and granular sources', () => {
  const slowed = { speed: 0.75, pitch: 0, fineTune: 0 };
  const pitchShifted = { speed: 0.75, pitch: -1, fineTune: 0 };
  const neutral = { speed: 1, pitch: 0, fineTune: 0 };
  assert.equal(Engine.granularRequired(slowed, 'modified'), false);
  assert.equal(Engine.granularRequired(pitchShifted, 'modified'), true);
  assert.equal(Engine.transportNeedsRestart('dry', true, slowed, 'modified'), false);
  assert.equal(Engine.transportNeedsRestart('dry', true, pitchShifted, 'modified'), true);
  assert.equal(Engine.transportNeedsRestart('grain', true, pitchShifted, 'modified'), false);
  assert.equal(Engine.transportNeedsRestart('grain', true, neutral, 'modified'), true);
  assert.equal(Engine.transportNeedsRestart('dry', false, slowed, 'modified'), false);
  assert.equal(Engine.transportNeedsRestart('dry', true, slowed, 'original'), false);
});

test('speed-only slowed playback creates exactly one regular player source', () => {
  const previousTone = globalThis.Tone;
  const created = { players: 0, grains: 0 };
  class FakePlayer {
    constructor(buffer) { this.buffer = buffer; this.playbackRate = 1; created.players += 1; }
    connect(target) { this.target = target; }
    disconnect() {}
    dispose() {}
  }
  class FakeGrainPlayer extends FakePlayer {
    constructor(options) { super(options.url); created.players -= 1; created.grains += 1; }
  }
  globalThis.Tone = { Player: FakePlayer, GrainPlayer: FakeGrainPlayer };
  try {
    const engine = new Engine.AudioEngine();
    engine.graph = { input: {}, bypassInput: {} };
    engine.workingBuffer = { duration: 10, sampleRate: 44100 };
    engine.effectState = { speed: 0.75, pitch: 0, fineTune: 0 };
    engine.createSource();
    assert.equal(created.players, 1);
    assert.equal(created.grains, 0);
    assert.equal(engine.sourceKind, 'dry');
    assert.equal(engine.source.playbackRate, 0.75);
  } finally {
    globalThis.Tone = previousTone;
  }
});
