// Global variables
let audioContext;
let audioBuffer;
let sourceNode;
let analyser;
let preGainNode;
let gainNode;
let outputGainNode;
let compressorNode;
let bassFilter;
let midFilter;
let trebleFilter;
let panNode;
let convolverNode;
let reverbDryGain;
let reverbWetGain;
let delayNode;
let delayGain;
let isPlaying = false;
let startTime = 0;
let pauseTime = 0;
let animationId;
let progressRafId;
let meterInterval;
let eightDAudioInterval;
let eightDEnabled = false;
let limiterEnabled = true;
let currentFileName = '';
let clipCount = 0;
let peakHold = 0;
let peakHoldTime = 0;
// playbackRate currently in use (set once on play, kept in sync)
let currentPlaybackRate = 1.0;

// DOM Elements
const uploadSection = document.getElementById('uploadSection');
const fileInput = document.getElementById('fileInput');
const playerSection = document.getElementById('playerSection');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');
const downloadBtn = document.getElementById('downloadBtn');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressThumb = document.getElementById('progressThumb');
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const fileNameEl = document.getElementById('fileName');
const waveformCanvas = document.getElementById('waveform');
const waveformCtx = waveformCanvas.getContext('2d');

// Play/Pause icon helpers
const playIcon  = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');

function showPlayIcon()  { playIcon.style.display = ''; pauseIcon.style.display = 'none'; }
function showPauseIcon() { playIcon.style.display = 'none'; pauseIcon.style.display = ''; }

// ── Adjusted duration based on playbackRate ──────────────────────────────────
function getPlaybackRate() {
    const pitchShift = parseFloat(document.getElementById('pitchSlider').value);
    const speed = parseFloat(document.getElementById('speedSlider').value);
    return speed * Math.pow(2, pitchShift / 12);
}

function getAdjustedDuration() {
    if (!audioBuffer) return 0;
    return audioBuffer.duration / getPlaybackRate();
}

// ── Unified progress UI updater ───────────────────────────────────────────────
function syncProgressUI(sourceTime) {
    if (!audioBuffer) return;

    if (sourceTime === undefined) {
        sourceTime = getCurrentSourceTime();
    }

    const sourceDuration = audioBuffer.duration;
    const ratio = sourceDuration > 0
        ? Math.max(0, Math.min(1, sourceTime / sourceDuration))
        : 0;

    const pct = (ratio * 100).toFixed(4) + '%';

    progressFill.style.width = pct;

    if (progressThumb) {
        progressThumb.style.left = pct;
    }

    const adjustedDuration = getAdjustedDuration();
    const adjustedCurrentTime = ratio * adjustedDuration;
    currentTimeEl.textContent = formatTime(adjustedCurrentTime);
    totalTimeEl.textContent   = formatTime(adjustedDuration);
}

function getCurrentSourceTime() {
    if (!audioBuffer) return 0;
    if (isPlaying) {
        const wallElapsed = audioContext.currentTime - startTime;
        return Math.min(wallElapsed * currentPlaybackRate, audioBuffer.duration);
    }
    return Math.min(pauseTime, audioBuffer.duration);
}

// ── Pause without resetting position ─────────────────────────────────────────
function pauseWithoutReset() {
    if (sourceNode) {
        try { sourceNode.stop(); } catch(e){}
        sourceNode.disconnect();
    }
    isPlaying = false;
    showPlayIcon();
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ====================================
// FILE UPLOAD HANDLING
// ====================================

uploadSection.addEventListener('click', () => { fileInput.click(); });

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadAudioFile(file);
});

uploadSection.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadSection.classList.add('drag-over');
});

uploadSection.addEventListener('dragleave', () => {
    uploadSection.classList.remove('drag-over');
});

uploadSection.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadSection.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
        loadAudioFile(file);
    } else {
        alert('Please upload a valid audio file (MP3, WAV, OGG)');
    }
});

// ====================================
// AUDIO LOADING & INITIALIZATION
// ====================================

async function loadAudioFile(file) {
    currentFileName = file.name;
    fileNameEl.textContent = currentFileName;

    try {
        if (audioContext) {
            try { await audioContext.close(); } catch(e){}
        }
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        document.querySelectorAll('.player-section').forEach(el => el.classList.add('active'));

        initializeAudioNodes();
        drawWaveform();

        pauseTime = 0;
        startTime = 0;
        isPlaying = false;
        showPlayIcon();
        syncProgressUI(0);

        console.log('✅ Audio loaded successfully');
    } catch (error) {
        console.error('Error loading audio:', error);
        alert('Failed to load audio file. Please try another file.');
    }
}

