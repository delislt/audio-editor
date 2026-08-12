(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AudioEditorCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PRESET_SCHEMA_VERSION = 1;
  const EPSILON = 1e-6;

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function dbToGain(db) {
    return Math.pow(10, Number(db) / 20);
  }

  function gainToDb(gain) {
    const value = Math.max(Number(gain) || 0, 1e-8);
    return 20 * Math.log10(value);
  }

  function assertBufferData(buffer) {
    if (!buffer || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0) {
      throw new Error('Invalid audio sample rate.');
    }
    if (!Array.isArray(buffer.channels) || buffer.channels.length === 0) {
      throw new Error('Audio must contain at least one channel.');
    }
    const length = buffer.channels[0] && buffer.channels[0].length;
    if (!Number.isInteger(length) || length <= 0) throw new Error('Audio buffer is empty.');
    buffer.channels.forEach((channel) => {
      if (!(channel instanceof Float32Array) || channel.length !== length) {
        throw new Error('Audio channels must be equally sized Float32Array instances.');
      }
    });
    return buffer;
  }

  function bufferLength(buffer) {
    return assertBufferData(buffer).channels[0].length;
  }

  function bufferDuration(buffer) {
    return bufferLength(buffer) / buffer.sampleRate;
  }

  function cloneBufferData(buffer) {
    assertBufferData(buffer);
    return {
      sampleRate: buffer.sampleRate,
      channels: buffer.channels.map((channel) => new Float32Array(channel)),
    };
  }

  function bufferByteLength(buffer) {
    assertBufferData(buffer);
    return buffer.channels.reduce((total, channel) => total + channel.byteLength, 0);
  }

  function normalizeSelection(selection, duration) {
    if (!selection || !Number.isFinite(selection.start) || !Number.isFinite(selection.end)) return null;
    const start = clamp(Math.min(selection.start, selection.end), 0, duration);
    const end = clamp(Math.max(selection.start, selection.end), 0, duration);
    if (end - start <= EPSILON) return null;
    return { start, end, duration: end - start };
  }

  function timeToX(time, duration, width) {
    if (!(duration > 0) || !(width > 0)) return 0;
    return clamp(time, 0, duration) / duration * width;
  }

  function xToTime(x, duration, width) {
    if (!(duration > 0) || !(width > 0)) return 0;
    return clamp(x, 0, width) / width * duration;
  }

  function selectionToFrames(buffer, selection) {
    const normalized = normalizeSelection(selection, bufferDuration(buffer));
    if (!normalized) throw new Error('Select a non-empty audio region first.');
    const length = bufferLength(buffer);
    const startFrame = clamp(Math.floor(normalized.start * buffer.sampleRate), 0, length - 1);
    const endFrame = clamp(Math.ceil(normalized.end * buffer.sampleRate), startFrame + 1, length);
    return { startFrame, endFrame, selection: normalized };
  }

  function copyRange(buffer, selection) {
    assertBufferData(buffer);
    const { startFrame, endFrame } = selectionToFrames(buffer, selection);
    return {
      sampleRate: buffer.sampleRate,
      channels: buffer.channels.map((channel) => channel.slice(startFrame, endFrame)),
    };
  }

  function trimBuffer(buffer, selection) {
    return copyRange(buffer, selection);
  }

  function deleteRange(buffer, selection) {
    assertBufferData(buffer);
    const { startFrame, endFrame } = selectionToFrames(buffer, selection);
    const sourceLength = bufferLength(buffer);
    const removed = endFrame - startFrame;
    const outputLength = sourceLength - removed;
    if (outputLength <= 0) throw new Error('This operation would create an empty audio file.');
    const channels = buffer.channels.map((channel) => {
      const output = new Float32Array(outputLength);
      output.set(channel.subarray(0, startFrame), 0);
      output.set(channel.subarray(endFrame), startFrame);
      return output;
    });
    return { sampleRate: buffer.sampleRate, channels };
  }

  function convertClipboardChannels(clipboard, targetChannelCount) {
    assertBufferData(clipboard);
    if (clipboard.channels.length === targetChannelCount) {
      return clipboard.channels.map((channel) => new Float32Array(channel));
    }
    if (targetChannelCount === 1) {
      const length = bufferLength(clipboard);
      const mono = new Float32Array(length);
      clipboard.channels.forEach((channel) => {
        for (let i = 0; i < length; i++) mono[i] += channel[i] / clipboard.channels.length;
      });
      return [mono];
    }
    if (clipboard.channels.length === 1) {
      return Array.from({ length: targetChannelCount }, () => new Float32Array(clipboard.channels[0]));
    }
    return Array.from({ length: targetChannelCount }, (_, index) => (
      new Float32Array(clipboard.channels[Math.min(index, clipboard.channels.length - 1)])
    ));
  }

  function resampleChannelLinear(channel, fromRate, toRate) {
    if (fromRate === toRate) return new Float32Array(channel);
    const outputLength = Math.max(1, Math.round(channel.length * toRate / fromRate));
    const output = new Float32Array(outputLength);
    const ratio = fromRate / toRate;
    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio;
      const left = Math.min(channel.length - 1, Math.floor(position));
      const right = Math.min(channel.length - 1, left + 1);
      const fraction = position - left;
      output[i] = channel[left] + (channel[right] - channel[left]) * fraction;
    }
    return output;
  }

  function pasteBuffer(buffer, clipboard, time) {
    assertBufferData(buffer);
    assertBufferData(clipboard);
    const targetLength = bufferLength(buffer);
    const insertFrame = clamp(Math.round(clamp(time, 0, bufferDuration(buffer)) * buffer.sampleRate), 0, targetLength);
    const converted = convertClipboardChannels(clipboard, buffer.channels.length)
      .map((channel) => resampleChannelLinear(channel, clipboard.sampleRate, buffer.sampleRate));
    const insertedLength = converted[0].length;
    const channels = buffer.channels.map((channel, index) => {
      const output = new Float32Array(targetLength + insertedLength);
      output.set(channel.subarray(0, insertFrame), 0);
      output.set(converted[index], insertFrame);
      output.set(channel.subarray(insertFrame), insertFrame + insertedLength);
      return output;
    });
    return {
      buffer: { sampleRate: buffer.sampleRate, channels },
      insertedSelection: {
        start: insertFrame / buffer.sampleRate,
        end: (insertFrame + insertedLength) / buffer.sampleRate,
      },
    };
  }

  function reverseBuffer(buffer, selection) {
    assertBufferData(buffer);
    const output = cloneBufferData(buffer);
    let startFrame = 0;
    let endFrame = bufferLength(buffer);
    const normalized = normalizeSelection(selection, bufferDuration(buffer));
    if (normalized) ({ startFrame, endFrame } = selectionToFrames(buffer, normalized));
    output.channels.forEach((channel) => {
      let left = startFrame;
      let right = endFrame - 1;
      while (left < right) {
        const value = channel[left];
        channel[left++] = channel[right];
        channel[right--] = value;
      }
    });
    return output;
  }

  function fadeBuffer(buffer, selection, direction, fallbackSeconds) {
    assertBufferData(buffer);
    const output = cloneBufferData(buffer);
    const length = bufferLength(buffer);
    const normalized = normalizeSelection(selection, bufferDuration(buffer));
    let startFrame;
    let endFrame;
    if (normalized) {
      ({ startFrame, endFrame } = selectionToFrames(buffer, normalized));
    } else {
      const fadeFrames = Math.max(1, Math.min(length, Math.round((fallbackSeconds || 3) * buffer.sampleRate)));
      startFrame = direction === 'in' ? 0 : length - fadeFrames;
      endFrame = direction === 'in' ? fadeFrames : length;
    }
    const span = Math.max(1, endFrame - startFrame - 1);
    output.channels.forEach((channel) => {
      for (let frame = startFrame; frame < endFrame; frame++) {
        const phase = (frame - startFrame) / span;
        const gain = direction === 'in'
          ? Math.sin(phase * Math.PI / 2)
          : Math.cos(phase * Math.PI / 2);
        channel[frame] *= gain;
      }
    });
    return output;
  }

  function getPeak(buffer) {
    assertBufferData(buffer);
    let peak = 0;
    buffer.channels.forEach((channel) => {
      for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
    });
    return peak;
  }

  function normalizeBuffer(buffer, targetDb) {
    assertBufferData(buffer);
    const peak = getPeak(buffer);
    if (peak <= EPSILON) return cloneBufferData(buffer);
    const target = dbToGain(Number.isFinite(targetDb) ? targetDb : -1);
    const multiplier = target / peak;
    const output = cloneBufferData(buffer);
    output.channels.forEach((channel) => {
      for (let i = 0; i < channel.length; i++) channel[i] *= multiplier;
    });
    return output;
  }

  function analyzeSilence(buffer, options) {
    assertBufferData(buffer);
    const thresholdDb = clamp(options && options.thresholdDb, -90, -6);
    const minimumDuration = clamp(options && options.minimumDuration, 0.05, 30);
    const threshold = dbToGain(thresholdDb);
    const sampleRate = buffer.sampleRate;
    const length = bufferLength(buffer);
    const windowFrames = Math.max(1, Math.round(sampleRate * 0.02));
    const minimumFrames = Math.round(minimumDuration * sampleRate);
    const silentWindows = [];

    for (let start = 0; start < length; start += windowFrames) {
      const end = Math.min(length, start + windowFrames);
      let sumSquares = 0;
      let samples = 0;
      for (let channelIndex = 0; channelIndex < buffer.channels.length; channelIndex++) {
        const channel = buffer.channels[channelIndex];
        for (let frame = start; frame < end; frame++) {
          sumSquares += channel[frame] * channel[frame];
          samples++;
        }
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, samples));
      silentWindows.push({ start, end, silent: rms <= threshold });
    }

    const intervals = [];
    let runStart = null;
    silentWindows.forEach((window, index) => {
      if (window.silent && runStart === null) runStart = window.start;
      const atEnd = index === silentWindows.length - 1;
      if (runStart !== null && (!window.silent || atEnd)) {
        const runEnd = window.silent && atEnd ? window.end : window.start;
        if (runEnd - runStart >= minimumFrames) {
          const safetyPadding = Math.min(Math.round(sampleRate * 0.015), Math.floor((runEnd - runStart) / 4));
          const start = runStart + safetyPadding;
          const end = runEnd - safetyPadding;
          if (end > start) intervals.push({ start, end });
        }
        runStart = null;
      }
    });

    const removedFrames = intervals.reduce((total, interval) => total + interval.end - interval.start, 0);
    return {
      thresholdDb,
      minimumDuration,
      intervals,
      removedFrames,
      removedSeconds: removedFrames / sampleRate,
    };
  }

  function removeSilence(buffer, options) {
    const analysis = analyzeSilence(buffer, options);
    if (!analysis.intervals.length) return { buffer: cloneBufferData(buffer), analysis };
    const sourceLength = bufferLength(buffer);
    const ranges = [];
    let cursor = 0;
    analysis.intervals.forEach((interval) => {
      if (interval.start > cursor) ranges.push({ start: cursor, end: interval.start });
      cursor = interval.end;
    });
    if (cursor < sourceLength) ranges.push({ start: cursor, end: sourceLength });
    if (!ranges.length) throw new Error('Silence removal would create an empty audio file.');

    const joins = [];
    for (let index = 1; index < ranges.length; index++) {
      joins.push(Math.min(
        Math.round(buffer.sampleRate * 0.005),
        Math.floor((ranges[index - 1].end - ranges[index - 1].start) / 2),
        Math.floor((ranges[index].end - ranges[index].start) / 2),
      ));
    }
    const outputLength = ranges.reduce((total, range) => total + range.end - range.start, 0)
      - joins.reduce((total, value) => total + value, 0);
    if (outputLength <= 0) throw new Error('Silence removal would create an empty audio file.');

    const channels = buffer.channels.map((channel) => {
      const output = new Float32Array(outputLength);
      let writePosition = 0;
      ranges.forEach((range, rangeIndex) => {
        const segment = channel.subarray(range.start, range.end);
        if (rangeIndex === 0) {
          output.set(segment, 0);
          writePosition = segment.length;
          return;
        }
        const fade = joins[rangeIndex - 1];
        for (let i = 0; i < fade; i++) {
          const phase = (i + 1) / (fade + 1) * Math.PI / 2;
          const outputIndex = writePosition - fade + i;
          output[outputIndex] = output[outputIndex] * Math.cos(phase) + segment[i] * Math.sin(phase);
        }
        output.set(segment.subarray(fade), writePosition);
        writePosition += segment.length - fade;
      });
      return output;
    });
    return { buffer: { sampleRate: buffer.sampleRate, channels }, analysis };
  }

  function formatFileSize(bytes) {
    const size = Math.max(0, Number(bytes) || 0);
    if (size < 1024 * 1024) return (size / 1024).toFixed(size < 10240 ? 1 : 0) + ' KB';
    return (size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  }

  function detectAudioFormat(file) {
    const name = file && file.name ? String(file.name) : '';
    const mime = file && file.type ? String(file.type).toLowerCase() : '';
    const extensionMatch = name.toLowerCase().match(/\.([a-z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[1] : '';
    const extensionMap = { mp3: 'MP3', wav: 'WAV', wave: 'WAV', flac: 'FLAC', m4a: 'M4A', aac: 'AAC', ogg: 'OGG', oga: 'OGG' };
    if (extensionMap[extension]) return extensionMap[extension];
    if (/flac/.test(mime)) return 'FLAC';
    if (/wav|wave/.test(mime)) return 'WAV';
    if (/mpeg|mp3/.test(mime)) return 'MP3';
    if (/aac/.test(mime)) return 'AAC';
    if (/m4a|mp4/.test(mime)) return 'M4A';
    if (/ogg/.test(mime)) return 'OGG';
    return 'AUDIO';
  }

  function sanitizeBaseName(value) {
    const cleaned = String(value || '')
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim();
    return cleaned || 'audio-edited';
  }

  function buildExportFilename(value, extension) {
    const ext = String(extension || 'wav').toLowerCase().replace(/[^a-z0-9]/g, '') || 'wav';
    return sanitizeBaseName(value) + '.' + ext;
  }

  function defaultEditedFilename(originalName, extension) {
    return buildExportFilename(sanitizeBaseName(originalName) + '-edited', extension);
  }

  function validateExportSettings(settings) {
    const format = ['wav', 'mp3', 'flac', 'm4a'].includes(settings && settings.format) ? settings.format : 'wav';
    const sampleRate = [44100, 48000].includes(Number(settings && settings.sampleRate))
      ? Number(settings.sampleRate) : 44100;
    const channels = Number(settings && settings.channels) === 1 ? 1 : 2;
    const bitDepth = [16, 24].includes(Number(settings && settings.bitDepth)) ? Number(settings.bitDepth) : 16;
    const allowedBitrates = format === 'm4a' ? [128, 192, 256, 320] : [128, 192, 256, 320];
    const bitrate = allowedBitrates.includes(Number(settings && settings.bitrate)) ? Number(settings.bitrate) : 192;
    return { format, sampleRate, channels, bitDepth, bitrate };
  }

  function createPresetRecord(name, effects) {
    const label = String(name || '').trim();
    if (!label) throw new Error('Enter a preset name.');
    return {
      id: 'preset-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name: label.slice(0, 48),
      presetSchemaVersion: PRESET_SCHEMA_VERSION,
      effects: JSON.parse(JSON.stringify(effects || {})),
    };
  }

  function parsePresetCollection(value) {
    if (!value) return [];
    let parsed;
    try { parsed = typeof value === 'string' ? JSON.parse(value) : value; } catch (error) { return []; }
    if (!parsed || parsed.presetSchemaVersion !== PRESET_SCHEMA_VERSION || !Array.isArray(parsed.presets)) return [];
    return parsed.presets.filter((preset) => (
      preset && typeof preset.id === 'string' && typeof preset.name === 'string'
      && preset.presetSchemaVersion === PRESET_SCHEMA_VERSION && preset.effects && typeof preset.effects === 'object'
    )).map((preset) => ({
      id: preset.id,
      name: preset.name.slice(0, 48),
      presetSchemaVersion: PRESET_SCHEMA_VERSION,
      effects: JSON.parse(JSON.stringify(preset.effects)),
    }));
  }

  function serializePresetCollection(presets) {
    return JSON.stringify({ presetSchemaVersion: PRESET_SCHEMA_VERSION, presets: parsePresetCollection({ presetSchemaVersion: PRESET_SCHEMA_VERSION, presets }) });
  }

  function cloneSnapshot(snapshot) {
    if (!snapshot || !snapshot.buffer) throw new Error('Invalid history snapshot.');
    return {
      buffer: cloneBufferData(snapshot.buffer),
      selection: snapshot.selection ? { start: snapshot.selection.start, end: snapshot.selection.end } : null,
      playhead: Number(snapshot.playhead) || 0,
      label: String(snapshot.label || ''),
    };
  }

  class AudioHistory {
    constructor(options) {
      this.maxEntries = clamp(options && options.maxEntries || 12, 1, 50);
      this.maxBytes = clamp(options && options.maxBytes || 256 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024);
      this.undoStack = [];
      this.redoStack = [];
      this.undoBytes = 0;
      this.redoBytes = 0;
    }

    _entry(snapshot) {
      const value = cloneSnapshot(snapshot);
      return { value, bytes: bufferByteLength(value.buffer) };
    }

    _trimUndo() {
      while (this.undoStack.length > this.maxEntries || this.undoBytes > this.maxBytes) {
        const removed = this.undoStack.shift();
        this.undoBytes -= removed.bytes;
      }
    }

    push(snapshot) {
      const entry = this._entry(snapshot);
      this.undoStack.push(entry);
      this.undoBytes += entry.bytes;
      this.redoStack = [];
      this.redoBytes = 0;
      this._trimUndo();
    }

    undo(currentSnapshot) {
      if (!this.undoStack.length) return null;
      const current = this._entry(currentSnapshot);
      this.redoStack.push(current);
      this.redoBytes += current.bytes;
      const entry = this.undoStack.pop();
      this.undoBytes -= entry.bytes;
      return cloneSnapshot(entry.value);
    }

    redo(currentSnapshot) {
      if (!this.redoStack.length) return null;
      const current = this._entry(currentSnapshot);
      this.undoStack.push(current);
      this.undoBytes += current.bytes;
      this._trimUndo();
      const entry = this.redoStack.pop();
      this.redoBytes -= entry.bytes;
      return cloneSnapshot(entry.value);
    }

    clear() {
      this.undoStack = [];
      this.redoStack = [];
      this.undoBytes = 0;
      this.redoBytes = 0;
    }

    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }
  }

  return {
    PRESET_SCHEMA_VERSION,
    AudioHistory,
    analyzeSilence,
    assertBufferData,
    bufferByteLength,
    bufferDuration,
    bufferLength,
    buildExportFilename,
    clamp,
    cloneBufferData,
    copyRange,
    createPresetRecord,
    dbToGain,
    defaultEditedFilename,
    deleteRange,
    detectAudioFormat,
    fadeBuffer,
    formatFileSize,
    gainToDb,
    getPeak,
    normalizeBuffer,
    normalizeSelection,
    parsePresetCollection,
    pasteBuffer,
    removeSilence,
    reverseBuffer,
    sanitizeBaseName,
    selectionToFrames,
    serializePresetCollection,
    timeToX,
    trimBuffer,
    validateExportSettings,
    xToTime,
  };
});
