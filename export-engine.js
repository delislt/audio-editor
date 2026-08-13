(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AudioEditorExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function requireBrowserDependency(name, value) {
    if (!value) throw new Error(`${name} did not load. Reload the page and try again.`);
    return value;
  }

  function clamp(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
  }

  function report(onProgress, value, message) {
    if (typeof onProgress === 'function') onProgress(clamp(value, 0, 1), message);
  }

  function effectTailSeconds(state) {
    const reverbTail = clamp(state.reverb, 0, 100) > 0 ? 2.05 : 0;
    const echoTail = clamp(state.echo, 0, 100) > 0 ? 1.8 : 0;
    return Math.max(reverbTail, echoTail);
  }

  async function renderProcessedAudio(buffer, effectState, exportSettings, onProgress) {
    const Tone = requireBrowserDependency('Tone.js', root.Tone);
    const engineApi = requireBrowserDependency('The audio engine', root.AudioEditorEngine);
    if (!buffer || !buffer.numberOfChannels || !buffer.length) throw new Error('There is no audio to export.');
    const state = effectState || {};
    const speed = clamp(state.speed, 0.25, 2);
    const channels = Number(exportSettings.channels) === 1 ? 1 : 2;
    const sampleRate = Number(exportSettings.sampleRate) === 48000 ? 48000 : 44100;
    const duration = Math.max(0.02, buffer.duration / speed + effectTailSeconds(state));
    report(onProgress, 0.03, 'Rendering effects...');
    const rendered = await Tone.Offline(async () => {
      const graph = engineApi.createToneEffectGraph(state, { toDestination: true });
      let source;
      if (!engineApi.granularRequired(state, 'modified')) {
        source = new Tone.Player(buffer);
        source.playbackRate = speed;
      } else {
        source = new Tone.GrainPlayer({
          url: buffer,
          ...engineApi.granularPlaybackOptions(state),
        });
      }
      source.connect(graph.input);
      source.start(0, 0);
    }, duration, channels, sampleRate);
    report(onProgress, 0.55, 'Encoding file...');
    const nativeBuffer = typeof rendered.get === 'function' ? rendered.get() : rendered;
    if (!nativeBuffer || !nativeBuffer.length) throw new Error('The rendered audio is empty.');
    return nativeBuffer;
  }

  function writeAscii(view, offset, text) {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
  }

  function encodeWav(audioBuffer, bitDepth) {
    const bits = Number(bitDepth) === 24 ? 24 : 16;
    const bytesPerSample = bits / 8;
    const channels = audioBuffer.numberOfChannels;
    const frameCount = audioBuffer.length;
    const dataBytes = frameCount * channels * bytesPerSample;
    const output = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(output);
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, audioBuffer.sampleRate, true);
    view.setUint32(28, audioBuffer.sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bits, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataBytes, true);
    const channelData = Array.from({ length: channels }, (_, index) => audioBuffer.getChannelData(index));
    let offset = 44;
    for (let frame = 0; frame < frameCount; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = clamp(channelData[channel][frame], -1, 1);
        if (bits === 16) {
          view.setInt16(offset, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true);
          offset += 2;
        } else {
          let integer = sample < 0 ? Math.round(sample * 0x800000) : Math.round(sample * 0x7fffff);
          if (integer < 0) integer += 0x1000000;
          view.setUint8(offset, integer & 0xff);
          view.setUint8(offset + 1, (integer >> 8) & 0xff);
          view.setUint8(offset + 2, (integer >> 16) & 0xff);
          offset += 3;
        }
      }
    }
    return new Blob([output], { type: 'audio/wav' });
  }

  function encodeMp3(audioBuffer, bitrate, onProgress) {
    const lamejs = requireBrowserDependency('The MP3 encoder', root.lamejs);
    const channels = Math.min(2, audioBuffer.numberOfChannels);
    const encoder = new lamejs.Mp3Encoder(channels, audioBuffer.sampleRate, clamp(bitrate, 128, 320));
    const left = audioBuffer.getChannelData(0);
    const right = channels === 2 ? audioBuffer.getChannelData(1) : null;
    const sampleBlockSize = 1152;
    const encoded = [];
    const convert = (source, start, end) => {
      const target = new Int16Array(end - start);
      for (let index = start; index < end; index++) {
        const sample = clamp(source[index], -1, 1);
        target[index - start] = sample < 0 ? sample * 32768 : sample * 32767;
      }
      return target;
    };
    for (let start = 0; start < audioBuffer.length; start += sampleBlockSize) {
      const end = Math.min(audioBuffer.length, start + sampleBlockSize);
      const leftBlock = convert(left, start, end);
      const bytes = channels === 2
        ? encoder.encodeBuffer(leftBlock, convert(right, start, end))
        : encoder.encodeBuffer(leftBlock);
      if (bytes.length) encoded.push(new Uint8Array(bytes));
      if (start % (sampleBlockSize * 80) === 0) report(onProgress, 0.58 + 0.39 * start / audioBuffer.length, 'Encoding MP3...');
    }
    const finalBytes = encoder.flush();
    if (finalBytes.length) encoded.push(new Uint8Array(finalBytes));
    return new Blob(encoded, { type: 'audio/mpeg' });
  }

  function ensureMediabunnyEncoder(format) {
    const media = requireBrowserDependency('The lossless/AAC export library', root.Mediabunny);
    if (format === 'flac') {
      const extension = requireBrowserDependency('The FLAC encoder', root.MediabunnyFlacEncoder);
      extension.registerFlacEncoder();
    } else {
      const extension = requireBrowserDependency('The AAC encoder', root.MediabunnyAacEncoder);
      extension.registerAacEncoder();
    }
    return media;
  }

  async function encodeMediabunny(audioBuffer, format, bitrate, onProgress) {
    const media = ensureMediabunnyEncoder(format);
    const target = new media.BufferTarget();
    const outputFormat = format === 'flac'
      ? new media.FlacOutputFormat()
      : new media.Mp4OutputFormat({ fastStart: 'in-memory' });
    const output = new media.Output({ format: outputFormat, target });
    const encoding = { codec: format === 'flac' ? 'flac' : 'aac' };
    if (format !== 'flac') encoding.bitrate = clamp(bitrate, 128, 320) * 1000;
    const source = new media.AudioBufferSource(encoding);
    output.addAudioTrack(source);
    try {
      await output.start();
      report(onProgress, 0.64, format === 'flac' ? 'Encoding FLAC...' : 'Encoding M4A/AAC...');
      await source.add(audioBuffer);
      report(onProgress, 0.94, 'Finalizing file...');
      await output.finalize();
    } catch (error) {
      try { await output.cancel(); } catch (cancelError) {}
      throw error;
    }
    if (!target.buffer) throw new Error('The encoder did not produce a file.');
    const mime = format === 'flac' ? 'audio/flac' : 'audio/mp4';
    return new Blob([target.buffer], { type: mime });
  }

  function extensionFor(format) {
    return format === 'm4a' ? 'm4a' : format;
  }

  function mimeFor(format) {
    return ({ wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4' })[format] || 'application/octet-stream';
  }

  async function exportAudio(options) {
    const settings = options.settings || {};
    const format = String(settings.format || 'wav').toLowerCase();
    if (!['wav', 'mp3', 'flac', 'm4a'].includes(format)) throw new Error('Choose a supported export format.');
    const rendered = await renderProcessedAudio(options.buffer, options.effectState, settings, options.onProgress);
    let blob;
    if (format === 'wav') blob = encodeWav(rendered, settings.bitDepth);
    else if (format === 'mp3') blob = encodeMp3(rendered, Number(settings.bitrate), options.onProgress);
    else blob = await encodeMediabunny(rendered, format, Number(settings.bitrate), options.onProgress);
    report(options.onProgress, 1, 'Export complete.');
    return {
      blob,
      renderedBuffer: rendered,
      format,
      extension: extensionFor(format),
      mimeType: mimeFor(format),
    };
  }

  return {
    effectTailSeconds,
    encodeMediabunny,
    encodeMp3,
    encodeWav,
    exportAudio,
    extensionFor,
    mimeFor,
    renderProcessedAudio,
  };
});