// ====================================
// AUDIO NODES SETUP
// ====================================

function initializeAudioNodes() {
    preGainNode = audioContext.createGain();
    preGainNode.gain.value = dbToGain(-9);

    gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    bassFilter = audioContext.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 200;
    bassFilter.gain.value = 0;

    midFilter = audioContext.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 0.8;
    midFilter.gain.value = 0;

    trebleFilter = audioContext.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 3000;
    trebleFilter.gain.value = 0;

    panNode = audioContext.createStereoPanner
        ? audioContext.createStereoPanner()
        : null;

    convolverNode = audioContext.createConvolver();
    reverbDryGain = audioContext.createGain();
    reverbWetGain = audioContext.createGain();
    reverbDryGain.gain.value = 1.0;
    reverbWetGain.gain.value = 0.0;
    createReverbImpulse(2, 0);

    delayNode = audioContext.createDelay(5.0);
    delayNode.delayTime.value = 0.3;
    delayGain = audioContext.createGain();
    delayGain.gain.value = 0;

    compressorNode = audioContext.createDynamicsCompressor();
    compressorNode.threshold.value = -6;
    compressorNode.knee.value = 0;
    compressorNode.ratio.value = 20;
    compressorNode.attack.value = 0.003;
    compressorNode.release.value = 0.1;

    outputGainNode = audioContext.createGain();
    outputGainNode.gain.value = dbToGain(-1);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
}

// ====================================
// REVERB IMPULSE RESPONSE
// ====================================

function createReverbImpulse(duration, decay) {
    const rate = audioContext.sampleRate;
    const length = Math.max(1, Math.round(rate * duration));
    const impulse = audioContext.createBuffer(2, length, rate);
    const safeDecay = Math.max(0.001, decay);
    for (let ch = 0; ch < 2; ch++) {
        const buf = impulse.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            buf[i] = (Math.random() * 2 - 1) * Math.pow((length - i) / length, safeDecay);
        }
    }
    convolverNode.buffer = impulse;
}

// ====================================
// AUDIO PLAYBACK CONTROL
// ====================================

function play() {
    if (!audioBuffer) return;

    if (isPlaying) {
        pause();
        return;
    }

    if (audioContext.state === 'suspended') audioContext.resume();

    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;

    currentPlaybackRate = getPlaybackRate();
    sourceNode.playbackRate.value = currentPlaybackRate;

    connectAudioGraph();

    const offset = Math.min(pauseTime, audioBuffer.duration - 0.001);
    sourceNode.start(0, offset);
    startTime = audioContext.currentTime - (offset / currentPlaybackRate);
    isPlaying = true;

    showPauseIcon();

    sourceNode.onended = () => {
        if (isPlaying) stop();
    };

    visualize();
    scheduleProgressUpdate();
    startLevelMeter();
}

