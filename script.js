'use strict';

(function () {
  const Core = window.AudioEditorCore;
  const EngineApi = window.AudioEditorEngine;
  const ExportApi = window.AudioEditorExport;
  if (!Core || !EngineApi || !ExportApi) {
    document.addEventListener('DOMContentLoaded', () => {
      const message = document.getElementById('appMessage');
      if (message) { message.hidden = false; message.textContent = 'Required audio components could not be loaded. Reload the page.'; }
    });
    return;
  }

  const $ = (id) => document.getElementById(id);
  const PRESET_STORAGE_KEY = 'audio-editor-presets-v1';
  const UI_MODE_STORAGE_KEY = 'audio-editor-ui-mode-v1';
  const SUPPORTED_EXTENSION = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
  const DEFAULT_ADVANCED_EQ = [
    { id: 'eq-1', enabled: false, type: 'lowshelf', frequency: 100, gain: 0, q: 0.7 },
    { id: 'eq-2', enabled: false, type: 'bell', frequency: 250, gain: 0, q: 1 },
    { id: 'eq-3', enabled: false, type: 'bell', frequency: 1000, gain: 0, q: 1 },
    { id: 'eq-4', enabled: false, type: 'bell', frequency: 4000, gain: 0, q: 1 },
    { id: 'eq-5', enabled: false, type: 'highshelf', frequency: 12000, gain: 0, q: 0.7 },
  ];

  function defaultEffects() {
    return {
      speed: 1, pitch: 0, fineTune: 0, volume: 100, gainDb: 0,
      bass: 0, mid: 0, treble: 0, reverb: 0, echo: 0, pan: 0,
      eightD: false, eightDSpeed: 2, advancedEq: JSON.parse(JSON.stringify(DEFAULT_ADVANCED_EQ)),
      vocalBoost: 0, stereoWidth: 100, distortionDrive: 0, distortionMix: 0,
      highPassEnabled: false, highPassFrequency: 80,
      lowPassEnabled: false, lowPassFrequency: 18000,
      compressorEnabled: false, compressorThreshold: -18, compressorRatio: 3,
      limiterEnabled: true, limiterThreshold: -1,
    };
  }

  function presetEq(overrides) {
    return DEFAULT_ADVANCED_EQ.map((band, index) => Object.assign({}, band, overrides[index] || {}));
  }

  function factoryPreset(meta, effects) {
    return Object.assign(defaultEffects(), meta, effects || {});
  }

  const FACTORY_PRESETS = {
    normal: factoryPreset({ label: 'Normal', category: 'essential', icon: 'circle-dot', description: 'Clean reference', colors: ['#8b5cf6', '#22d3ee'] }),
    nightcore: factoryPreset({ label: 'Nightcore', category: 'extreme', icon: 'zap', description: 'Fast, bright and controlled', colors: ['#ff56c7', '#22d3ee'] }, { speed: 1.3, pitch: 3, fineTune: 12, gainDb: -4, bass: 1, mid: -1, treble: 5, reverb: 8, stereoWidth: 118, compressorEnabled: true, compressorThreshold: -16, compressorRatio: 2.5, advancedEq: presetEq([{ enabled: true, gain: -1.5 }, {}, {}, { enabled: true, gain: 2.5 }, { enabled: true, gain: 2 }]) }),
    deepbass: factoryPreset({ label: 'Deep Bass', category: 'character', icon: 'waves', description: 'Tight sub and solid punch', colors: ['#7c3aed', '#f43f5e'] }, { speed: 0.9, pitch: -3, gainDb: -7, bass: 12, mid: -2, treble: -3, reverb: 9, echo: 4, compressorEnabled: true, compressorThreshold: -18, compressorRatio: 3.5, advancedEq: presetEq([{ enabled: true, frequency: 85, gain: 5 }, { enabled: true, frequency: 240, gain: -2 }, {}, {}, { enabled: true, gain: -1.5 }]) }),
    '8daudio': factoryPreset({ label: '8D Orbit', category: 'space', icon: 'orbit', description: 'Wide moving panorama', colors: ['#06b6d4', '#8b5cf6'] }, { gainDb: -4, bass: 2, treble: 2, reverb: 24, echo: 14, eightD: true, eightDSpeed: 2.4, stereoWidth: 155, highPassEnabled: true, highPassFrequency: 40, advancedEq: presetEq([{ enabled: true, gain: -1 }, {}, {}, { enabled: true, gain: 1.5 }, {}]) }),
    concert: factoryPreset({ label: 'Concert Hall', category: 'space', icon: 'music', description: 'Natural hall with presence', colors: ['#f59e0b', '#ec4899'] }, { gainDb: -6, bass: 4, mid: 1, treble: 3, reverb: 58, echo: 16, stereoWidth: 160, compressorEnabled: true, compressorThreshold: -18, compressorRatio: 2, advancedEq: presetEq([{ enabled: true, gain: 2 }, {}, { enabled: true, gain: -1 }, { enabled: true, gain: 2 }, {}]) }),
    slowcore: factoryPreset({ label: 'Slowcore', category: 'character', icon: 'cloud-rain', description: 'Smooth, dark and spacious', colors: ['#6366f1', '#94a3b8'] }, { speed: 0.76, gainDb: -5, bass: 4, mid: -1.5, treble: -2, reverb: 54, echo: 0, stereoWidth: 132, lowPassEnabled: true, lowPassFrequency: 15200, compressorEnabled: true, compressorThreshold: -20, compressorRatio: 2.3 }),
    lofi: factoryPreset({ label: 'Lo-Fi', category: 'character', icon: 'coffee', description: 'Warm tape and soft highs', colors: ['#f59e0b', '#84cc16'] }, { speed: 0.92, pitch: -1, fineTune: -14, gainDb: -4, bass: 5, mid: -2, treble: -5, pan: -5, reverb: 22, echo: 7, stereoWidth: 88, distortionDrive: 14, distortionMix: 16, highPassEnabled: true, highPassFrequency: 55, lowPassEnabled: true, lowPassFrequency: 11500, compressorEnabled: true, compressorThreshold: -22, compressorRatio: 2.2, advancedEq: presetEq([{ enabled: true, gain: 2 }, { enabled: true, gain: -1.5 }, {}, {}, { enabled: true, gain: -3 }]) }),
    vaporwave: factoryPreset({ label: 'Vaporwave', category: 'character', icon: 'sunset', description: 'Wide retro dream drift', colors: ['#ff56c7', '#22d3ee'] }, { speed: 0.8, pitch: -4, fineTune: -18, gainDb: -5, bass: 4, mid: -1, pan: 10, reverb: 48, echo: 18, stereoWidth: 155, lowPassEnabled: true, lowPassFrequency: 15500, compressorEnabled: true, compressorThreshold: -18, compressorRatio: 2.2, advancedEq: presetEq([{ enabled: true, gain: 2 }, {}, { enabled: true, gain: -1 }, {}, { enabled: true, gain: 1.5 }]) }),
    phonecall: factoryPreset({ label: 'Phone Call', category: 'essential', icon: 'radio', description: 'Focused narrow-band voice', colors: ['#10b981', '#facc15'] }, { pitch: 1.5, gainDb: -3, mid: 4, treble: 3, vocalBoost: 34, stereoWidth: 35, distortionDrive: 8, distortionMix: 8, highPassEnabled: true, highPassFrequency: 320, lowPassEnabled: true, lowPassFrequency: 3900, compressorEnabled: true, compressorThreshold: -24, compressorRatio: 4, advancedEq: presetEq([{}, { enabled: true, frequency: 650, gain: 2 }, { enabled: true, frequency: 1400, gain: 3 }, { enabled: true, frequency: 2800, gain: 2 }, {}]) }),
    underwater: factoryPreset({ label: 'Underwater', category: 'space', icon: 'droplets', description: 'Submerged low-pass haze', colors: ['#0284c7', '#22d3ee'] }, { speed: 0.85, pitch: -5, gainDb: -8, bass: 8, mid: -4, treble: -8, pan: -6, reverb: 72, echo: 24, stereoWidth: 132, lowPassEnabled: true, lowPassFrequency: 2600, compressorEnabled: true, compressorThreshold: -20, compressorRatio: 3, advancedEq: presetEq([{ enabled: true, gain: 4 }, { enabled: true, gain: -2 }, {}, {}, { enabled: true, gain: -6 }]) }),
    hyperpop: factoryPreset({ label: 'Hyperpop', category: 'extreme', icon: 'sparkles', description: 'Polished, loud and electric', colors: ['#f43f5e', '#a855f7'] }, { speed: 1.15, pitch: 4, fineTune: 16, gainDb: -7, bass: 3, mid: 2, treble: 7, reverb: 14, stereoWidth: 132, distortionDrive: 13, distortionMix: 11, compressorEnabled: true, compressorThreshold: -18, compressorRatio: 5, advancedEq: presetEq([{ enabled: true, gain: 1.5 }, {}, { enabled: true, gain: 1 }, { enabled: true, gain: 3 }, { enabled: true, gain: 2.5 }]) }),
    cinematic: factoryPreset({ label: 'Cinematic', category: 'space', icon: 'clapperboard', description: 'Large dramatic soundstage', colors: ['#f97316', '#7c3aed'] }, { speed: 0.92, pitch: -2, gainDb: -7, bass: 8, mid: -1, treble: 2, reverb: 54, stereoWidth: 165, compressorEnabled: true, compressorThreshold: -16, compressorRatio: 3, advancedEq: presetEq([{ enabled: true, gain: 3 }, { enabled: true, gain: -1 }, {}, { enabled: true, gain: 2 }, { enabled: true, gain: 1 }]) }),
    dreamscape: factoryPreset({ label: 'Dreamscape', category: 'space', icon: 'moon-star', description: 'Airy, soft and extra wide', colors: ['#818cf8', '#f0abfc'] }, { speed: 0.82, pitch: -3, fineTune: -8, gainDb: -6, bass: 2, treble: 2, pan: 8, reverb: 74, echo: 8, stereoWidth: 178, highPassEnabled: true, highPassFrequency: 45, advancedEq: presetEq([{ enabled: true, gain: -1 }, {}, { enabled: true, gain: -1 }, { enabled: true, gain: 2 }, { enabled: true, gain: 2.5 }]) }),
    cathedral: factoryPreset({ label: 'Cathedral', category: 'space', icon: 'landmark', description: 'Huge clean sacred space', colors: ['#fbbf24', '#a78bfa'] }, { gainDb: -8, bass: 1, mid: 1, treble: 4, reverb: 90, stereoWidth: 175, highPassEnabled: true, highPassFrequency: 65, compressorEnabled: true, compressorThreshold: -17, compressorRatio: 2, advancedEq: presetEq([{ enabled: true, gain: -1 }, {}, { enabled: true, gain: 1 }, { enabled: true, gain: 2 }, { enabled: true, gain: 2 }]) }),
    subterranean: factoryPreset({ label: 'Subterranean', category: 'extreme', icon: 'chevrons-down', description: 'Controlled seismic low end', colors: ['#ef4444', '#581c87'] }, { speed: 0.68, pitch: -7, gainDb: -10, bass: 14, mid: -5, treble: -9, reverb: 16, stereoWidth: 112, distortionDrive: 18, distortionMix: 14, lowPassEnabled: true, lowPassFrequency: 10500, compressorEnabled: true, compressorThreshold: -22, compressorRatio: 5, advancedEq: presetEq([{ enabled: true, gain: 6 }, { enabled: true, gain: -3 }, {}, {}, { enabled: true, gain: -4 }]) }),
    crystal: factoryPreset({ label: 'Crystal', category: 'character', icon: 'gem', description: 'Detailed highs without harshness', colors: ['#67e8f9', '#c4b5fd'] }, { speed: 1.05, pitch: 5, fineTune: 14, gainDb: -6, bass: -2, mid: 1, treble: 8, pan: 5, reverb: 32, stereoWidth: 145, compressorEnabled: true, compressorThreshold: -15, compressorRatio: 2.4, advancedEq: presetEq([{ enabled: true, gain: -2 }, {}, { enabled: true, gain: 1 }, { enabled: true, gain: 3 }, { enabled: true, gain: 3 }]) }),
    alienradio: factoryPreset({ label: 'Alien Radio', category: 'extreme', icon: 'satellite', description: 'Animated sci-fi transmission', colors: ['#84cc16', '#22d3ee'] }, { speed: 1.1, pitch: 7, fineTune: 36, gainDb: -8, mid: 3, treble: 6, pan: -16, reverb: 14, eightD: true, eightDSpeed: 3.6, stereoWidth: 158, distortionDrive: 28, distortionMix: 23, highPassEnabled: true, highPassFrequency: 220, lowPassEnabled: true, lowPassFrequency: 7400, compressorEnabled: true, compressorThreshold: -20, compressorRatio: 4 }),
    tapewarmth: factoryPreset({ label: 'Tape Warmth', category: 'character', icon: 'cassette-tape', description: 'Rounded analog saturation', colors: ['#fb923c', '#eab308'] }, { speed: 0.96, pitch: -0.5, fineTune: -8, gainDb: -3, bass: 4, mid: 1, treble: -3, pan: -3, reverb: 10, stereoWidth: 92, distortionDrive: 17, distortionMix: 19, lowPassEnabled: true, lowPassFrequency: 14500, compressorEnabled: true, compressorThreshold: -20, compressorRatio: 2.4, advancedEq: presetEq([{ enabled: true, gain: 2 }, { enabled: true, gain: 1 }, {}, {}, { enabled: true, gain: -2 }]) }),
    slowedreverb: factoryPreset({ label: 'Slowed + Reverb', category: 'slowed', icon: 'cloud-moon', description: 'Natural slow spacious mix', colors: ['#8b5cf6', '#38bdf8'] }, { speed: 0.86, gainDb: -4, bass: 1.5, mid: -0.5, treble: 0.5, reverb: 43, echo: 0, stereoWidth: 134, compressorEnabled: true, compressorThreshold: -18, compressorRatio: 2.1, advancedEq: presetEq([{ enabled: true, gain: 1 }, {}, { enabled: true, gain: -0.5 }, {}, { enabled: true, gain: 0.5 }]) }),
    softslowed: factoryPreset({ label: 'Soft Slowed', category: 'slowed', icon: 'feather', description: 'Clean gentle slow ambience', colors: ['#a78bfa', '#67e8f9'] }, { speed: 0.93, gainDb: -3, bass: 0.5, treble: 0.5, reverb: 24, echo: 0, stereoWidth: 120, highPassEnabled: true, highPassFrequency: 32, advancedEq: presetEq([{}, {}, {}, { enabled: true, gain: 1 }, { enabled: true, gain: 0.5 }]) }),
    deepslowed: factoryPreset({ label: 'Deep Slowed', category: 'slowed', icon: 'moon', description: 'Smooth deep cinematic weight', colors: ['#6366f1', '#0ea5e9'] }, { speed: 0.78, gainDb: -6, bass: 4, mid: -1.5, treble: -1.5, reverb: 55, echo: 0, stereoWidth: 144, lowPassEnabled: true, lowPassFrequency: 15800, compressorEnabled: true, compressorThreshold: -20, compressorRatio: 2.7, advancedEq: presetEq([{ enabled: true, gain: 2.5 }, { enabled: true, gain: -1 }, {}, {}, { enabled: true, gain: -0.5 }]) }),
    ultraslowed: factoryPreset({ label: 'Ultra Slowed', category: 'slowed', icon: 'cloud-fog', description: 'Deep enveloping slow motion', colors: ['#4f46e5', '#7dd3fc'] }, { speed: 0.7, gainDb: -8, bass: 5, mid: -2, treble: -2, reverb: 68, echo: 0, stereoWidth: 156, lowPassEnabled: true, lowPassFrequency: 13500, compressorEnabled: true, compressorThreshold: -22, compressorRatio: 3.2, advancedEq: presetEq([{ enabled: true, gain: 2.5 }, { enabled: true, gain: -1.5 }, {}, {}, { enabled: true, gain: -1.5 }]) }),
    vocalboost: factoryPreset({ label: 'Vocal Boost', category: 'voice', icon: 'mic-2', description: 'Present vocals with clean dynamics', colors: ['#ec4899', '#22d3ee'] }, { gainDb: -3, bass: -2, mid: 2, treble: 2, vocalBoost: 72, stereoWidth: 105, highPassEnabled: true, highPassFrequency: 75, compressorEnabled: true, compressorThreshold: -20, compressorRatio: 2.8, advancedEq: presetEq([{ enabled: true, gain: -2 }, { enabled: true, gain: -1 }, { enabled: true, frequency: 1600, gain: 2 }, { enabled: true, frequency: 4200, gain: 3 }, {}]) }),
    podcast: factoryPreset({ label: 'Podcast', category: 'voice', icon: 'podcast', description: 'Clear consistent spoken voice', colors: ['#14b8a6', '#8b5cf6'] }, { gainDb: -2, bass: -3, mid: 2, treble: 1, vocalBoost: 60, stereoWidth: 90, highPassEnabled: true, highPassFrequency: 75, lowPassEnabled: true, lowPassFrequency: 16500, compressorEnabled: true, compressorThreshold: -23, compressorRatio: 3.8, advancedEq: presetEq([{ enabled: true, gain: -2 }, { enabled: true, frequency: 280, gain: -2 }, { enabled: true, frequency: 1500, gain: 2 }, { enabled: true, frequency: 3800, gain: 2 }, {}]) }),
  };

  const state = {
    originalData: null, workingData: null, originalBuffer: null, workingBuffer: null,
    clipboard: null, selection: null, playhead: 0, zoom: 1, compareMode: 'modified',
    effects: defaultEffects(), history: new Core.AudioHistory({ maxEntries: 12, maxBytes: 256 * 1024 * 1024 }),
    file: null, activePreset: 'normal', userPresets: [], lastEffectKeys: [], draggingSelection: false,
    pointerStartX: 0, pointerStartTime: 0, animationFrame: 0, transportRestartTimer: 0,
    lastSection: 'basic', loading: false, exporting: false, editorMode: 'studio',
  };

  let engine;
  let canvas;
  let canvasContext;
  let waveformBaseCanvas;
  let waveformCacheKey = '';

  function normalizeEffects(input) {
    const defaults = defaultEffects();
    const source = input && typeof input === 'object' ? input : {};
    Object.keys(defaults).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) defaults[key] = JSON.parse(JSON.stringify(source[key]));
    });
    return defaults;
  }

  function formatTime(seconds, precise) {
    const value = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(value / 60);
    const wholeSeconds = Math.floor(value % 60);
    if (!precise) return `${minutes}:${String(wholeSeconds).padStart(2, '0')}`;
    const milliseconds = Math.floor((value % 1) * 1000);
    return `${minutes}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  }

  function showMessage(text, type, timeout) {
    const element = $('appMessage');
    if (!element) return;
    element.hidden = !text;
    element.textContent = text || '';
    element.dataset.type = type || 'info';
    clearTimeout(showMessage.timer);
    if (text && timeout !== 0) showMessage.timer = setTimeout(() => { element.hidden = true; }, timeout || 5000);
  }

  function setProcessing(active, text, percent) {
    state.loading = active && !state.exporting;
    const overlay = $('processingOverlay');
    overlay.hidden = !active;
    $('processingText').textContent = text || 'Processing audio...';
    $('processingProgress').value = Number.isFinite(percent) ? percent : 0;
    document.body.classList.toggle('is-processing', active);
    document.body.setAttribute('aria-busy', String(Boolean(active)));
  }

  function nativeToData(buffer) {
    return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, index) => new Float32Array(buffer.getChannelData(index))) };
  }

  function nativeBufferPeak(buffer) {
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index++) peak = Math.max(peak, Math.abs(data[index]));
    }
    return peak;
  }

  function dataToNative(data) {
    Core.assertBufferData(data);
    const context = engine.context.rawContext;
    const buffer = context.createBuffer(data.channels.length, data.channels[0].length, data.sampleRate);
    data.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
    return buffer;
  }

  function currentDuration() { return state.workingData ? Core.bufferDuration(state.workingData) : 0; }
  function isBusy() { return state.loading || state.exporting; }
  function showBusyMessage() {
    showMessage(state.exporting ? 'Wait for the export to finish.' : 'Wait for the current operation to finish.', 'error', 2500);
  }
  function playbackDuration() {
    return state.compareMode === 'original' && state.originalBuffer ? state.originalBuffer.duration : currentDuration();
  }

  function currentSnapshot(label) {
    return { buffer: state.workingData, selection: state.selection, playhead: state.playhead, label: label || '' };
  }

  function restoreSnapshot(snapshot) {
    if (!snapshot) return;
    engine.stop();
    state.workingData = Core.cloneBufferData(snapshot.buffer);
    state.workingBuffer = dataToNative(state.workingData);
    state.selection = Core.normalizeSelection(snapshot.selection, currentDuration());
    state.playhead = Core.clamp(snapshot.playhead, 0, currentDuration());
    engine.setWorkingBuffer(state.workingBuffer);
    updateAfterBufferChange();
  }

  function setWorkingData(data, selection, playhead) {
    Core.assertBufferData(data);
    engine.stop();
    state.workingData = data;
    state.workingBuffer = dataToNative(data);
    state.selection = Core.normalizeSelection(selection, Core.bufferDuration(data));
    state.playhead = Core.clamp(playhead, 0, Core.bufferDuration(data));
    engine.setWorkingBuffer(state.workingBuffer);
    updateAfterBufferChange();
  }

  function performEdit(label, operation, allowWhileProcessing) {
    if (isBusy() && !allowWhileProcessing) return showBusyMessage();
    if (!state.workingData) return showMessage('Load an audio file first.', 'error');
    try {
      const previous = currentSnapshot(label);
      const result = operation();
      if (!result || !result.buffer) throw new Error('The edit did not produce audio.');
      state.history.push(previous);
      setWorkingData(result.buffer, result.selection, result.playhead);
      updateHistoryButtons();
      showMessage(`${label} applied.`, 'success', 2500);
    } catch (error) {
      showMessage(error.message || `Could not apply ${label}.`, 'error');
    }
  }

  async function performHeavyEdit(label, operation) {
    if (isBusy()) return showBusyMessage();
    setProcessing(true, `${label}...`, 25);
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try { performEdit(label, operation, true); } finally { setProcessing(false); }
  }

  function updateHistoryButtons() {
    $('undoBtn').disabled = !state.history.canUndo;
    $('redoBtn').disabled = !state.history.canRedo;
  }

  function updateAfterBufferChange() {
    waveformCacheKey = '';
    $('totalTime').textContent = formatTime(playbackDuration());
    $('fileDuration').textContent = formatTime(currentDuration());
    updateProgress(state.playhead);
    updateSelectionUI();
    resizeWaveform();
    scheduleSilenceAnalysis();
  }

  function updateProgress(time) {
    const duration = playbackDuration();
    state.playhead = Core.clamp(time, 0, duration);
    const percent = duration ? state.playhead / duration * 100 : 0;
    $('progressFill').style.width = `${percent}%`;
    $('progressThumb').style.left = `${percent}%`;
    $('currentTime').textContent = formatTime(state.playhead);
    drawWaveform();
  }

  function setPlayIcon(playing) {
    $('playIcon').hidden = playing;
    $('pauseIcon').hidden = !playing;
    $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function playbackLoop() {
    cancelAnimationFrame(state.animationFrame);
    const tick = () => {
      if (!engine.playing) { setPlayIcon(false); return; }
      const offset = engine.currentOffset();
      updateProgress(offset);
      keepPlayheadVisible();
      if (offset >= playbackDuration() - 0.01) {
        engine.stop();
        updateProgress(0);
        setPlayIcon(false);
        return;
      }
      state.animationFrame = requestAnimationFrame(tick);
    };
    state.animationFrame = requestAnimationFrame(tick);
  }

  async function togglePlayback() {
    if (!state.workingBuffer) return showMessage('Load an audio file first.', 'error');
    try {
      if (engine.playing) {
        state.playhead = engine.pause();
        setPlayIcon(false);
        updateProgress(state.playhead);
      } else {
        if (state.playhead >= playbackDuration() - 0.01) state.playhead = 0;
        await engine.play(state.playhead);
        setPlayIcon(true);
        playbackLoop();
      }
    } catch (error) {
      setPlayIcon(false);
      showMessage(error.message || 'Audio playback could not start.', 'error', 0);
    }
  }

  function seekTo(time, resume) {
    const wasPlaying = engine.playing;
    engine.stop(false);
    updateProgress(Core.clamp(time, 0, playbackDuration()));
    engine.startedOffset = state.playhead;
    if (resume || wasPlaying) engine.play(state.playhead).then(() => { setPlayIcon(true); playbackLoop(); }).catch((error) => showMessage(error.message, 'error'));
  }

  function compare(mode) {
    if (!state.workingBuffer) return;
    const wasPlaying = engine.playing;
    const position = wasPlaying ? engine.currentOffset() : state.playhead;
    engine.stop(false);
    state.compareMode = mode === 'original' ? 'original' : 'modified';
    engine.setCompareMode(state.compareMode);
    $('compareOriginalBtn').classList.toggle('active', state.compareMode === 'original');
    $('compareModifiedBtn').classList.toggle('active', state.compareMode === 'modified');
    $('compareOriginalBtn').setAttribute('aria-pressed', String(state.compareMode === 'original'));
    $('compareModifiedBtn').setAttribute('aria-pressed', String(state.compareMode === 'modified'));
    $('totalTime').textContent = formatTime(playbackDuration());
    updateProgress(Math.min(position, playbackDuration()));
    if (wasPlaying) engine.play(state.playhead).then(playbackLoop).catch((error) => showMessage(error.message, 'error'));
  }

  function resizeWaveform() {
    if (!canvas || !state.workingData) return;
    const scroll = $('waveformScroll');
    const logicalWidth = Math.max(scroll.clientWidth || 300, Math.round((scroll.clientWidth || 300) * state.zoom));
    const logicalHeight = Math.max(180, Math.min(260, Math.round(logicalWidth * 0.18)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    $('waveformStage').style.width = `${logicalWidth}px`;
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    canvas.width = Math.round(logicalWidth * dpr);
    canvas.height = Math.round(logicalHeight * dpr);
    canvasContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    waveformCacheKey = '';
    drawWaveform();
  }

  function buildWaveformBase(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    waveformBaseCanvas = document.createElement('canvas');
    waveformBaseCanvas.width = Math.round(width * dpr);
    waveformBaseCanvas.height = Math.round(height * dpr);
    const context = waveformBaseCanvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const channels = state.workingData.channels;
    const samples = channels[0].length;
    const center = height / 2;
    const pixels = Math.max(1, Math.floor(width));
    const step = samples / pixels;
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#8b5cf6'); gradient.addColorStop(.5, '#22d3ee'); gradient.addColorStop(1, '#ec4899');
    context.strokeStyle = gradient;
    context.lineWidth = Math.max(1, 1.15 / Math.sqrt(state.zoom));
    context.beginPath();
    for (let x = 0; x < pixels; x++) {
      const start = Math.floor(x * step);
      const end = Math.min(samples, Math.max(start + 1, Math.floor((x + 1) * step)));
      let min = 1; let max = -1;
      const scanStep = Math.max(1, Math.floor((end - start) / 120));
      for (let frame = start; frame < end; frame += scanStep) {
        let sample = 0;
        for (let channel = 0; channel < channels.length; channel++) sample += channels[channel][frame] / channels.length;
        min = Math.min(min, sample); max = Math.max(max, sample);
      }
      context.moveTo(x + .5, center + min * center * .88);
      context.lineTo(x + .5, center + max * center * .88);
    }
    context.stroke();
    waveformCacheKey = `${width}:${height}:${state.zoom}:${state.workingData.channels[0].length}:${state.workingData.sampleRate}`;
  }

  function drawWaveform() {
    if (!canvasContext || !canvas) return;
    const width = parseFloat(canvas.style.width) || canvas.clientWidth;
    const height = parseFloat(canvas.style.height) || canvas.clientHeight;
    canvasContext.clearRect(0, 0, width, height);
    canvasContext.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface-waveform').trim() || 'rgba(9,10,18,.75)';
    canvasContext.fillRect(0, 0, width, height);
    if (!state.workingData) return;
    const selection = Core.normalizeSelection(state.selection, currentDuration());
    if (selection) {
      const start = Core.timeToX(selection.start, currentDuration(), width);
      const end = Core.timeToX(selection.end, currentDuration(), width);
      canvasContext.fillStyle = 'rgba(139,92,246,.22)';
      canvasContext.fillRect(start, 0, end - start, height);
      canvasContext.strokeStyle = 'rgba(167,139,250,.9)';
      canvasContext.lineWidth = 1;
      canvasContext.strokeRect(start + .5, .5, Math.max(0, end - start - 1), height - 1);
    }
    const key = `${width}:${height}:${state.zoom}:${state.workingData.channels[0].length}:${state.workingData.sampleRate}`;
    if (!waveformBaseCanvas || waveformCacheKey !== key) buildWaveformBase(width, height);
    canvasContext.drawImage(waveformBaseCanvas, 0, 0, waveformBaseCanvas.width, waveformBaseCanvas.height, 0, 0, width, height);
    const playheadX = Core.timeToX(Math.min(state.playhead, currentDuration()), currentDuration(), width);
    canvasContext.strokeStyle = '#ffffff'; canvasContext.lineWidth = 1.5;
    canvasContext.beginPath(); canvasContext.moveTo(playheadX, 0); canvasContext.lineTo(playheadX, height); canvasContext.stroke();
    canvasContext.fillStyle = '#ffffff'; canvasContext.beginPath(); canvasContext.arc(playheadX, 7, 4, 0, Math.PI * 2); canvasContext.fill();
  }

  function pointerTime(event) {
    const rect = canvas.getBoundingClientRect();
    return Core.xToTime(event.clientX - rect.left, currentDuration(), rect.width);
  }

  function updateSelectionUI() {
    const selection = Core.normalizeSelection(state.selection, currentDuration());
    $('selectionStart').textContent = formatTime(selection ? selection.start : 0, true);
    $('selectionEnd').textContent = formatTime(selection ? selection.end : 0, true);
    $('selectionDuration').textContent = formatTime(selection ? selection.duration : 0, true);
    $('clearSelectionBtn').disabled = !selection;
    ['trimBtn', 'cutBtn', 'copyBtn', 'deleteBtn'].forEach((id) => { $(id).disabled = !selection; });
    $('pasteBtn').disabled = !state.clipboard;
    drawWaveform();
  }

  function keepPlayheadVisible() {
    if (state.zoom <= 1) return;
    const scroll = $('waveformScroll');
    const stageWidth = $('waveformStage').clientWidth;
    const x = Core.timeToX(state.playhead, currentDuration(), stageWidth);
    const leftGuard = scroll.scrollLeft + scroll.clientWidth * .18;
    const rightGuard = scroll.scrollLeft + scroll.clientWidth * .82;
    if (x < leftGuard || x > rightGuard) scroll.scrollTo({ left: Math.max(0, x - scroll.clientWidth * .35), behavior: 'smooth' });
  }

  function updateZoom(value) {
    state.zoom = Core.clamp(value, 1, 12);
    $('zoomValue').textContent = `${Math.round(state.zoom * 100)}%`;
    resizeWaveform();
    keepPlayheadVisible();
  }

  function updateRangeFill(input) {
    if (!input || input.type !== 'range') return;
    const min = Number(input.min); const max = Number(input.max); const value = Number(input.value);
    input.style.setProperty('--range-progress', `${max === min ? 0 : (value - min) / (max - min) * 100}%`);
  }

  function syncSpeedShortcuts() {
    const speed = Number(state.effects.speed);
    document.querySelectorAll('[data-speed-value]').forEach((button) => {
      const active = Math.abs(Number(button.dataset.speedValue) - speed) < 0.005;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function formatPan(value) { return value === 0 ? 'Center' : `${Math.abs(value)}% ${value < 0 ? 'Left' : 'Right'}`; }

  const EFFECT_BINDINGS = [
    ['speedSlider', 'speed', 'speedValue', (v) => `${v.toFixed(2)}x · ${Math.round(v * 100)}%`, 'transport'],
    ['pitchSlider', 'pitch', 'pitchValue', (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} st`, 'transport'],
    ['fineTuneSlider', 'fineTune', 'fineTuneValue', (v) => `${v > 0 ? '+' : ''}${Math.round(v)} cents`, 'transport'],
    ['volumeSlider', 'volume', 'volumeValue', (v) => `${Math.round(v)}%`, 'basic'],
    ['gainSlider', 'gainDb', 'gainValue', (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`, 'basic'],
    ['bassSlider', 'bass', 'bassValue', (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`, 'basic'],
    ['midSlider', 'mid', 'midValue', (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`, 'basic'],
    ['trebleSlider', 'treble', 'trebleValue', (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`, 'basic'],
    ['reverbSlider', 'reverb', 'reverbValue', (v) => `${Math.round(v)}%`, 'basic'],
    ['echoSlider', 'echo', 'echoValue', (v) => `${Math.round(v)}%`, 'basic'],
    ['panSlider', 'pan', 'panValue', formatPan, 'basic'],
    ['eightDSpeed', 'eightDSpeed', 'eightDSpeedValue', (v) => v.toFixed(1), 'basic'],
    ['vocalBoostSlider', 'vocalBoost', 'vocalBoostValue', (v) => `${Math.round(v)}%`, 'advanced'],
    ['stereoWidthSlider', 'stereoWidth', 'stereoWidthValue', (v) => `${Math.round(v)}%`, 'advanced'],
    ['distortionDriveSlider', 'distortionDrive', 'distortionDriveValue', (v) => `${Math.round(v)}%`, 'advanced'],
    ['distortionMixSlider', 'distortionMix', 'distortionMixValue', (v) => `${Math.round(v)}%`, 'advanced'],
    ['highPassFrequency', 'highPassFrequency', 'highPassFrequencyValue', (v) => `${Math.round(v)} Hz`, 'advanced'],
    ['lowPassFrequency', 'lowPassFrequency', 'lowPassFrequencyValue', (v) => `${Math.round(v)} Hz`, 'advanced'],
    ['compressorThreshold', 'compressorThreshold', 'compressorThresholdValue', (v) => `${Math.round(v)} dB`, 'advanced'],
    ['compressorRatio', 'compressorRatio', 'compressorRatioValue', (v) => `${v.toFixed(1)}:1`, 'advanced'],
  ];

  function updateResetEffectButton() {
    const button = $('resetEffectBtn');
    if (button) button.disabled = !state.lastEffectKeys.length;
  }

  function markCustom(section, effectKeys) {
    state.lastSection = section || state.lastSection;
    state.lastEffectKeys = Array.isArray(effectKeys) ? effectKeys.slice() : [];
    state.activePreset = 'custom';
    $('activePresetName').textContent = 'Custom';
    document.querySelectorAll('.preset-btn').forEach((button) => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); });
    updateResetEffectButton();
  }

  function scheduleTransportRestart() {
    clearTimeout(state.transportRestartTimer);
    engine.updateTransportEffectState(state.effects);
  }

  function bindEffectControls() {
    EFFECT_BINDINGS.forEach(([inputId, key, outputId, formatter, section]) => {
      const input = $(inputId);
      input.addEventListener('input', () => {
        if (isBusy()) { syncEffectsToUI(); return showBusyMessage(); }
        state.effects[key] = Number(input.value);
        $(outputId).textContent = formatter(state.effects[key]);
        updateRangeFill(input);
        markCustom(section === 'advanced' ? 'advanced' : 'basic', [key]);
        if (key === 'speed') syncSpeedShortcuts();
        if (section === 'transport') scheduleTransportRestart();
        else engine.setEffectState(state.effects);
      });
    });
    document.querySelectorAll('[data-speed-value]').forEach((button) => button.addEventListener('click', () => {
      if (isBusy()) return showBusyMessage();
      const speed = Number(button.dataset.speedValue);
      $('speedSlider').value = String(speed);
      state.effects.speed = speed;
      $('speedValue').textContent = `${speed.toFixed(2)}x · ${Math.round(speed * 100)}%`;
      updateRangeFill($('speedSlider'));
      syncSpeedShortcuts();
      markCustom('basic', ['speed']);
      scheduleTransportRestart();
    }));
    const limiterSelect = $('limiterThresholdSlider');
    limiterSelect.addEventListener('change', () => { if (isBusy()) { syncEffectsToUI(); return showBusyMessage(); } state.effects.limiterThreshold = Number(limiterSelect.value); $('limiterThresholdValue').textContent = `${limiterSelect.value} dB`; markCustom('advanced', ['limiterThreshold']); engine.setEffectState(state.effects); });
  }

  function setSwitch(id, active) {
    const button = $(id);
    button.setAttribute('aria-checked', String(Boolean(active)));
    button.classList.toggle('active', Boolean(active));
  }

  function bindSwitch(id, key, options) {
    $(id).addEventListener('click', async () => {
      if (isBusy()) return showBusyMessage();
      state.effects[key] = !state.effects[key];
      setSwitch(id, state.effects[key]);
      if (options && options.control) $(options.control).disabled = !state.effects[key];
      markCustom(options && options.section || 'advanced', [key]);
      engine.setEffectState(state.effects);
      if (options && options.rebuild) {
        try { await engine.rebuildGraph(); } catch (error) { showMessage(error.message, 'error'); }
      }
    });
  }

  function renderAdvancedEq() {
    const container = $('advancedEqBands');
    container.innerHTML = '';
    state.effects.advancedEq.forEach((band, index) => {
      const row = document.createElement('div');
      row.className = 'eq-band-row';
      row.dataset.bandId = band.id;
      row.innerHTML = `<label class="eq-enable"><input type="checkbox" ${band.enabled ? 'checked' : ''}><span>Band ${index + 1}</span></label><label>Type<select data-field="type"><option value="bell">Bell</option><option value="lowshelf">Low Shelf</option><option value="highshelf">High Shelf</option><option value="lowcut">Low Cut</option><option value="highcut">High Cut</option></select></label><label>Frequency<input data-field="frequency" type="number" min="20" max="20000" step="10" value="${band.frequency}"></label><label>Gain<input data-field="gain" type="number" min="-18" max="18" step="0.5" value="${band.gain}"></label><label>Q<input data-field="q" type="number" min="0.1" max="18" step="0.1" value="${band.q}"></label>`;
      row.querySelector('[data-field="type"]').value = band.type;
      const commit = async (rebuild) => {
        if (isBusy()) return showBusyMessage();
        band.enabled = row.querySelector('.eq-enable input').checked;
        band.type = row.querySelector('[data-field="type"]').value;
        band.frequency = Core.clamp(row.querySelector('[data-field="frequency"]').value, 20, 20000);
        band.gain = Core.clamp(row.querySelector('[data-field="gain"]').value, -18, 18);
        band.q = Core.clamp(row.querySelector('[data-field="q"]').value, .1, 18);
        row.classList.toggle('enabled', band.enabled);
        markCustom('advanced', ['advancedEq']);
        engine.setEffectState(state.effects);
        if (rebuild) await engine.rebuildGraph();
      };
      row.querySelector('.eq-enable input').addEventListener('change', () => commit(true).catch((error) => showMessage(error.message, 'error')));
      row.querySelector('[data-field="type"]').addEventListener('change', () => commit(true).catch((error) => showMessage(error.message, 'error')));
      row.querySelectorAll('input[type="number"]').forEach((input) => input.addEventListener('change', () => commit(false).catch((error) => showMessage(error.message, 'error'))));
      row.classList.toggle('enabled', band.enabled);
      container.appendChild(row);
    });
  }

  function syncEffectsToUI() {
    EFFECT_BINDINGS.forEach(([inputId, key, outputId, formatter]) => {
      const input = $(inputId); input.value = state.effects[key]; $(outputId).textContent = formatter(Number(state.effects[key])); updateRangeFill(input);
    });
    $('limiterThresholdSlider').value = String(state.effects.limiterThreshold);
    $('limiterThresholdValue').textContent = `${state.effects.limiterThreshold} dB`;
    setSwitch('eightDToggle', state.effects.eightD); $('eightDSpeed').disabled = !state.effects.eightD;
    setSwitch('highPassToggle', state.effects.highPassEnabled);
    setSwitch('lowPassToggle', state.effects.lowPassEnabled);
    setSwitch('compressorToggle', state.effects.compressorEnabled);
    setSwitch('limiterToggle', state.effects.limiterEnabled);
    syncSpeedShortcuts();
    renderAdvancedEq();
  }

  async function applyEffects(nextEffects, presetKey, label, colors, options) {
    if (isBusy() && !(options && options.allowWhileProcessing)) return showBusyMessage();
    const wasPlaying = engine.playing;
    const position = wasPlaying ? engine.currentOffset() : state.playhead;
    engine.stop(false);
    state.effects = normalizeEffects(nextEffects);
    state.activePreset = presetKey || 'custom';
    state.lastEffectKeys = [];
    engine.setEffectState(state.effects);
    syncEffectsToUI();
    $('activePresetName').textContent = label || 'Custom';
    document.querySelectorAll('.preset-btn').forEach((button) => { const active = button.dataset.preset === presetKey; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    updateResetEffectButton();
    if (colors) { document.documentElement.style.setProperty('--vibe-primary', colors[0]); document.documentElement.style.setProperty('--vibe-secondary', colors[1]); }
    try { await engine.rebuildGraph(); if (wasPlaying) { await engine.play(position); playbackLoop(); } } catch (error) { showMessage(error.message, 'error'); }
  }

  function renderFactoryPresets() {
    const grid = $('presetsGrid');
    grid.innerHTML = '';
    Object.entries(FACTORY_PRESETS).forEach(([key, preset], index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `preset-btn${key === state.activePreset ? ' active' : ''}`;
      button.dataset.preset = key; button.dataset.category = preset.category; button.dataset.code = String(index + 1).padStart(2, '0'); button.setAttribute('aria-pressed', String(key === state.activePreset));
      button.innerHTML = `<i data-lucide="${preset.icon}"></i><span>${preset.label}</span><small>${preset.description}</small>`;
      button.addEventListener('click', () => { applyEffects(preset, key, preset.label, preset.colors); showPresetToast(preset.label); });
      grid.appendChild(button);
    });
  }

  function showPresetToast(name) {
    $('presetToastName').textContent = name; $('presetToast').classList.add('show');
    clearTimeout(showPresetToast.timer); showPresetToast.timer = setTimeout(() => $('presetToast').classList.remove('show'), 2200);
  }

  function saveUserPresets() {
    try { localStorage.setItem(PRESET_STORAGE_KEY, Core.serializePresetCollection(state.userPresets)); } catch (error) { showMessage('The preset could not be saved in this browser.', 'error'); }
  }

  function renderUserPresets() {
    const list = $('myPresetsList'); list.innerHTML = '';
    if (!state.userPresets.length) { list.innerHTML = '<p class="empty-presets">No saved presets yet.</p>'; return; }
    state.userPresets.forEach((preset) => {
      const row = document.createElement('div'); row.className = 'my-preset-row';
      const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'my-preset-apply'; apply.textContent = preset.name;
      apply.addEventListener('click', () => { applyEffects(preset.effects, preset.id, preset.name); showPresetToast(preset.name); });
      const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'icon-action'; rename.setAttribute('aria-label', `Rename ${preset.name}`); rename.innerHTML = '<i data-lucide="pencil"></i>';
      rename.addEventListener('click', () => {
        const input = document.createElement('input');
        input.className = 'my-preset-rename-input';
        input.value = preset.name;
        input.maxLength = 48;
        input.setAttribute('aria-label', `Rename ${preset.name}`);
        row.replaceChild(input, apply);
        rename.hidden = true;
        remove.hidden = true;
        let finished = false;
        const finish = (save) => {
          if (finished) return;
          finished = true;
          const name = input.value.trim();
          if (save && name) {
            preset.name = name.slice(0, 48);
            saveUserPresets();
          } else if (save) {
            showMessage('Enter a preset name.', 'error');
          }
          renderUserPresets();
          if (window.lucide) window.lucide.createIcons();
        };
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { event.preventDefault(); finish(true); }
          else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true), { once: true });
        input.focus();
        input.select();
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-action danger'; remove.setAttribute('aria-label', `Delete ${preset.name}`); remove.innerHTML = '<i data-lucide="trash-2"></i>';
      remove.addEventListener('click', () => { state.userPresets = state.userPresets.filter((item) => item.id !== preset.id); saveUserPresets(); renderUserPresets(); if (window.lucide) window.lucide.createIcons(); });
      row.append(apply, rename, remove); list.appendChild(row);
    });
  }

  function withTimeout(promise, timeoutMs, message) {
    let timeout;
    return Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs); })]).finally(() => clearTimeout(timeout));
  }

  function decodeAudioDataCompat(context, arrayBuffer) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const succeed = (buffer) => { if (!settled) { settled = true; resolve(buffer); } };
      const fail = (error) => { if (!settled) { settled = true; reject(error || new Error('The browser could not decode this audio file.')); } };
      try { const result = context.decodeAudioData(arrayBuffer.slice(0), succeed, fail); if (result && result.then) result.then(succeed, fail); } catch (error) { fail(error); }
    });
  }

  function isFlac(file) { return /\.flac$/i.test(file.name) || /audio\/(x-)?flac/i.test(file.type || ''); }

  async function decodeFlac(context, arrayBuffer) {
    const library = window['flac-decoder'];
    const Decoder = library && ((typeof Worker === 'function' && library.FLACDecoderWebWorker) || library.FLACDecoder);
    if (!Decoder) throw new Error('The FLAC decoder could not be loaded. Reload the page.');
    const decoder = new Decoder();
    try {
      await withTimeout(decoder.ready, 30000, 'Loading the FLAC decoder took too long.');
      const decoded = await withTimeout(decoder.decodeFile(new Uint8Array(arrayBuffer)), 120000, 'FLAC decoding took too long.');
      const channels = decoded && Array.isArray(decoded.channelData) ? decoded.channelData : [];
      const samples = channels.length ? Math.min(decoded.samplesDecoded || Infinity, ...channels.map((channel) => channel.length)) : 0;
      if (!channels.length || !samples || !decoded.sampleRate) throw new Error('No audio samples were found in this FLAC file.');
      const output = context.createBuffer(channels.length, samples, decoded.sampleRate);
      channels.forEach((channel, index) => output.copyToChannel(channel.subarray(0, samples), index));
      return output;
    } finally {
      try { if (decoder.terminate) decoder.terminate(); else if (decoder.free) decoder.free(); } catch (error) {}
    }
  }

  async function decodeFile(file, bytes) {
    const context = engine.context.rawContext;
    if (isFlac(file)) {
      setProcessing(true, 'Decoding FLAC...', 38);
      try { return await decodeFlac(context, bytes); } catch (flacError) {
        try { return await withTimeout(decodeAudioDataCompat(context, bytes), 60000, 'FLAC decoding timed out.'); } catch (nativeError) { throw new Error(`This FLAC file could not be decoded. ${flacError.message}`); }
      }
    }
    return withTimeout(decodeAudioDataCompat(context, bytes), 90000, 'Audio decoding timed out. The file may be damaged or unsupported by this browser.');
  }

  async function loadAudioFile(file) {
    if (state.loading || state.exporting) return;
    if (!file || (!(file.type || '').startsWith('audio/') && !SUPPORTED_EXTENSION.test(file.name || ''))) return showMessage('Choose an MP3, WAV, FLAC, M4A/AAC or OGG audio file.', 'error');
    setProcessing(true, 'Reading audio file...', 10);
    engine.primeFromGesture();
    try {
      engine.stop(); cancelAnimationFrame(state.animationFrame);
      const bytes = await withTimeout(file.arrayBuffer(), 120000, 'Reading this file took too long.');
      setProcessing(true, 'Decoding audio...', 28);
      const decoded = await decodeFile(file, bytes);
      if (!decoded || !decoded.length) throw new Error('The decoded audio is empty.');
      const originalData = nativeToData(decoded);
      state.originalData = Core.cloneBufferData(originalData);
      state.workingData = Core.cloneBufferData(originalData);
      state.originalBuffer = dataToNative(state.originalData);
      state.workingBuffer = dataToNative(state.workingData);
      state.clipboard = null; state.selection = null; state.playhead = 0; state.zoom = 1; state.file = file;
      state.history.clear(); state.compareMode = 'modified';
      engine.setBuffers(state.originalBuffer, state.workingBuffer); engine.setCompareMode('modified'); engine.setEffectState(state.effects);
      $('fileName').textContent = file.name;
      $('fileSize').textContent = Core.formatFileSize(file.size);
      $('fileFormat').textContent = Core.detectAudioFormat(file);
      $('exportFilename').value = Core.defaultEditedFilename(file.name, 'wav');
      $('editorWorkspace').hidden = false;
      $('uploadSection').classList.add('has-file');
      updateZoom(1); updateAfterBufferChange(); updateHistoryButtons(); setPlayIcon(false); compare('modified');
      showMessage(`${file.name} is ready.`, 'success', 3000);
    } catch (error) {
      showMessage(error.message || 'This audio file could not be loaded.', 'error', 0);
    } finally {
      setProcessing(false);
      $('fileInput').value = '';
    }
  }

  let silenceAnalysisTimer;
  function scheduleSilenceAnalysis() {
    clearTimeout(silenceAnalysisTimer);
    if (!state.workingData) return;
    silenceAnalysisTimer = setTimeout(() => {
      try {
        const analysis = Core.analyzeSilence(state.workingData, { thresholdDb: Number($('silenceThreshold').value), minimumDuration: Number($('silenceDuration').value) });
        $('silenceEstimate').textContent = analysis.removedSeconds > 0.005 ? `Approximately ${formatTime(analysis.removedSeconds, true)} can be removed.` : 'No matching silence detected.';
      } catch (error) { $('silenceEstimate').textContent = 'Silence analysis is unavailable.'; }
    }, 180);
  }

  function bindEditing() {
    $('copyBtn').addEventListener('click', () => { if (isBusy()) return showBusyMessage(); try { state.clipboard = Core.copyRange(state.workingData, state.selection); updateSelectionUI(); showMessage('Selection copied to the editor clipboard.', 'success'); } catch (error) { showMessage(error.message, 'error'); } });
    $('trimBtn').addEventListener('click', () => performEdit('Trim', () => ({ buffer: Core.trimBuffer(state.workingData, state.selection), selection: null, playhead: 0 })));
    $('cutBtn').addEventListener('click', () => performEdit('Cut', () => { state.clipboard = Core.copyRange(state.workingData, state.selection); const start = Core.normalizeSelection(state.selection, currentDuration()).start; return { buffer: Core.deleteRange(state.workingData, state.selection), selection: null, playhead: start }; }));
    $('deleteBtn').addEventListener('click', () => performEdit('Delete selection', () => { const start = Core.normalizeSelection(state.selection, currentDuration()).start; return { buffer: Core.deleteRange(state.workingData, state.selection), selection: null, playhead: start }; }));
    $('pasteBtn').addEventListener('click', () => performEdit('Paste', () => { if (!state.clipboard) throw new Error('Copy or cut audio before pasting.'); const pasted = Core.pasteBuffer(state.workingData, state.clipboard, state.playhead); return { buffer: pasted.buffer, selection: pasted.insertedSelection, playhead: pasted.insertedSelection.end }; }));
    $('reverseBtn').addEventListener('click', () => performHeavyEdit('Reverse', () => ({ buffer: Core.reverseBuffer(state.workingData, state.selection), selection: state.selection, playhead: state.playhead })));
    $('fadeInBtn').addEventListener('click', () => performHeavyEdit('Fade In', () => ({ buffer: Core.fadeBuffer(state.workingData, state.selection, 'in', 3), selection: state.selection, playhead: state.playhead })));
    $('fadeOutBtn').addEventListener('click', () => performHeavyEdit('Fade Out', () => ({ buffer: Core.fadeBuffer(state.workingData, state.selection, 'out', 3), selection: state.selection, playhead: state.playhead })));
    $('normalizeBtn').addEventListener('click', () => performHeavyEdit('Peak normalization', () => ({ buffer: Core.normalizeBuffer(state.workingData, -1), selection: state.selection, playhead: state.playhead })));
    $('removeSilenceBtn').addEventListener('click', () => performHeavyEdit('Remove Silence', () => { const result = Core.removeSilence(state.workingData, { thresholdDb: Number($('silenceThreshold').value), minimumDuration: Number($('silenceDuration').value) }); if (!result.analysis.intervals.length) throw new Error('No silence matched these settings.'); return { buffer: result.buffer, selection: null, playhead: Math.min(state.playhead, Core.bufferDuration(result.buffer)) }; }));
    $('undoBtn').addEventListener('click', () => { if (isBusy()) return showBusyMessage(); const snapshot = state.history.undo(currentSnapshot('Redo')); if (snapshot) restoreSnapshot(snapshot); updateHistoryButtons(); });
    $('redoBtn').addEventListener('click', () => { if (isBusy()) return showBusyMessage(); const snapshot = state.history.redo(currentSnapshot('Undo')); if (snapshot) restoreSnapshot(snapshot); updateHistoryButtons(); });
  }

  function resetSection(section) {
    const defaults = defaultEffects();
    const keys = section === 'advanced'
      ? ['advancedEq', 'vocalBoost', 'stereoWidth', 'distortionDrive', 'distortionMix', 'highPassEnabled', 'highPassFrequency', 'lowPassEnabled', 'lowPassFrequency', 'compressorEnabled', 'compressorThreshold', 'compressorRatio', 'limiterEnabled', 'limiterThreshold']
      : ['speed', 'pitch', 'fineTune', 'volume', 'gainDb', 'bass', 'mid', 'treble', 'reverb', 'echo', 'pan', 'eightD', 'eightDSpeed'];
    const update = {}; keys.forEach((key) => { update[key] = defaults[key]; });
    applyEffects(Object.assign({}, state.effects, update), 'custom', 'Custom');
  }

  async function resetLastEffect() {
    if (!state.lastEffectKeys.length) return showMessage('Adjust an effect before resetting it.', 'info', 2500);
    const defaults = defaultEffects();
    const update = {};
    state.lastEffectKeys.forEach((key) => { update[key] = JSON.parse(JSON.stringify(defaults[key])); });
    await applyEffects(Object.assign({}, state.effects, update), 'custom', 'Custom');
    showMessage('The last adjusted effect was reset.', 'success', 2500);
  }

  function resetAll() {
    if (!state.originalData) return;
    engine.stop(); state.history.clear(); state.clipboard = null; state.selection = null; state.playhead = 0; state.zoom = 1; state.lastEffectKeys = [];
    state.workingData = Core.cloneBufferData(state.originalData); state.workingBuffer = dataToNative(state.workingData);
    engine.setWorkingBuffer(state.workingBuffer); applyEffects(defaultEffects(), 'normal', 'Normal', FACTORY_PRESETS.normal.colors);
    updateAfterBufferChange(); updateHistoryButtons(); updateSelectionUI(); showMessage('The original audio and all controls were restored.', 'success');
  }

  function setEditorMode(mode, persist) {
    state.editorMode = mode === 'simple' ? 'simple' : 'studio';
    document.body.classList.toggle('simple-mode', state.editorMode === 'simple');
    $('simpleModeBtn').setAttribute('aria-pressed', String(state.editorMode === 'simple'));
    $('studioModeBtn').setAttribute('aria-pressed', String(state.editorMode === 'studio'));
    if (persist) {
      try { localStorage.setItem(UI_MODE_STORAGE_KEY, state.editorMode); } catch (error) {}
      showMessage(state.editorMode === 'simple' ? 'Simple mode shows the focused controls from the classic editor.' : 'Studio mode shows the complete editor.', 'success', 2800);
    }
  }

  async function autoProtectFromClipping() {
    if (!state.workingBuffer) return showMessage('Load an audio file before running auto protection.', 'error');
    if (isBusy()) return showBusyMessage();
    const analysisEffects = normalizeEffects(state.effects);
    analysisEffects.limiterEnabled = false;
    const sampleRate = state.workingBuffer.sampleRate === 48000 ? 48000 : 44100;
    const channels = state.workingBuffer.numberOfChannels === 1 ? 1 : 2;
    let successMessage = '';
    setProcessing(true, 'Analyzing full-track peak...', 2);
    try {
      const rendered = await ExportApi.renderProcessedAudio(state.workingBuffer, analysisEffects, { sampleRate, channels }, (progress) => {
        setProcessing(true, 'Analyzing full-track peak...', Math.min(95, Math.round(progress / 0.55 * 95)));
      });
      const peakDb = Core.gainToDb(nativeBufferPeak(rendered));
      const previousGain = Number(state.effects.gainDb) || 0;
      const nextEffects = normalizeEffects(state.effects);
      nextEffects.gainDb = Core.protectiveGainDb(previousGain, peakDb, -1);
      nextEffects.limiterEnabled = true;
      nextEffects.limiterThreshold = -1;
      await applyEffects(nextEffects, 'custom', 'Auto Protected', null, { allowWhileProcessing: true });
      state.lastEffectKeys = ['gainDb', 'limiterEnabled', 'limiterThreshold'];
      updateResetEffectButton();
      const reduction = previousGain - nextEffects.gainDb;
      successMessage = reduction > 0.05
        ? `Auto protection reduced Processing Gain by ${reduction.toFixed(1)} dB and enabled the -1 dB limiter.`
        : 'Auto protection enabled the -1 dB limiter; no gain reduction was needed.';
    } catch (error) {
      showMessage(`Auto protection failed: ${error.message || 'Unable to analyze this track.'}`, 'error', 0);
    } finally {
      setProcessing(false);
    }
    if (successMessage) showMessage(successMessage, 'success', 6000);
  }

  function updateExportUI() {
    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    $('bitDepthField').hidden = format !== 'wav';
    $('bitrateField').hidden = !['mp3', 'm4a'].includes(format);
    $('exportFilename').value = Core.buildExportFilename($('exportFilename').value, format === 'm4a' ? 'm4a' : format);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function exportCurrentAudio() {
    if (!state.workingBuffer || state.exporting) return showMessage('Load an audio file first.', 'error');
    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    let settings;
    try {
      settings = Core.validateExportSettings({ format, sampleRate: Number($('exportSampleRate').value), channels: Number($('exportChannels').value), bitDepth: Number($('exportBitDepth').value), bitrate: Number($('exportBitrate').value) });
    } catch (error) { return showMessage(error.message, 'error'); }
    state.exporting = true; $('downloadBtn').disabled = true; setProcessing(true, 'Rendering effects...', 1);
    try {
      const result = await ExportApi.exportAudio({ buffer: state.workingBuffer, effectState: normalizeEffects(state.effects), settings, onProgress: (progress, message) => setProcessing(true, message, Math.round(progress * 100)) });
      const filename = Core.buildExportFilename($('exportFilename').value, result.extension);
      $('exportFilename').value = filename;
      triggerDownload(result.blob, filename);
      const renderedData = nativeToData(result.renderedBuffer); const peak = Core.getPeak(renderedData); const peakDb = Core.gainToDb(peak);
      $('peakValue').textContent = `${peakDb.toFixed(1)} dB`; $('clipIndicator').textContent = peak >= .999 ? 'CLIPPING DETECTED' : 'Clipping: No'; $('clipIndicator').classList.toggle('active', peak >= .999);
      showMessage(`${filename} exported successfully.`, 'success', 5000);
    } catch (error) { showMessage(`Export failed: ${error.message || 'Unknown encoder error.'}`, 'error', 0); }
    finally { state.exporting = false; $('downloadBtn').disabled = false; setProcessing(false); }
  }

  function bindWaveform() {
    canvas.addEventListener('pointerdown', (event) => {
      if (!state.workingData) return; engine.primeFromGesture(); canvas.setPointerCapture(event.pointerId);
      state.draggingSelection = true; state.pointerStartX = event.clientX; state.pointerStartTime = pointerTime(event); state.selection = { start: state.pointerStartTime, end: state.pointerStartTime }; updateSelectionUI(); event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => { if (!state.draggingSelection) return; state.selection = { start: state.pointerStartTime, end: pointerTime(event) }; updateSelectionUI(); event.preventDefault(); });
    const finish = (event) => {
      if (!state.draggingSelection) return; state.draggingSelection = false;
      if (Math.abs(event.clientX - state.pointerStartX) < 5) { state.selection = null; seekTo(pointerTime(event), false); }
      else state.selection = Core.normalizeSelection(state.selection, currentDuration());
      updateSelectionUI();
    };
    canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish);
    $('clearSelectionBtn').addEventListener('click', () => { state.selection = null; updateSelectionUI(); });
    $('zoomInBtn').addEventListener('click', () => updateZoom(state.zoom * 1.5)); $('zoomOutBtn').addEventListener('click', () => updateZoom(state.zoom / 1.5)); $('zoomResetBtn').addEventListener('click', () => updateZoom(1));
    $('waveLeftBtn').addEventListener('click', () => $('waveformScroll').scrollBy({ left: -$('waveformScroll').clientWidth * .7, behavior: 'smooth' }));
    $('waveRightBtn').addEventListener('click', () => $('waveformScroll').scrollBy({ left: $('waveformScroll').clientWidth * .7, behavior: 'smooth' }));
    window.addEventListener('resize', () => { clearTimeout(resizeWaveform.timer); resizeWaveform.timer = setTimeout(resizeWaveform, 120); });
  }

  function bindUpload() {
    $('fileInput').addEventListener('change', (event) => { const file = event.target.files && event.target.files[0]; if (file) loadAudioFile(file); });
    const upload = $('uploadSection');
    ['dragenter', 'dragover'].forEach((name) => upload.addEventListener(name, (event) => { event.preventDefault(); upload.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach((name) => upload.addEventListener(name, (event) => { event.preventDefault(); upload.classList.remove('drag-over'); }));
    upload.addEventListener('drop', (event) => { const file = event.dataTransfer.files && event.dataTransfer.files[0]; if (file) loadAudioFile(file); });
    upload.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('fileInput').click(); } });
  }

  function bindPlayer() {
    $('playBtn').addEventListener('click', togglePlayback);
    $('stopBtn').addEventListener('click', () => { engine.stop(); setPlayIcon(false); updateProgress(0); });
    $('backBtn').addEventListener('click', () => seekTo(state.playhead - 10)); $('forwardBtn').addEventListener('click', () => seekTo(state.playhead + 10));
    $('progressBar').addEventListener('click', (event) => { const rect = $('progressBar').getBoundingClientRect(); seekTo((event.clientX - rect.left) / rect.width * playbackDuration()); });
    $('progressBar').addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); seekTo(state.playhead + (event.key === 'ArrowLeft' ? -5 : 5)); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); seekTo(event.key === 'Home' ? 0 : playbackDuration()); }
    });
    $('compareOriginalBtn').addEventListener('click', () => compare('original')); $('compareModifiedBtn').addEventListener('click', () => compare('modified'));
  }

  function bindPresets() {
    $('presetToggle').addEventListener('click', () => { const open = $('presetToggle').getAttribute('aria-expanded') !== 'true'; $('presetToggle').setAttribute('aria-expanded', String(open)); $('presetToggleLabel').textContent = open ? 'Hide presets' : 'Show presets'; $('presetPanel').setAttribute('aria-hidden', String(!open)); $('presetPanel').inert = !open; $('presetPanel').classList.toggle('open', open); });
    document.querySelectorAll('.preset-filter').forEach((filter) => filter.addEventListener('click', () => { document.querySelectorAll('.preset-filter').forEach((button) => button.classList.toggle('active', button === filter)); document.querySelectorAll('.preset-btn').forEach((button) => { button.hidden = filter.dataset.filter !== 'all' && button.dataset.category !== filter.dataset.filter; }); }));
    $('savePresetBtn').addEventListener('click', () => { try { const record = Core.createPresetRecord($('presetNameInput').value, state.effects); state.userPresets.push(record); saveUserPresets(); renderUserPresets(); $('presetNameInput').value = ''; if (window.lucide) window.lucide.createIcons(); showMessage(`${record.name} saved on this device.`, 'success'); } catch (error) { showMessage(error.message, 'error'); } });
  }

  function bindEditorMode() {
    $('simpleModeBtn').addEventListener('click', () => setEditorMode('simple', true));
    $('studioModeBtn').addEventListener('click', () => setEditorMode('studio', true));
  }

  function bindWorkspaceNavigation() {
    document.querySelectorAll('[data-panel-target]').forEach((button) => button.addEventListener('click', () => {
      const panel = $(button.dataset.panelTarget);
      if (!panel) return;
      panel.open = true;
      document.querySelectorAll('[data-panel-target]').forEach((item) => item.classList.toggle('active', item === button));
      window.setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
    }));
    document.querySelectorAll('.editor-panel').forEach((panel) => panel.addEventListener('toggle', () => {
      if (!panel.open) return;
      document.querySelectorAll('[data-panel-target]').forEach((button) => button.classList.toggle('active', button.dataset.panelTarget === panel.id));
    }));
  }

  function bindAdvanced() {
    bindSwitch('eightDToggle', 'eightD', { control: 'eightDSpeed', section: 'basic', rebuild: true });
    bindSwitch('highPassToggle', 'highPassEnabled', { section: 'advanced' }); bindSwitch('lowPassToggle', 'lowPassEnabled', { section: 'advanced' });
    bindSwitch('compressorToggle', 'compressorEnabled', { section: 'advanced' }); bindSwitch('limiterToggle', 'limiterEnabled', { section: 'advanced' });
    $('resetEqBtn').addEventListener('click', () => { if (isBusy()) return showBusyMessage(); state.effects.advancedEq = JSON.parse(JSON.stringify(DEFAULT_ADVANCED_EQ)); renderAdvancedEq(); markCustom('advanced', []); engine.rebuildGraph().catch((error) => showMessage(error.message, 'error')); });
    $('resetBasicBtn').addEventListener('click', () => resetSection('basic')); $('resetAdvancedBtn').addEventListener('click', () => resetSection('advanced'));
    $('resetEffectBtn').addEventListener('click', resetLastEffect); $('resetBtn').addEventListener('click', resetAll);
    $('silenceThreshold').addEventListener('input', () => { $('silenceThresholdValue').textContent = `${$('silenceThreshold').value} dB`; updateRangeFill($('silenceThreshold')); scheduleSilenceAnalysis(); });
    $('silenceDuration').addEventListener('input', () => { $('silenceDurationValue').textContent = `${Number($('silenceDuration').value).toFixed(2)} s`; updateRangeFill($('silenceDuration')); scheduleSilenceAnalysis(); });
  }

  function isEditableTarget(target) { return target && (target.matches('input, textarea, select') || target.isContentEditable); }
  function bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      if (isEditableTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
      else if (event.key.toLowerCase() === 'j') { event.preventDefault(); seekTo(state.playhead - 10); }
      else if (event.key.toLowerCase() === 'l') { event.preventDefault(); seekTo(state.playhead + 10); }
      else if (modifier && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); $('undoBtn').click(); }
      else if ((modifier && event.key.toLowerCase() === 'z' && event.shiftKey) || (modifier && event.key.toLowerCase() === 'y')) { event.preventDefault(); $('redoBtn').click(); }
      else if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); $('copyBtn').click(); }
      else if (modifier && event.key.toLowerCase() === 'x') { event.preventDefault(); $('cutBtn').click(); }
      else if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); $('pasteBtn').click(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { if (state.selection) { event.preventDefault(); $('deleteBtn').click(); } }
    });
  }

  function initialize() {
    canvas = $('waveform'); canvasContext = canvas.getContext('2d');
    engine = new EngineApi.AudioEngine({ onMeter: (meter) => { $('peakValue').textContent = `${meter.peakDb.toFixed(1)} dB`; $('rmsValue').textContent = `${meter.rmsDb.toFixed(1)} dB`; $('clipIndicator').textContent = meter.clipping ? 'CLIPPING DETECTED' : 'Clipping: No'; $('clipIndicator').classList.toggle('active', meter.clipping); } });
    engine.setEffectState(state.effects);
    try { state.userPresets = Core.parsePresetCollection(localStorage.getItem(PRESET_STORAGE_KEY)); } catch (error) { state.userPresets = []; }
    try { setEditorMode(localStorage.getItem(UI_MODE_STORAGE_KEY), false); } catch (error) { setEditorMode('studio', false); }
    renderFactoryPresets(); renderUserPresets(); renderAdvancedEq(); syncEffectsToUI();
    bindUpload(); bindPlayer(); bindWaveform(); bindEditing(); bindEffectControls(); bindAdvanced(); bindPresets(); bindEditorMode(); bindWorkspaceNavigation(); bindKeyboard();
    document.querySelectorAll('input[type="range"]').forEach(updateRangeFill);
    document.querySelectorAll('input[name="exportFormat"]').forEach((input) => input.addEventListener('change', updateExportUI));
    $('downloadBtn').addEventListener('click', exportCurrentAudio); $('autoProtectBtn').addEventListener('click', autoProtectFromClipping); updateExportUI(); updateSelectionUI(); updateHistoryButtons();
    const prime = () => engine.primeFromGesture(); document.addEventListener('pointerdown', prime, { passive: true }); document.addEventListener('touchend', prime, { passive: true }); document.addEventListener('keydown', prime);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && engine.playing) engine.ensureRunning().catch(() => {}); });
    window.addEventListener('pagehide', () => { cancelAnimationFrame(state.animationFrame); if (engine) engine.stop(); });
    if (window.lucide) window.lucide.createIcons();
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
