(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AudioEditorEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DISPOSABLE_KEYS = [
    'input', 'bypassInput', 'bass', 'mid', 'treble', 'advancedFilters', 'highPass', 'lowPass',
    'vocalLow', 'vocalPresence', 'vocalCompressor', 'widthSplit', 'widthMidGain', 'widthSideGain',
    'widthMerge', 'pan', 'panLfo', 'distortion', 'delay', 'reverbDry', 'reverbConvolver',
    'reverbWet', 'reverbSum', 'processingGain', 'compressor', 'limiterDry', 'limiter',
    'limiterWet', 'output',
  ];

  function getTone() {
    if (!root || !root.Tone) throw new Error('The audio engine could not be loaded. Reload the page and try again.');
    return root.Tone;
  }

  function clamp(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
  }

  function dbToGain(db) {
    return Math.pow(10, Number(db) / 20);
  }

  function granularPlaybackOptions(state) {
    const effects = state || {};
    const playbackRate = clamp(effects.speed, 0.25, 2);
    const detune = clamp(effects.pitch, -12, 12) * 100 + clamp(effects.fineTune, -100, 100);
    const slowDepth = clamp((1 - playbackRate) / 0.75, 0, 1);
    const fastDepth = clamp(playbackRate - 1, 0, 1);
    const pitchDepth = clamp(Math.abs(detune) / 1300, 0, 1);
    // Keep grains long enough to avoid a metallic flutter, but keep their
    // crossfade short. Large overlaps make transients arrive twice and sound
    // like a second, delayed copy of the track.
    const grainSize = clamp(0.16 + slowDepth * 0.08 - fastDepth * 0.035 + pitchDepth * 0.02, 0.13, 0.27);
    const overlap = clamp(0.055 + slowDepth * 0.025 + pitchDepth * 0.01, 0.05, 0.095);
    return {
      playbackRate,
      detune,
      grainSize: Number(grainSize.toFixed(3)),
      overlap: Number(overlap.toFixed(3)),
      loop: false,
    };
  }

  function granularRequired(state, compareMode) {
    if (compareMode === 'original') return false;
    const granular = granularPlaybackOptions(state);
    return Math.abs(granular.playbackRate - 1) > 0.0001 || Math.abs(granular.detune) > 0.01;
  }

  function transportNeedsRestart(sourceKind, playing, state, compareMode) {
    if (!playing || !sourceKind) return false;
    return (sourceKind === 'grain') !== granularRequired(state, compareMode);
  }

  function isIOSDevice() {
    if (!root || !root.navigator) return false;
    return /iPad|iPhone|iPod/.test(root.navigator.userAgent)
      || (root.navigator.platform === 'MacIntel' && root.navigator.maxTouchPoints > 1);
  }

  function createSilentWavUrl() {
    const sampleRate = 8000;
    const sampleCount = 80;
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    const text = (offset, value) => {
      for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + sampleCount * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, sampleCount * 2, true);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  }

  function createImpulseBuffer(Tone, seconds, amount) {
    const rawContext = Tone.getContext().rawContext;
    const sampleRate = rawContext.sampleRate;
    const length = Math.max(1, Math.round(sampleRate * seconds));
    const impulse = rawContext.createBuffer(2, length, sampleRate);
    let seed = 0x1234abcd;
    const decayPower = 2.2 + clamp(amount, 0, 1) * 5.8;
    for (let channelIndex = 0; channelIndex < 2; channelIndex++) {
      const data = impulse.getChannelData(channelIndex);
      for (let index = 0; index < length; index++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const noise = (seed / 0xffffffff) * 2 - 1;
        data[index] = noise * Math.pow(1 - index / length, decayPower);
      }
    }
    return impulse;
  }

  function mapFilterType(type) {
    return ({
      bell: 'peaking',
      lowshelf: 'lowshelf',
      highshelf: 'highshelf',
      lowcut: 'highpass',
      highcut: 'lowpass',
    })[type] || 'peaking';
  }

  function connectWidthGraph(Tone, previous, graph, widthPercent) {
    graph.widthSplit = new Tone.MidSideSplit();
    graph.widthMidGain = new Tone.Gain(1);
    graph.widthSideGain = new Tone.Gain(clamp(widthPercent, 0, 200) / 100);
    graph.widthMerge = new Tone.MidSideMerge();
    previous.connect(graph.widthSplit);
    graph.widthSplit.mid.connect(graph.widthMidGain);
    graph.widthMidGain.connect(graph.widthMerge.mid);
    graph.widthSplit.side.connect(graph.widthSideGain);
    graph.widthSideGain.connect(graph.widthMerge.side);
    return graph.widthMerge;
  }

  function createToneEffectGraph(effectState, options) {
    const Tone = getTone();
    const state = effectState || {};
    const graph = { advancedFilters: [] };
    graph.input = new Tone.Gain(1);
    graph.bypassInput = new Tone.Gain(1);

    graph.bass = new Tone.Filter({ type: 'lowshelf', frequency: 200, gain: clamp(state.bass, -18, 24) });
    graph.mid = new Tone.Filter({ type: 'peaking', frequency: 1000, Q: 0.8, gain: clamp(state.mid, -18, 18) });
    graph.treble = new Tone.Filter({ type: 'highshelf', frequency: 3500, gain: clamp(state.treble, -18, 18) });
    graph.input.chain(graph.bass, graph.mid, graph.treble);
    let previous = graph.treble;

    (Array.isArray(state.advancedEq) ? state.advancedEq : []).forEach((band) => {
      if (!band || !band.enabled) return;
      const type = mapFilterType(band.type);
      const filter = new Tone.Filter({
        type,
        frequency: clamp(band.frequency, 20, 20000),
        Q: clamp(band.q, 0.1, 18),
        gain: type === 'peaking' || type === 'lowshelf' || type === 'highshelf' ? clamp(band.gain, -18, 18) : 0,
        rolloff: -24,
      });
      filter.editorBandId = band.id;
      previous.connect(filter);
      previous = filter;
      graph.advancedFilters.push(filter);
    });

    graph.highPass = new Tone.Filter({
      type: 'highpass',
      frequency: state.highPassEnabled ? clamp(state.highPassFrequency, 20, 4000) : 20,
      rolloff: state.highPassEnabled ? -24 : -12,
    });
    graph.lowPass = new Tone.Filter({
      type: 'lowpass',
      frequency: state.lowPassEnabled ? clamp(state.lowPassFrequency, 1000, 20000) : 20000,
      rolloff: state.lowPassEnabled ? -24 : -12,
    });
    previous.chain(graph.highPass, graph.lowPass);
    previous = graph.lowPass;

    const vocalAmount = clamp(state.vocalBoost, 0, 100) / 100;
    graph.vocalLow = new Tone.Filter({ type: 'lowshelf', frequency: 160, gain: -2.5 * vocalAmount });
    graph.vocalPresence = new Tone.Filter({ type: 'peaking', frequency: 3200, Q: 0.85, gain: 5 * vocalAmount });
    graph.vocalCompressor = new Tone.Compressor({
      threshold: vocalAmount > 0 ? -18 - 8 * vocalAmount : 0,
      ratio: vocalAmount > 0 ? 1 + 2 * vocalAmount : 1,
      knee: 8,
      attack: 0.012,
      release: 0.16,
    });
    previous.chain(graph.vocalLow, graph.vocalPresence, graph.vocalCompressor);
    previous = graph.vocalCompressor;

    previous = connectWidthGraph(Tone, previous, graph, state.stereoWidth == null ? 100 : state.stereoWidth);

    graph.pan = new Tone.Panner(clamp(state.pan, -100, 100) / 100);
    previous.connect(graph.pan);
    previous = graph.pan;
    if (state.eightD) {
      graph.pan.pan.value = 0;
      graph.panLfo = new Tone.LFO({
        frequency: clamp(state.eightDSpeed, 0.5, 5) / (Math.PI * 2),
        min: -1,
        max: 1,
      });
      graph.panLfo.connect(graph.pan.pan);
      graph.panLfo.start(0);
    }

    graph.distortion = new Tone.Distortion({
      distortion: clamp(state.distortionDrive, 0, 100) / 100,
      oversample: '2x',
      wet: clamp(state.distortionMix, 0, 100) / 100,
    });
    previous.connect(graph.distortion);
    previous = graph.distortion;

    const echoAmount = clamp(state.echo, 0, 100) / 100;
    graph.delay = new Tone.FeedbackDelay({
      delayTime: 0.3,
      feedback: Math.min(0.55, echoAmount * 0.5),
      wet: echoAmount,
    });
    previous.connect(graph.delay);
    previous = graph.delay;

    const reverbAmount = clamp(state.reverb, 0, 100) / 100;
    graph.reverbDry = new Tone.Gain(Math.cos(reverbAmount * Math.PI / 2));
    graph.reverbConvolver = new Tone.Convolver({
      url: createImpulseBuffer(Tone, 2, reverbAmount),
      normalize: true,
    });
    graph.reverbWet = new Tone.Gain(Math.sin(reverbAmount * Math.PI / 2) * 0.72);
    graph.reverbSum = new Tone.Gain(1);
    previous.connect(graph.reverbDry);
    graph.reverbDry.connect(graph.reverbSum);
    previous.connect(graph.reverbConvolver);
    graph.reverbConvolver.connect(graph.reverbWet);
    graph.reverbWet.connect(graph.reverbSum);
    previous = graph.reverbSum;

    graph.processingGain = new Tone.Gain(dbToGain(clamp(state.gainDb, -12, 12)));
    graph.compressor = new Tone.Compressor({
      threshold: state.compressorEnabled ? clamp(state.compressorThreshold, -48, -3) : 0,
      ratio: state.compressorEnabled ? clamp(state.compressorRatio, 1, 20) : 1,
      knee: 8,
      attack: 0.01,
      release: 0.18,
    });
    previous.chain(graph.processingGain, graph.compressor);

    graph.limiterDry = new Tone.Gain(state.limiterEnabled ? 0 : 1);
    graph.limiter = new Tone.Limiter(clamp(state.limiterThreshold, -12, -0.1));
    graph.limiterWet = new Tone.Gain(state.limiterEnabled ? 1 : 0);
    graph.output = new Tone.Gain(1);
    graph.compressor.connect(graph.limiterDry);
    graph.limiterDry.connect(graph.output);
    graph.compressor.connect(graph.limiter);
    graph.limiter.connect(graph.limiterWet);
    graph.limiterWet.connect(graph.output);
    graph.bypassInput.connect(graph.output);

    if (options && options.toDestination) graph.output.toDestination();
    return graph;
  }

  function disposeToneGraph(graph) {
    if (!graph) return;
    DISPOSABLE_KEYS.forEach((key) => {
      const value = graph[key];
      if (Array.isArray(value)) {
        value.forEach((node) => { try { node.dispose(); } catch (error) {} });
      } else if (value && typeof value.dispose === 'function') {
        try { value.dispose(); } catch (error) {}
      }
    });
  }

  function updateGraphValues(graph, state) {
    if (!graph) return;
    graph.bass.gain.value = clamp(state.bass, -18, 24);
    graph.mid.gain.value = clamp(state.mid, -18, 18);
    graph.treble.gain.value = clamp(state.treble, -18, 18);
    graph.advancedFilters.forEach((filter) => {
      const band = (state.advancedEq || []).find((item) => item.id === filter.editorBandId);
      if (!band) return;
      filter.frequency.value = clamp(band.frequency, 20, 20000);
      filter.Q.value = clamp(band.q, 0.1, 18);
      if ('gain' in filter) filter.gain.value = clamp(band.gain, -18, 18);
    });
    graph.highPass.frequency.value = state.highPassEnabled ? clamp(state.highPassFrequency, 20, 4000) : 20;
    graph.lowPass.frequency.value = state.lowPassEnabled ? clamp(state.lowPassFrequency, 1000, 20000) : 20000;
    const vocal = clamp(state.vocalBoost, 0, 100) / 100;
    graph.vocalLow.gain.value = -2.5 * vocal;
    graph.vocalPresence.gain.value = 5 * vocal;
    graph.vocalCompressor.threshold.value = vocal > 0 ? -18 - 8 * vocal : 0;
    graph.vocalCompressor.ratio.value = vocal > 0 ? 1 + 2 * vocal : 1;
    graph.widthSideGain.gain.value = clamp(state.stereoWidth, 0, 200) / 100;
    if (!state.eightD) graph.pan.pan.value = clamp(state.pan, -100, 100) / 100;
    graph.distortion.distortion = clamp(state.distortionDrive, 0, 100) / 100;
    graph.distortion.wet.value = clamp(state.distortionMix, 0, 100) / 100;
    const echo = clamp(state.echo, 0, 100) / 100;
    graph.delay.wet.value = echo;
    graph.delay.feedback.value = Math.min(0.55, echo * 0.5);
    const reverb = clamp(state.reverb, 0, 100) / 100;
    graph.reverbDry.gain.value = Math.cos(reverb * Math.PI / 2);
    graph.reverbWet.gain.value = Math.sin(reverb * Math.PI / 2) * 0.72;
    graph.processingGain.gain.value = dbToGain(clamp(state.gainDb, -12, 12));
    graph.compressor.threshold.value = state.compressorEnabled ? clamp(state.compressorThreshold, -48, -3) : 0;
    graph.compressor.ratio.value = state.compressorEnabled ? clamp(state.compressorRatio, 1, 20) : 1;
    graph.limiter.threshold.value = clamp(state.limiterThreshold, -12, -0.1);
    graph.limiterDry.gain.value = state.limiterEnabled ? 0 : 1;
    graph.limiterWet.gain.value = state.limiterEnabled ? 1 : 0;
  }

  class AudioEngine {
    constructor(options) {
      this.options = options || {};
      this.originalBuffer = null;
      this.workingBuffer = null;
      this.effectState = null;
      this.compareMode = 'modified';
      this.graph = null;
      this.source = null;
      this.sourceKind = '';
      this.playRequestId = 0;
      this.analyser = null;
      this.monitorGain = null;
      this.meterTimer = null;
      this.iosAudio = null;
      this.iosAudioUrl = '';
      this.lastPrimeAt = 0;
      this.playing = false;
      this.startedAt = 0;
      this.startedOffset = 0;
      this.speedAtStart = 1;
    }

    get context() {
      const Tone = getTone();
      let context = Tone.getContext();
      if (context.rawContext.state === 'closed') {
        const AudioContextClass = root.AudioContext || root.webkitAudioContext;
        if (!AudioContextClass) throw new Error('This browser does not support Web Audio.');
        this.disposeGraph();
        let rawContext;
        try {
          rawContext = new AudioContextClass({ latencyHint: 'interactive' });
        } catch (error) {
          rawContext = new AudioContextClass();
        }
        Tone.setContext(rawContext);
        context = Tone.getContext();
      }
      return context;
    }

    primeFromGesture() {
      const now = Date.now();
      if (now - this.lastPrimeAt < 100) return;
      this.lastPrimeAt = now;
      if (isIOSDevice()) {
        if (!this.iosAudio) {
          this.iosAudioUrl = createSilentWavUrl();
          this.iosAudio = new Audio();
          this.iosAudio.preload = 'auto';
          this.iosAudio.setAttribute('playsinline', '');
          this.iosAudio.src = this.iosAudioUrl;
        }
        try {
          this.iosAudio.currentTime = 0;
          const promise = this.iosAudio.play();
          if (promise) promise.catch(() => {});
        } catch (error) {}
      }
      try {
        const rawContext = this.context.rawContext;
        const resume = rawContext.resume();
        if (resume) resume.catch(() => {});
        const source = rawContext.createBufferSource();
        source.buffer = rawContext.createBuffer(1, 1, rawContext.sampleRate);
        source.connect(rawContext.destination);
        source.onended = () => { try { source.disconnect(); } catch (error) {} };
        source.start();
      } catch (error) {}
    }

    async ensureRunning() {
      const Tone = getTone();
      const rawContext = this.context.rawContext;
      const attempts = [];
      try { attempts.push(Promise.resolve(Tone.start())); } catch (error) {}
      try { attempts.push(Promise.resolve(rawContext.resume())); } catch (error) {}
      await Promise.race([
        Promise.all(attempts.map((attempt) => attempt.catch(() => undefined))),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Audio startup timed out. Tap Play again.')), 5000)),
      ]);
      if (rawContext.state !== 'running') {
        throw new Error('Audio output is blocked. Tap Play again and check Safari sound settings.');
      }
      return rawContext;
    }

    setBuffers(originalBuffer, workingBuffer) {
      this.stop();
      this.originalBuffer = originalBuffer;
      this.workingBuffer = workingBuffer;
      this.disposeSource();
    }

    setWorkingBuffer(buffer) {
      this.stop();
      this.workingBuffer = buffer;
      this.disposeSource();
    }

    setEffectState(state) {
      this.effectState = state;
      updateGraphValues(this.graph, state);
      if (this.sourceKind === 'grain' && this.source) {
        const granular = granularPlaybackOptions(state);
        this.source.playbackRate = granular.playbackRate;
        this.source.detune = granular.detune;
        this.source.grainSize = granular.grainSize;
        this.source.overlap = granular.overlap;
      }
      if (this.monitorGain) this.monitorGain.gain.value = clamp(state.volume, 0, 150) / 100;
    }

    updateTransportEffectState(state) {
      const requiresRestart = transportNeedsRestart(this.sourceKind, this.playing, state, this.compareMode);
      this.setEffectState(state);
      return requiresRestart;
    }

    setCompareMode(mode) {
      this.compareMode = mode === 'original' ? 'original' : 'modified';
    }

    sourceBuffer() {
      return this.compareMode === 'original' ? this.originalBuffer : this.workingBuffer;
    }

    sourceSpeed() {
      return this.compareMode === 'original' ? 1 : clamp(this.effectState && this.effectState.speed, 0.25, 2);
    }

    currentOffset() {
      if (!this.playing) return this.startedOffset;
      const Tone = getTone();
      const elapsed = Math.max(0, Tone.now() - this.startedAt) * this.speedAtStart;
      const buffer = this.sourceBuffer();
      return Math.min(this.startedOffset + elapsed, buffer ? buffer.duration : 0);
    }

    async ensureGraph() {
      if (this.graph) return;
      const rawContext = this.context.rawContext;
      this.graph = createToneEffectGraph(this.effectState || {}, { toDestination: false });
      this.analyser = rawContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.75;
      this.monitorGain = rawContext.createGain();
      this.monitorGain.gain.value = clamp(this.effectState && this.effectState.volume, 0, 150) / 100;
      this.graph.output.connect(this.analyser);
      this.analyser.connect(this.monitorGain);
      this.monitorGain.connect(rawContext.destination);
    }

    async rebuildGraph() {
      const wasPlaying = this.playing;
      const offset = this.currentOffset();
      this.stop(false);
      this.disposeGraph();
      await this.ensureGraph();
      if (wasPlaying) await this.play(offset);
    }

    sourceNeedsGranular() {
      return granularRequired(this.effectState, this.compareMode);
    }

    createSource() {
      const Tone = getTone();
      const buffer = this.sourceBuffer();
      if (!buffer) throw new Error('Load an audio file first.');
      this.disposeSource();
      if (this.sourceNeedsGranular()) {
        const granular = granularPlaybackOptions(this.effectState);
        this.source = new Tone.GrainPlayer({
          url: buffer,
          ...granular,
        });
        this.sourceKind = 'grain';
      } else {
        this.source = new Tone.Player(buffer);
        this.sourceKind = 'dry';
      }
      this.source.connect(this.compareMode === 'original' ? this.graph.bypassInput : this.graph.input);
    }

    async play(offset) {
      const requestId = ++this.playRequestId;
      await this.ensureRunning();
      if (requestId !== this.playRequestId) return false;
      await this.ensureGraph();
      if (requestId !== this.playRequestId) return false;
      const buffer = this.sourceBuffer();
      if (!buffer) throw new Error('Load an audio file first.');
      const maxOffset = Math.max(0, buffer.duration - 1 / buffer.sampleRate);
      const safeOffset = clamp(offset, 0, maxOffset);
      this.createSource();
      const Tone = getTone();
      this.startedAt = Tone.now() + 0.01;
      this.startedOffset = safeOffset;
      this.speedAtStart = this.sourceSpeed();
      this.source.start(this.startedAt, safeOffset);
      this.playing = true;
      this.startMeter();
      return true;
    }

    pause() {
      if (!this.playing) return this.startedOffset;
      const offset = this.currentOffset();
      this.stop(false);
      this.startedOffset = offset;
      return offset;
    }

    stop(resetOffset) {
      this.playRequestId += 1;
      if (this.source) {
        try { this.source.stop(); } catch (error) {}
      }
      this.playing = false;
      this.disposeSource();
      this.stopMeter();
      if (resetOffset !== false) this.startedOffset = 0;
      return this.startedOffset;
    }

    disposeSource() {
      if (!this.source) return;
      try { this.source.disconnect(); } catch (error) {}
      try { this.source.dispose(); } catch (error) {}
      this.source = null;
      this.sourceKind = '';
    }

    startMeter() {
      this.stopMeter();
      if (!this.analyser || typeof this.options.onMeter !== 'function') return;
      const data = new Float32Array(this.analyser.fftSize);
      this.meterTimer = setInterval(() => {
        if (!this.analyser) return;
        this.analyser.getFloatTimeDomainData(data);
        let peak = 0;
        let sum = 0;
        for (let index = 0; index < data.length; index++) {
          const absolute = Math.abs(data[index]);
          peak = Math.max(peak, absolute);
          sum += data[index] * data[index];
        }
        const rms = Math.sqrt(sum / data.length);
        this.options.onMeter({
          peak,
          rms,
          peakDb: 20 * Math.log10(Math.max(peak, 1e-8)),
          rmsDb: 20 * Math.log10(Math.max(rms, 1e-8)),
          clipping: peak >= 0.999,
        });
      }, 80);
    }

    stopMeter() {
      if (this.meterTimer) clearInterval(this.meterTimer);
      this.meterTimer = null;
    }

    disposeGraph() {
      this.stop(false);
      if (this.graph) disposeToneGraph(this.graph);
      this.graph = null;
      try { if (this.analyser) this.analyser.disconnect(); } catch (error) {}
      try { if (this.monitorGain) this.monitorGain.disconnect(); } catch (error) {}
      this.analyser = null;
      this.monitorGain = null;
    }

    dispose() {
      this.disposeGraph();
      if (this.iosAudioUrl) URL.revokeObjectURL(this.iosAudioUrl);
      this.iosAudio = null;
      this.iosAudioUrl = '';
    }
  }

  return {
    AudioEngine,
    createToneEffectGraph,
    disposeToneGraph,
    granularPlaybackOptions,
    granularRequired,
    transportNeedsRestart,
    isIOSDevice,
    mapFilterType,
    updateGraphValues,
  };
});