function pause() {
    if (!isPlaying) return;
    pauseTime = getCurrentSourceTime();
    try { sourceNode.stop(); } catch(e){}
    isPlaying = false;
    showPlayIcon();
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

function stop() {
    if (sourceNode) {
        try { sourceNode.stop(); } catch(e){}
        sourceNode.disconnect();
    }
    isPlaying = false;
    pauseTime = 0;
    startTime = 0;
    showPlayIcon();
    syncProgressUI(0);
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ====================================
// AUDIO GRAPH CONNECTION
// ====================================

function connectAudioGraph() {
    sourceNode.connect(preGainNode);
    preGainNode.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);

    let afterFilters = trebleFilter;
    if (panNode) {
        afterFilters.connect(panNode);
        afterFilters = panNode;
    }
    afterFilters.connect(gainNode);

    gainNode.connect(delayNode);
    delayNode.connect(delayGain);
    delayGain.connect(delayNode);
    delayGain.connect(gainNode);

    const reverbValue = parseFloat(document.getElementById('reverbSlider').value) / 100;
    reverbDryGain.gain.value = 1 - reverbValue;
    reverbWetGain.gain.value = reverbValue * 0.6;

    const merger = audioContext.createGain();
    gainNode.connect(reverbDryGain);
    reverbDryGain.connect(merger);
    gainNode.connect(convolverNode);
    convolverNode.connect(reverbWetGain);
    reverbWetGain.connect(merger);

    if (limiterEnabled) {
        merger.connect(compressorNode);
        compressorNode.connect(outputGainNode);
    } else {
        merger.connect(outputGainNode);
    }

    outputGainNode.connect(analyser);
    analyser.connect(audioContext.destination);
}

// ====================================
// LEVEL METERING
// ====================================

function startLevelMeter() {
    const meterFill    = document.getElementById('meterFill');
    const meterPeak    = document.getElementById('meterPeak');
    const clipIndicator= document.getElementById('clipIndicator');
    const peakValueEl  = document.getElementById('peakValue');
    const rmsValueEl   = document.getElementById('rmsValue');

    const bufferLength = analyser.frequencyBinCount;
    const dataArray    = new Float32Array(bufferLength);

    meterInterval = setInterval(() => {
        analyser.getFloatTimeDomainData(dataArray);
        let sumSquares = 0, peak = 0;
        for (let i = 0; i < bufferLength; i++) {
            const sample = Math.abs(dataArray[i]);
            sumSquares += dataArray[i] * dataArray[i];
            if (sample > peak) peak = sample;
        }
        const rms = Math.sqrt(sumSquares / bufferLength);
        const rmsDb = gainToDb(rms);
        const peakDb = gainToDb(peak);
        const rmsPercent = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
        if (meterFill) meterFill.style.width = rmsPercent + '%';
        if (rmsValueEl) rmsValueEl.textContent = rmsDb.toFixed(1) + ' dB';
        if (peak > peakHold) { peakHold = peak; peakHoldTime = Date.now(); }
        if (Date.now() - peakHoldTime > 1000) peakHold *= 0.95;
        const peakPercent = Math.max(0, Math.min(100, ((gainToDb(peakHold) + 60) / 60) * 100));
        if (meterPeak) meterPeak.style.left = peakPercent + '%';
        if (peakValueEl) peakValueEl.textContent = gainToDb(peakHold).toFixed(1) + ' dB';
        if (peakDb > -1) {
            if (clipIndicator) clipIndicator.classList.add('active');
            clipCount++;
            if (clipCount > 5) {
                const currentOutputGain = parseFloat(document.getElementById('outputGainSlider').value);
                const newGain = Math.max(-12, currentOutputGain - 1);
                document.getElementById('outputGainSlider').value = newGain;
                document.getElementById('outputGainValue').textContent = newGain.toFixed(1) + ' dB';
                outputGainNode.gain.value = dbToGain(newGain);
                clipCount = 0;
            }
        } else {
            if (clipIndicator) clipIndicator.classList.remove('active');
            if (clipCount > 0) clipCount--;
        }
    }, 50);
}

function stopLevelMeter() {
    if (meterInterval) { clearInterval(meterInterval); meterInterval = null; }
    const mf = document.getElementById('meterFill');
    const mp = document.getElementById('meterPeak');
    const pv = document.getElementById('peakValue');
    const rv = document.getElementById('rmsValue');
    const ci = document.getElementById('clipIndicator');
    if (mf) mf.style.width = '0%';
    if (mp) mp.style.left = '0%';
    if (pv) pv.textContent = '-∞ dB';
    if (rv) rv.textContent = '-∞ dB';
    if (ci) ci.classList.remove('active');
}

// ====================================
// WAVEFORM VISUALIZATION
// ====================================

function drawWaveform() {
    const width  = waveformCanvas.width  = waveformCanvas.offsetWidth  * 2;
    const height = waveformCanvas.height = waveformCanvas.offsetHeight * 2;
    const data   = audioBuffer.getChannelData(0);
    const step   = Math.ceil(data.length / width);
    const amp    = height / 2;

    waveformCtx.fillStyle = 'rgba(15, 15, 30, 1)';
    waveformCtx.fillRect(0, 0, width, height);
    waveformCtx.beginPath();
    waveformCtx.strokeStyle = '#667eea';
    waveformCtx.lineWidth = 2;

    for (let i = 0; i < width; i++) {
        let min = 1.0, max = -1.0;
        for (let j = 0; j < step; j++) {
            const datum = data[(i * step) + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        const y1 = (1 + min) * amp;
        if (i === 0) waveformCtx.moveTo(i, y1);
        else waveformCtx.lineTo(i, y1);
    }
    waveformCtx.stroke();
}

function visualize() {
    const width  = waveformCanvas.width;
    const height = waveformCanvas.height;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray    = new Uint8Array(bufferLength);

    function draw() {
        if (!isPlaying) return;
        animationId = requestAnimationFrame(draw);
        analyser.getByteTimeDomainData(dataArray);
        waveformCtx.fillStyle = 'rgba(15, 15, 30, 0.3)';
        waveformCtx.fillRect(0, 0, width, height);
        waveformCtx.lineWidth = 3;
        waveformCtx.strokeStyle = '#764ba2';
        waveformCtx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * height / 2;
            if (i === 0) waveformCtx.moveTo(x, y);
            else waveformCtx.lineTo(x, y);
            x += sliceWidth;
        }
        waveformCtx.lineTo(width, height / 2);
        waveformCtx.stroke();
    }
    draw();
}

// ====================================
// PROGRESS BAR — seek on mousedown, drag to scrub
// ====================================

function scheduleProgressUpdate() {
    cancelAnimationFrame(progressRafId);
    if (!isPlaying || isDragging) return;

    const src = getCurrentSourceTime();
    syncProgressUI(src);

    if (src < audioBuffer.duration) {
        progressRafId = requestAnimationFrame(scheduleProgressUpdate);
    }
}

let isDragging = false;
let wasPausedBeforeDrag = false;

// Central seek function used by both click and drag
function seekToPosition(clientX) {
    if (!audioBuffer) return;
    const rect = progressBar.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    pauseTime  = pct * audioBuffer.duration;
    syncProgressUI(pauseTime);
}

progressBar.addEventListener('mousedown', (e) => {
    if (!audioBuffer) return;
    isDragging = true;
    wasPausedBeforeDrag = !isPlaying;

    // Seek immediately on mousedown — this handles both click and drag start
    if (isPlaying) pauseWithoutReset();
    seekToPosition(e.clientX);

    progressBar.style.cursor = 'grabbing';
});

progressBar.addEventListener('touchstart', (e) => {
    if (!audioBuffer) return;
    isDragging = true;
    wasPausedBeforeDrag = !isPlaying;

    if (isPlaying) pauseWithoutReset();
    seekToPosition(e.touches[0].clientX);
}, { passive: true });

document.addEventListener('mousemove', (e) => {
    if (isDragging) seekToPosition(e.clientX);
});

document.addEventListener('touchmove', (e) => {
    if (isDragging) seekToPosition(e.touches[0].clientX);
}, { passive: true });

document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    progressBar.style.cursor = 'pointer';
    if (!wasPausedBeforeDrag) play();
});

