'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../audio-editor-core.js');

function makeBuffer(channels, sampleRate = 10) {
  return { sampleRate, channels: channels.map((channel) => Float32Array.from(channel)) };
}

function values(buffer, channel = 0) {
  return Array.from(buffer.channels[channel], (value) => Number(value.toFixed(5)));
}

test('time and waveform coordinates round-trip and clamp', () => {
  assert.equal(core.timeToX(5, 10, 1000), 500);
  assert.equal(core.xToTime(500, 10, 1000), 5);
  assert.equal(core.timeToX(20, 10, 1000), 1000);
  assert.equal(core.xToTime(-5, 10, 1000), 0);
});

test('selection is normalized using audio time', () => {
  assert.deepEqual(core.normalizeSelection({ start: 8, end: 2 }, 10), { start: 2, end: 8, duration: 6 });
  assert.equal(core.normalizeSelection({ start: 2, end: 2 }, 10), null);
});

test('copy, trim, cut and delete preserve channel alignment', () => {
  const source = makeBuffer([[0, 1, 2, 3, 4, 5], [10, 11, 12, 13, 14, 15]], 2);
  const selection = { start: 0.5, end: 2 };
  const copied = core.copyRange(source, selection);
  assert.deepEqual(values(copied), [1, 2, 3]);
  assert.deepEqual(values(copied, 1), [11, 12, 13]);
  assert.deepEqual(values(core.trimBuffer(source, selection)), [1, 2, 3]);
  assert.deepEqual(values(core.deleteRange(source, selection)), [0, 4, 5]);
});

test('delete rejects an empty result', () => {
  const source = makeBuffer([[1, 2, 3]], 1);
  assert.throws(() => core.deleteRange(source, { start: 0, end: 3 }), /empty audio/i);
});

test('paste inserts at the playhead and converts mono to stereo', () => {
  const target = makeBuffer([[1, 2, 3], [4, 5, 6]], 1);
  const clipboard = makeBuffer([[9, 8]], 1);
  const result = core.pasteBuffer(target, clipboard, 1);
  assert.deepEqual(values(result.buffer), [1, 9, 8, 2, 3]);
  assert.deepEqual(values(result.buffer, 1), [4, 9, 8, 5, 6]);
  assert.deepEqual(result.insertedSelection, { start: 1, end: 3 });
});

test('paste resamples clipboard to the working sample rate', () => {
  const target = makeBuffer([[0, 0]], 4);
  const clipboard = makeBuffer([[1, 0]], 2);
  const result = core.pasteBuffer(target, clipboard, 0);
  assert.equal(result.buffer.channels[0].length, 6);
  assert.deepEqual(values(result.buffer).slice(0, 4), [1, 0.5, 0, 0]);
});

test('reverse affects selection or the full buffer', () => {
  const source = makeBuffer([[1, 2, 3, 4]], 1);
  assert.deepEqual(values(core.reverseBuffer(source, { start: 1, end: 3 })), [1, 3, 2, 4]);
  assert.deepEqual(values(core.reverseBuffer(source, null)), [4, 3, 2, 1]);
  assert.deepEqual(values(source), [1, 2, 3, 4]);
});

test('fade in and fade out modify working samples without mutating the source', () => {
  const source = makeBuffer([[1, 1, 1, 1, 1]], 1);
  const fadeIn = core.fadeBuffer(source, { start: 0, end: 5 }, 'in', 3);
  const fadeOut = core.fadeBuffer(source, { start: 0, end: 5 }, 'out', 3);
  assert.equal(fadeIn.channels[0][0], 0);
  assert.ok(fadeIn.channels[0][4] > 0.999);
  assert.ok(fadeOut.channels[0][0] > 0.999);
  assert.ok(Math.abs(fadeOut.channels[0][4]) < 1e-6);
  assert.deepEqual(values(source), [1, 1, 1, 1, 1]);
});

test('peak normalization reaches the requested level', () => {
  const source = makeBuffer([[0.25, -0.5]], 2);
  const output = core.normalizeBuffer(source, -1);
  assert.ok(Math.abs(core.gainToDb(core.getPeak(output)) + 1) < 0.001);
});