document.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    if (!wasPausedBeforeDrag) play();
});

// ====================================
// CONTROL SLIDERS
// ====================================

document.getElementById('preGainSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('preGainValue').textContent = value.toFixed(1) + ' dB';
    if (preGainNode) preGainNode.gain.value = dbToGain(value);
});

document.getElementById('outputGainSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('outputGainValue').textContent = value.toFixed(1) + ' dB';
    if (outputGainNode) outputGainNode.gain.value = dbToGain(value);
    clipCount = 0;
});

const limiterToggle = document.getElementById('limiterToggle');
limiterToggle.addEventListener('click', () => {
    limiterEnabled = !limiterEnabled;
    limiterToggle.classList.toggle('active');
});

document.getElementById('limiterThresholdSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('limiterThresholdValue').textContent = value.toFixed(1) + ' dB';
    if (compressorNode) compressorNode.threshold.value = value;
});

document.getElementById('speedSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('speedValue').textContent = value.toFixed(2) + 'x';

    if (audioBuffer) {
        if (isPlaying && sourceNode) {
            const currentSource = getCurrentSourceTime();
            currentPlaybackRate = getPlaybackRate();
            sourceNode.playbackRate.value = currentPlaybackRate;
            startTime = audioContext.currentTime - (currentSource / currentPlaybackRate);
        } else {
            currentPlaybackRate = getPlaybackRate();
        }
        syncProgressUI();
    }
});

document.getElementById('pitchSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('pitchValue').textContent = value.toFixed(1) + ' semitones';

    if (audioBuffer) {
        if (isPlaying && sourceNode) {
            const currentSource = getCurrentSourceTime();
            currentPlaybackRate = getPlaybackRate();
            sourceNode.playbackRate.value = currentPlaybackRate;
            startTime = audioContext.currentTime - (currentSource / currentPlaybackRate);
        } else {
            currentPlaybackRate = getPlaybackRate();
        }
        syncProgressUI();
    }
});

document.getElementById('volumeSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('volumeValue').textContent = value.toFixed(1) + '%';
    if (gainNode) gainNode.gain.value = value / 100;
});

document.getElementById('bassSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('bassValue').textContent = value.toFixed(1) + ' dB';
    if (bassFilter) bassFilter.gain.value = Math.min(value, 15);
});

document.getElementById('trebleSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('trebleValue').textContent = value.toFixed(1) + ' dB';
    if (trebleFilter) trebleFilter.gain.value = value;
});

document.getElementById('panSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    const absValue = Math.abs(value).toFixed(1);
    document.getElementById('panValue').textContent = value === 0 ? 'Center' : value < 0 ? absValue + '% Left' : absValue + '% Right';
    if (panNode && !eightDEnabled) panNode.pan.value = value / 100;
});

document.getElementById('reverbSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('reverbValue').textContent = value.toFixed(1) + '%';
    const wetLevel = value / 100;
    if (reverbDryGain) reverbDryGain.gain.value = 1 - wetLevel;
    if (reverbWetGain) reverbWetGain.gain.value = wetLevel * 0.6;
    if (convolverNode) createReverbImpulse(2, Math.max(0.001, value / 20));
});

document.getElementById('echoSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('echoValue').textContent = value.toFixed(1) + '%';
    if (delayGain) delayGain.gain.value = Math.min(0.55, value / 100 * 0.5);
});

const eightDToggle = document.getElementById('eightDToggle');
eightDToggle.addEventListener('click', () => {
    eightDEnabled = !eightDEnabled;
    eightDToggle.classList.toggle('active');
    eightDToggle.setAttribute('aria-checked', eightDEnabled);
    if (eightDEnabled) start8DAudio(); else stop8DAudio();
});

document.getElementById('eightDSpeed').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('eightDSpeedValue').textContent = value.toFixed(1);
    if (eightDEnabled) { stop8DAudio(); start8DAudio(); }
});

// ====================================
// 8D AUDIO
// ====================================

function start8DAudio() {
    if (!panNode) return;
    const speed = parseFloat(document.getElementById('eightDSpeed').value);
    let angle = 0;
    eightDAudioInterval = setInterval(() => {
        angle += 0.05 * speed;
        if (panNode) panNode.pan.value = Math.sin(angle);
    }, 50);
}

function stop8DAudio() {
    if (eightDAudioInterval) { clearInterval(eightDAudioInterval); eightDAudioInterval = null; }
    if (panNode) panNode.pan.value = parseFloat(document.getElementById('panSlider').value) / 100;
}

// ====================================
// PRESETS
// ====================================

const presets = {
    normal:     { speed:1.00, pitch:  0, volume:100, bass: 0, treble: 0, pan:0, reverb:  0, echo: 0, eightD:false, preGain: -9, outputGain:-1 },
    nightcore:  { speed:1.30, pitch:  3, volume:100, bass: 0, treble: 5, pan:0, reverb: 10, echo: 0, eightD:false, preGain:-12, outputGain:-2 },
    deepbass:   { speed:0.90, pitch: -3, volume:110, bass:12, treble:-5, pan:0, reverb: 15, echo: 5, eightD:false, preGain:-15, outputGain:-3 },
    '8daudio':  { speed:1.00, pitch:  0, volume:100, bass: 3, treble: 2, pan:0, reverb: 25, echo:15, eightD:true,  preGain:-12, outputGain:-2 },
    concert:    { speed:1.00, pitch:  0, volume:105, bass: 8, treble: 4, pan:0, reverb: 60, echo:20, eightD:false, preGain:-15, outputGain:-3 },
    slowcore:   { speed:0.72, pitch: -2, volume:100, bass: 4, treble:-2, pan:0, reverb: 65, echo:12, eightD:false, preGain:-12, outputGain:-2 },
    lofi:       { speed:0.92, pitch: -1, volume: 95, bass: 6, treble:-4, pan:0, reverb: 30, echo: 8, eightD:false, preGain:-12, outputGain:-2 },
    vaporwave:  { speed:0.80, pitch: -4, volume:100, bass: 5, treble: 0, pan:0, reverb: 50, echo:18, eightD:false, preGain:-12, outputGain:-2 },
    phonecall:  { speed:1.00, pitch:  2, volume:100, bass:-8, treble: 6, pan:0, reverb:  5, echo: 0, eightD:false, preGain: -6, outputGain: 0 },
    underwater: { speed:0.85, pitch: -5, volume:100, bass: 8, treble:-8, pan:0, reverb: 80, echo:30, eightD:false, preGain:-15, outputGain:-3 },
};

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const preset = presets[btn.dataset.preset];
        if (preset) applyPreset(preset);
    });
});