test('silence analysis respects threshold and minimum duration', () => {
  const samples = new Float32Array(200);
  samples.fill(0.5, 0, 40);
  samples.fill(0, 40, 160);
  samples.fill(0.5, 160);
  const source = { sampleRate: 100, channels: [samples] };
  const analysis = core.analyzeSilence(source, { thresholdDb: -40, minimumDuration: 0.5 });
  assert.equal(analysis.intervals.length, 1);
  assert.ok(analysis.removedSeconds > 1);
  const result = core.removeSilence(source, { thresholdDb: -40, minimumDuration: 0.5 });
  assert.ok(result.buffer.channels[0].length < source.channels[0].length);
  assert.ok(result.buffer.channels[0].length > 0);
});

test('short pauses are preserved by remove silence', () => {
  const source = makeBuffer([[1, 1, 0, 0, 1, 1]], 10);
  const result = core.removeSilence(source, { thresholdDb: -40, minimumDuration: 0.5 });
  assert.deepEqual(values(result.buffer), values(source));
});

test('history provides bounded undo and redo snapshots', () => {
  const history = new core.AudioHistory({ maxEntries: 2, maxBytes: 1024 * 1024 });
  const a = { buffer: makeBuffer([[1]], 1), selection: null, playhead: 0, label: 'a' };
  const b = { buffer: makeBuffer([[2]], 1), selection: null, playhead: 0, label: 'b' };
  const c = { buffer: makeBuffer([[3]], 1), selection: null, playhead: 0, label: 'c' };
  history.push(a);
  history.push(b);
  assert.equal(history.canUndo, true);
  const previous = history.undo(c);
  assert.deepEqual(values(previous.buffer), [2]);
  assert.equal(history.canRedo, true);
  const next = history.redo(previous);
  assert.deepEqual(values(next.buffer), [3]);
});

test('file size and format metadata are deterministic', () => {
  assert.equal(core.formatFileSize(1536), '1.5 KB');
  assert.equal(core.formatFileSize(8.4 * 1024 * 1024), '8.4 MB');
  assert.equal(core.detectAudioFormat({ name: 'track.FLAC', type: '' }), 'FLAC');
  assert.equal(core.detectAudioFormat({ name: 'track', type: 'audio/mp4' }), 'M4A');
});

test('filename handling sanitizes invalid characters and avoids duplicate extensions', () => {
  assert.equal(core.defaultEditedFilename('my.song.mp3', 'flac'), 'my.song-edited.flac');
  assert.equal(core.buildExportFilename('bad:name.wav', 'mp3'), 'bad-name.mp3');
});

test('preset serialization is versioned and rejects incompatible data', () => {
  const preset = core.createPresetRecord('Mine', { speed: 0.8, pitch: -2 });
  const json = core.serializePresetCollection([preset]);
  const restored = core.parsePresetCollection(json);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].presetSchemaVersion, 1);
  assert.deepEqual(restored[0].effects, { speed: 0.8, pitch: -2 });
  assert.deepEqual(core.parsePresetCollection('{"presetSchemaVersion":99,"presets":[]}'), []);
});

test('dB conversions and export settings validation stay finite', () => {
  assert.ok(Math.abs(core.gainToDb(core.dbToGain(-6)) + 6) < 1e-9);
  assert.equal(core.protectiveGainDb(0, 3, -1), -4.2);
  assert.equal(core.protectiveGainDb(-3, -4, -1), -3);
  assert.equal(core.protectiveGainDb(4, 30, -1), -12);
  assert.equal(core.protectiveGainDb(-2, Number.NaN, -1), -2);
  assert.deepEqual(core.validateExportSettings({ format: 'flac', sampleRate: 48000, channels: 1, bitDepth: 24, bitrate: 256 }), {
    format: 'flac', sampleRate: 48000, channels: 1, bitDepth: 24, bitrate: 256,
  });
  assert.deepEqual(core.validateExportSettings({ format: 'fake' }), {
    format: 'wav', sampleRate: 44100, channels: 2, bitDepth: 16, bitrate: 192,
  });
  assert.equal(core.validateExportSettings({ sampleRate: 96000 }).sampleRate, 44100);
});