function applyPreset(preset) {
    document.getElementById('speedSlider').value  = preset.speed;
    document.getElementById('speedValue').textContent = preset.speed.toFixed(2) + 'x';
    document.getElementById('pitchSlider').value  = preset.pitch;
    document.getElementById('pitchValue').textContent = preset.pitch.toFixed(1) + ' semitones';
    document.getElementById('volumeSlider').value = preset.volume;
    document.getElementById('volumeValue').textContent = preset.volume.toFixed(1) + '%';
    document.getElementById('bassSlider').value   = preset.bass;
    document.getElementById('bassValue').textContent  = preset.bass.toFixed(1) + ' dB';
    document.getElementById('trebleSlider').value = preset.treble;
    document.getElementById('trebleValue').textContent= preset.treble.toFixed(1) + ' dB';
    document.getElementById('panSlider').value    = preset.pan;
    document.getElementById('panValue').textContent   = 'Center';
    document.getElementById('reverbSlider').value = preset.reverb;
    document.getElementById('reverbValue').textContent= preset.reverb.toFixed(1) + '%';
    document.getElementById('echoSlider').value   = preset.echo;
    document.getElementById('echoValue').textContent  = preset.echo.toFixed(1) + '%';
    document.getElementById('preGainSlider').value     = preset.preGain;
    document.getElementById('preGainValue').textContent= preset.preGain.toFixed(1) + ' dB';
    document.getElementById('outputGainSlider').value      = preset.outputGain;
    document.getElementById('outputGainValue').textContent = preset.outputGain.toFixed(1) + ' dB';

    if (gainNode)      gainNode.gain.value      = preset.volume / 100;
    if (bassFilter)    bassFilter.gain.value    = preset.bass;
    if (trebleFilter)  trebleFilter.gain.value  = preset.treble;
    if (panNode)       panNode.pan.value        = preset.pan / 100;
    if (delayGain)     delayGain.gain.value     = Math.min(0.55, preset.echo / 100 * 0.5);
    if (preGainNode)   preGainNode.gain.value   = dbToGain(preset.preGain);
    if (outputGainNode)outputGainNode.gain.value= dbToGain(preset.outputGain);
    const wetLevel = preset.reverb / 100;
    if (reverbDryGain) reverbDryGain.gain.value = 1 - wetLevel;
    if (reverbWetGain) reverbWetGain.gain.value = wetLevel * 0.6;
    if (convolverNode) createReverbImpulse(2, Math.max(0.001, preset.reverb / 20));

    if (preset.eightD && !eightDEnabled)  eightDToggle.click();
    else if (!preset.eightD && eightDEnabled) eightDToggle.click();

    if (audioBuffer) {
        if (isPlaying) {
            const savedSource = getCurrentSourceTime();
            pauseWithoutReset();
            currentPlaybackRate = getPlaybackRate();
            pauseTime = savedSource;
            play();
        } else {
            currentPlaybackRate = getPlaybackRate();
            syncProgressUI();
        }
    }
}

// ====================================
// BUTTON CONTROLS
// ====================================

playBtn.addEventListener('click', play);
stopBtn.addEventListener('click', stop);
resetBtn.addEventListener('click', () => applyPreset(presets.normal));

// ====================================
// DOWNLOAD
// ====================================

downloadBtn.addEventListener('click', async () => {
    if (!audioBuffer) { alert('Please load an audio file first'); return; }

    try {
        downloadBtn.querySelector('span').textContent = 'Processing...';
        downloadBtn.disabled = true;

        const pitchShift = parseFloat(document.getElementById('pitchSlider').value);
        const speed      = parseFloat(document.getElementById('speedSlider').value);
        const pitchRatio = Math.pow(2, pitchShift / 12);
        const finalPlaybackRate = speed * pitchRatio;
        const newDuration = audioBuffer.duration / finalPlaybackRate;
        const newLength   = Math.ceil(newDuration * audioContext.sampleRate);

        const offlineCtx    = new OfflineAudioContext(audioBuffer.numberOfChannels, newLength, audioContext.sampleRate);
        const offlineSource = offlineCtx.createBufferSource();
        offlineSource.buffer = audioBuffer;
        offlineSource.playbackRate.value = finalPlaybackRate;

        const offlinePreGain = offlineCtx.createGain();
        offlinePreGain.gain.value = dbToGain(parseFloat(document.getElementById('preGainSlider').value));

        const offlineBass = offlineCtx.createBiquadFilter();
        offlineBass.type = 'lowshelf'; offlineBass.frequency.value = 200;
        offlineBass.gain.value = parseFloat(document.getElementById('bassSlider').value);

        const offlineMid = offlineCtx.createBiquadFilter();
        offlineMid.type = 'peaking'; offlineMid.frequency.value = 1000; offlineMid.Q.value = 0.8;
        offlineMid.gain.value = 0;

        const offlineTreble = offlineCtx.createBiquadFilter();
        offlineTreble.type = 'highshelf'; offlineTreble.frequency.value = 3000;
        offlineTreble.gain.value = parseFloat(document.getElementById('trebleSlider').value);

        const offlinePan = offlineCtx.createStereoPanner ? offlineCtx.createStereoPanner() : null;
        if (offlinePan) offlinePan.pan.value = eightDEnabled ? 0 : parseFloat(document.getElementById('panSlider').value) / 100;

        const offlineGain = offlineCtx.createGain();
        offlineGain.gain.value = parseFloat(document.getElementById('volumeSlider').value) / 100;

        const offlineDelay = offlineCtx.createDelay(5.0);
        offlineDelay.delayTime.value = 0.3;
        const offlineDelayGain = offlineCtx.createGain();
        const echoValue = parseFloat(document.getElementById('echoSlider').value);
        offlineDelayGain.gain.value = Math.min(0.55, echoValue / 100 * 0.5);

        const offlineConvolver  = offlineCtx.createConvolver();
        const offlineReverbDry  = offlineCtx.createGain();
        const offlineReverbWet  = offlineCtx.createGain();
        const reverbValue       = parseFloat(document.getElementById('reverbSlider').value) / 100;
        offlineReverbDry.gain.value = 1 - reverbValue;
        offlineReverbWet.gain.value = reverbValue * 0.6;
        const reverbLength = offlineCtx.sampleRate * 2;
        const reverbImpulse = offlineCtx.createBuffer(2, reverbLength, offlineCtx.sampleRate);
        const decayVal = Math.max(0.001, reverbValue * 20);
        for (let ch = 0; ch < 2; ch++) {
            const d = reverbImpulse.getChannelData(ch);
            for (let i = 0; i < reverbLength; i++)
                d[i] = (Math.random() * 2 - 1) * Math.pow((reverbLength - i) / reverbLength, decayVal);
        }
        offlineConvolver.buffer = reverbImpulse;

        const offlineCompressor = offlineCtx.createDynamicsCompressor();
        offlineCompressor.threshold.value = -3; offlineCompressor.knee.value = 6;
        offlineCompressor.ratio.value = 12;     offlineCompressor.attack.value = 0.003;
        offlineCompressor.release.value = 0.25;

        const offlineOutputGain = offlineCtx.createGain();
        offlineOutputGain.gain.value = dbToGain(parseFloat(document.getElementById('outputGainSlider').value));

        offlineSource.connect(offlinePreGain);
        offlinePreGain.connect(offlineBass);
        offlineBass.connect(offlineMid);
        offlineMid.connect(offlineTreble);
        let cn = offlineTreble;
        if (offlinePan) { cn.connect(offlinePan); cn = offlinePan; }
        cn.connect(offlineGain);
        if (echoValue > 0) {
            offlineGain.connect(offlineDelay);
            offlineDelay.connect(offlineDelayGain);
            offlineDelayGain.connect(offlineDelay);
            offlineDelayGain.connect(offlineGain);
        }
        const offlineMerger = offlineCtx.createGain();
        offlineGain.connect(offlineReverbDry); offlineReverbDry.connect(offlineMerger);
        if (reverbValue > 0) {
            offlineGain.connect(offlineConvolver);
            offlineConvolver.connect(offlineReverbWet);
            offlineReverbWet.connect(offlineMerger);
        }
        offlineMerger.connect(offlineCompressor);
        offlineCompressor.connect(offlineOutputGain);
        offlineOutputGain.connect(offlineCtx.destination);

        offlineSource.start();
        let renderedBuffer = await offlineCtx.startRendering();

        let maxPeak = 0;
        for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
            const d = renderedBuffer.getChannelData(ch);
            for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > maxPeak) maxPeak = Math.abs(d[i]);
        }
        const normGain = maxPeak > 0.05 ? (0.944 / maxPeak) : 1;
        if (normGain < 1.5) {
            for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
                const d = renderedBuffer.getChannelData(ch);
                for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * normGain));
            }
        }

        const wav  = audioBufferToWav(renderedBuffer);
        const blob = new Blob([wav], { type: 'audio/wav' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        const effects = [];
        if (speed !== 1.0) effects.push(speed + 'x');
        if (pitchShift !== 0) effects.push((pitchShift > 0 ? '+' : '') + pitchShift + 'st');
        if (parseFloat(document.getElementById('bassSlider').value) > 0)   effects.push('bass');
        if (parseFloat(document.getElementById('reverbSlider').value) > 0)  effects.push('reverb');
        if (parseFloat(document.getElementById('echoSlider').value) > 0)    effects.push('echo');
        a.download = 'edited_' + currentFileName.replace(/\.[^/.]+$/, '') + (effects.length ? '_' + effects.join('_') : '') + '.wav';
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error exporting audio:', error);
        alert('Failed to export audio: ' + error.message);
    } finally {
        downloadBtn.querySelector('span').textContent = 'Export';
        downloadBtn.disabled = false;
    }
});

// ====================================
// AUDIO BUFFER TO WAV
// ====================================

function audioBufferToWav(buffer) {
    const numberOfChannels = buffer.numberOfChannels;
    const length = buffer.length * numberOfChannels * 2;
    const arrayBuffer = new ArrayBuffer(44 + length);
    const view = new DataView(arrayBuffer);
    writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + length, true);
    writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true); view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * numberOfChannels * 2, true);
    view.setUint16(32, numberOfChannels * 2, true); view.setUint16(34, 16, true);
    writeString(view, 36, 'data'); view.setUint32(40, length, true);
    const channels = [];
    for (let i = 0; i < numberOfChannels; i++) channels.push(buffer.getChannelData(i));
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let ch = 0; ch < numberOfChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch][i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }
    return arrayBuffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
}

// ====================================
// UTILITY
// ====================================

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
}
function dbToGain(db) { return Math.pow(10, db / 20); }
function gainToDb(gain) { return 20 * Math.log10(Math.max(gain, 0.00001)); }

// ====================================
// RESPONSIVE CANVAS
// ====================================

window.addEventListener('resize', () => { if (audioBuffer) drawWaveform(); });
waveformCanvas.width  = waveformCanvas.offsetWidth  * 2;
waveformCanvas.height = waveformCanvas.offsetHeight * 2;

// ====================================
// KEYBOARD SHORTCUTS
// ====================================

document.addEventListener('keydown', (e) => {
    if (!audioBuffer) return;
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    switch (e.key.toLowerCase()) {
        case ' ': case 'k': e.preventDefault(); play(); break;
        case 'arrowleft':  e.preventDefault(); seekRelative(-5);  break;
        case 'arrowright': e.preventDefault(); seekRelative(5);   break;
        case 'j':          e.preventDefault(); seekRelative(-10); break;
        case 'l':          e.preventDefault(); seekRelative(10);  break;
        case 'home':       e.preventDefault(); seekTo(0); break;
        case 'end':        e.preventDefault(); seekTo(audioBuffer.duration); break;
        case 'arrowup':    e.preventDefault(); changeVolume(5);  break;
        case 'arrowdown':  e.preventDefault(); changeVolume(-5); break;
        case 'm':          e.preventDefault(); toggleMute(); break;
    }
});

function seekRelative(seconds) {
    if (!audioBuffer) return;
    const newTime = Math.max(0, Math.min(audioBuffer.duration, getCurrentSourceTime() + seconds));
    const wasPlaying = isPlaying;
    if (isPlaying) pauseWithoutReset();
    pauseTime = newTime;
    syncProgressUI(pauseTime);
    if (wasPlaying) play();
}

function seekTo(time) {
    if (!audioBuffer) return;
    const newTime = Math.max(0, Math.min(audioBuffer.duration, time));
    const wasPlaying = isPlaying;
    if (isPlaying) pauseWithoutReset();
    pauseTime = newTime;
    syncProgressUI(pauseTime);
    if (wasPlaying) play();
}

let previousVolume = 100;
let isMuted = false;

function changeVolume(delta) {
    const slider = document.getElementById('volumeSlider');
    const newVol = Math.max(0, Math.min(150, parseFloat(slider.value) + delta));
    slider.value = newVol;
    document.getElementById('volumeValue').textContent = newVol.toFixed(1) + '%';
    if (gainNode) gainNode.gain.value = newVol / 100;
}

function toggleMute() {
    const slider = document.getElementById('volumeSlider');
    if (isMuted) {
        slider.value = previousVolume;
        document.getElementById('volumeValue').textContent = previousVolume.toFixed(1) + '%';
        if (gainNode) gainNode.gain.value = previousVolume / 100;
        isMuted = false;
    } else {
        previousVolume = parseFloat(slider.value);
        slider.value = 0;
        document.getElementById('volumeValue').textContent = '0% (Muted)';
        if (gainNode) gainNode.gain.value = 0;
        isMuted = true;
    }
}

console.log('🎵 Audio Editor — progress bar seek-on-mousedown ✅');
