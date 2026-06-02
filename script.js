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
let meterInterval;
let eightDAudioInterval;
let eightDEnabled = false;
let spatialEnabled = false;
let limiterEnabled = true;
let pannerNode;
let currentFileName = '';
let clipCount = 0;
let peakHold = 0;
let peakHoldTime = 0;
let spatial3DInterval;
let spatial3DAngle = 0;

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
const currentTimeEl = document.getElementById('currentTime');
const totalTimeEl = document.getElementById('totalTime');
const fileNameEl = document.getElementById('fileName');
const waveformCanvas = document.getElementById('waveform');
const waveformCtx = waveformCanvas.getContext('2d');

// Play/Pause icon helpers (SVG-based, no emoji)
const playIcon  = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');

function showPlayIcon()  { playIcon.style.display = ''; pauseIcon.style.display = 'none'; }
function showPauseIcon() { playIcon.style.display = 'none'; pauseIcon.style.display = ''; }

// ✅ Calcula duração ajustada baseada em speed e pitch
function getAdjustedDuration() {
    if (!audioBuffer) return 0;
    const pitchShift = parseFloat(document.getElementById('pitchSlider').value);
    const speed = parseFloat(document.getElementById('speedSlider').value);
    const pitchRatio = Math.pow(2, pitchShift / 12);
    const finalPlaybackRate = speed * pitchRatio;
    return audioBuffer.duration / finalPlaybackRate;
}

function updateTotalTimeDisplay() {
    if (!audioBuffer) return;
    totalTimeEl.textContent = formatTime(getAdjustedDuration());
}

// Parar SEM resetar posição
function pauseWithoutReset() {
    if (sourceNode) {
        sourceNode.stop();
        sourceNode.disconnect();
    }
    isPlaying = false;
    showPlayIcon();
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ====================================
// FILE UPLOAD HANDLING
// ====================================

uploadSection.addEventListener('click', () => {
    fileInput.click();
});

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
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Show all sections that require audio (player-section class)
        document.querySelectorAll('.player-section').forEach(el => {
            el.classList.add('active');
        });

        initializeAudioNodes();
        drawWaveform();
        updateTotalTimeDisplay();

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

    trebleFilter = audioContext.createBiquadFilter();
    trebleFilter.type = 'highshelf';
    trebleFilter.frequency.value = 3000;
    trebleFilter.gain.value = 0;

    panNode = audioContext.createStereoPanner ?
        audioContext.createStereoPanner() : null;

    pannerNode = audioContext.createPanner();
    pannerNode.panningModel = 'HRTF';
    pannerNode.distanceModel = 'inverse';
    pannerNode.refDistance = 1;
    pannerNode.maxDistance = 10000;
    pannerNode.rolloffFactor = 1;
    pannerNode.coneInnerAngle = 360;
    pannerNode.coneOuterAngle = 0;
    pannerNode.coneOuterGain = 0;
    pannerNode.setPosition(0, 0, -1);

    if (audioContext.listener.forwardX) {
        audioContext.listener.forwardX.value = 0;
        audioContext.listener.forwardY.value = 0;
        audioContext.listener.forwardZ.value = -1;
        audioContext.listener.upX.value = 0;
        audioContext.listener.upY.value = 1;
        audioContext.listener.upZ.value = 0;
    } else if (audioContext.listener.setOrientation) {
        audioContext.listener.setOrientation(0, 0, -1, 0, 1, 0);
    }

    if (audioContext.listener.positionX) {
        audioContext.listener.positionX.value = 0;
        audioContext.listener.positionY.value = 0;
        audioContext.listener.positionZ.value = 0;
    } else if (audioContext.listener.setPosition) {
        audioContext.listener.setPosition(0, 0, 0);
    }

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
    const length = rate * duration;
    const impulse = audioContext.createBuffer(2, length, rate);
    const impulseL = impulse.getChannelData(0);
    const impulseR = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
        const n = length - i;
        impulseL[i] = (Math.random() * 2 - 1) * Math.pow(n / length, decay);
        impulseR[i] = (Math.random() * 2 - 1) * Math.pow(n / length, decay);
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

    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;

    connectAudioGraph();

    const offset = pauseTime;
    sourceNode.start(0, offset);
    startTime = audioContext.currentTime - offset;
    isPlaying = true;

    showPauseIcon();

    sourceNode.onended = () => {
        if (isPlaying) stop();
    };

    visualize();
    updateProgress();
    startLevelMeter();
}

function pause() {
    if (!isPlaying) return;
    pauseTime = audioContext.currentTime - startTime;
    sourceNode.stop();
    isPlaying = false;
    showPlayIcon();
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

function stop() {
    if (sourceNode) {
        try { sourceNode.stop(); } catch(e) {}
        sourceNode.disconnect();
    }
    isPlaying = false;
    pauseTime = 0;
    startTime = 0;
    showPlayIcon();
    progressFill.style.width = '0%';
    currentTimeEl.textContent = '0:00';
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ====================================
// AUDIO GRAPH CONNECTION
// ====================================

function connectAudioGraph() {
    let currentNode = sourceNode;

    currentNode.connect(preGainNode);
    currentNode = preGainNode;

    const pitchShift = parseFloat(document.getElementById('pitchSlider').value);
    const speedControl = parseFloat(document.getElementById('speedSlider').value);
    const pitchRatio = Math.pow(2, pitchShift / 12);
    sourceNode.playbackRate.value = speedControl * pitchRatio;

    currentNode.connect(bassFilter);
    bassFilter.connect(trebleFilter);
    currentNode = trebleFilter;

    if (spatialEnabled) {
        currentNode.connect(pannerNode);
        currentNode = pannerNode;
    } else if (panNode) {
        currentNode.connect(panNode);
        currentNode = panNode;
    }

    currentNode.connect(gainNode);

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
    currentNode = merger;

    if (limiterEnabled) {
        currentNode.connect(compressorNode);
        currentNode = compressorNode;
    }

    currentNode.connect(outputGainNode);
    outputGainNode.connect(analyser);
    analyser.connect(audioContext.destination);
}

// ====================================
// LEVEL METERING
// ====================================

function startLevelMeter() {
    const meterFill = document.getElementById('meterFill');
    const meterPeak = document.getElementById('meterPeak');
    const clipIndicator = document.getElementById('clipIndicator');
    const peakValueEl = document.getElementById('peakValue');
    const rmsValueEl = document.getElementById('rmsValue');

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);

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
        if(meterFill) meterFill.style.width = rmsPercent + '%';
        if(rmsValueEl) rmsValueEl.textContent = rmsDb.toFixed(1) + ' dB';
        if (peak > peakHold) { peakHold = peak; peakHoldTime = Date.now(); }
        if (Date.now() - peakHoldTime > 1000) peakHold *= 0.95;
        const peakPercent = Math.max(0, Math.min(100, ((gainToDb(peakHold) + 60) / 60) * 100));
        if(meterPeak) meterPeak.style.left = peakPercent + '%';
        if(peakValueEl) peakValueEl.textContent = gainToDb(peakHold).toFixed(1) + ' dB';
        if (peakDb > -1) {
            if(clipIndicator) clipIndicator.classList.add('active');
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
            if(clipIndicator) clipIndicator.classList.remove('active');
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
    if(mf) mf.style.width = '0%';
    if(mp) mp.style.left = '0%';
    if(pv) pv.textContent = '-∞ dB';
    if(rv) rv.textContent = '-∞ dB';
    if(ci) ci.classList.remove('active');
}

// ====================================
// WAVEFORM VISUALIZATION
// ====================================

function drawWaveform() {
    const width = waveformCanvas.width = waveformCanvas.offsetWidth * 2;
    const height = waveformCanvas.height = waveformCanvas.offsetHeight * 2;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

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
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

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
// PROGRESS BAR
// ====================================

let isDragging = false;
let wasPausedBeforeDrag = false;

function updateProgress() {
    if (!isPlaying || isDragging) return;
    const currentTime = audioContext.currentTime - startTime;
    const duration = audioBuffer.duration;
    const progress = (currentTime / duration) * 100;
    progressFill.style.width = progress + '%';
    currentTimeEl.textContent = formatTime(currentTime);
    if (currentTime < duration) setTimeout(updateProgress, 100);
}

progressBar.addEventListener('mousedown', startDragging);
progressBar.addEventListener('touchstart', startDragging);
document.addEventListener('mousemove', (e) => { if (isDragging) updateSeekPosition(e.clientX); });
document.addEventListener('touchmove', (e) => { if (isDragging) updateSeekPosition(e.touches[0].clientX); });
document.addEventListener('mouseup', stopDragging);
document.addEventListener('touchend', stopDragging);

function startDragging(e) {
    if (!audioBuffer) return;
    isDragging = true;
    wasPausedBeforeDrag = !isPlaying;
    if (isPlaying) { sourceNode.stop(); isPlaying = false; }
    progressBar.style.cursor = 'grabbing';
}

function updateSeekPosition(clientX) {
    if (!audioBuffer || !isDragging) return;
    const rect = progressBar.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = percentage * audioBuffer.duration;
    progressFill.style.width = (percentage * 100) + '%';
    currentTimeEl.textContent = formatTime(newTime);
    pauseTime = newTime;
}

function stopDragging() {
    if (!isDragging) return;
    isDragging = false;
    progressBar.style.cursor = 'pointer';
    if (!wasPausedBeforeDrag) play();
}

progressBar.addEventListener('click', (e) => {
    if (!audioBuffer || isDragging) return;
    const rect = progressBar.getBoundingClientRect();
    const percentage = (e.clientX - rect.left) / rect.width;
    const newTime = percentage * audioBuffer.duration;
    const wasPlaying = isPlaying;
    if (isPlaying && sourceNode) {
        sourceNode.stop();
        sourceNode.disconnect();
        isPlaying = false;
        cancelAnimationFrame(animationId);
        stopLevelMeter();
    }
    pauseTime = newTime;
    progressFill.style.width = (percentage * 100) + '%';
    currentTimeEl.textContent = formatTime(newTime);
    if (wasPlaying) play();
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
    updateTotalTimeDisplay();
    if (isPlaying && sourceNode) {
        const pitchShift = parseFloat(document.getElementById('pitchSlider').value);
        sourceNode.playbackRate.value = value * Math.pow(2, pitchShift / 12);
    }
});

document.getElementById('pitchSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('pitchValue').textContent = value.toFixed(1) + ' semitones';
    updateTotalTimeDisplay();
    if (isPlaying && sourceNode) {
        const speedControl = parseFloat(document.getElementById('speedSlider').value);
        sourceNode.playbackRate.value = speedControl * Math.pow(2, value / 12);
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
    if (bassFilter) {
        bassFilter.gain.value = Math.min(value, 15);
        if (value > 10) {
            const compensation = -Math.min(6, (value - 10) * 0.5);
            const currentPreGain = parseFloat(document.getElementById('preGainSlider').value);
            const newPreGain = Math.max(-24, currentPreGain + compensation);
            document.getElementById('preGainSlider').value = newPreGain;
            document.getElementById('preGainValue').textContent = newPreGain.toFixed(1) + ' dB';
            preGainNode.gain.value = dbToGain(newPreGain);
        }
    }
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
    if (panNode && !spatialEnabled && !eightDEnabled) panNode.pan.value = value / 100;
});

document.getElementById('reverbSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('reverbValue').textContent = value.toFixed(1) + '%';
    const wetLevel = value / 100;
    if (reverbDryGain) reverbDryGain.gain.value = 1 - wetLevel;
    if (reverbWetGain) reverbWetGain.gain.value = wetLevel * 0.6;
    createReverbImpulse(2, value / 20);
});

document.getElementById('echoSlider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('echoValue').textContent = value.toFixed(1) + '%';
    if (delayGain) delayGain.gain.value = Math.min(0.6, value / 100 * 0.5);
});

document.getElementById('spatial3DSpeed').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    document.getElementById('spatial3DSpeedValue').textContent = value.toFixed(1) + 'x';
    if (spatialEnabled) { stop3DSpatialAudio(); start3DSpatialAudio(); }
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

const spatialToggle = document.getElementById('spatialToggle');
spatialToggle.addEventListener('click', () => {
    spatialEnabled = !spatialEnabled;
    spatialToggle.classList.toggle('active');
    spatialToggle.setAttribute('aria-checked', spatialEnabled);
    if (spatialEnabled) start3DSpatialAudio(); else stop3DSpatialAudio();
});

// ====================================
// 3D SPATIAL AUDIO
// ====================================

function start3DSpatialAudio() {
    if (!pannerNode) return;
    spatial3DAngle = 0;
    const speed = parseFloat(document.getElementById('spatial3DSpeed').value);
    spatial3DInterval = setInterval(() => {
        spatial3DAngle += 0.02 * speed;
        const radius = 5;
        const x = Math.sin(spatial3DAngle) * radius;
        const z = Math.cos(spatial3DAngle) * radius;
        const y = Math.sin(spatial3DAngle * 0.5) * 2;
        if (pannerNode.positionX) {
            pannerNode.positionX.value = x;
            pannerNode.positionY.value = y;
            pannerNode.positionZ.value = z;
        } else if (pannerNode.setPosition) {
            pannerNode.setPosition(x, y, z);
        }
    }, 50);
}

function stop3DSpatialAudio() {
    if (spatial3DInterval) { clearInterval(spatial3DInterval); spatial3DInterval = null; }
    if (pannerNode) {
        if (pannerNode.positionX) { pannerNode.positionX.value = 0; pannerNode.positionY.value = 0; pannerNode.positionZ.value = -1; }
        else if (pannerNode.setPosition) pannerNode.setPosition(0, 0, -1);
    }
}

// ====================================
// 8D AUDIO
// ====================================

function start8DAudio() {
    if (!panNode || spatialEnabled) return;
    const speed = parseFloat(document.getElementById('eightDSpeed').value);
    let angle = 0;
    eightDAudioInterval = setInterval(() => {
        angle += 0.05 * speed;
        panNode.pan.value = Math.sin(angle);
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
    normal:     { speed:1.0, pitch:0,  volume:100, bass:0,  treble:0,  pan:0, reverb:0,  echo:0,  eightD:false, spatial:false, preGain:-9,  outputGain:-1 },
    nightcore:  { speed:1.3, pitch:3,  volume:100, bass:0,  treble:5,  pan:0, reverb:10, echo:0,  eightD:false, spatial:false, preGain:-12, outputGain:-2 },
    deepbass:   { speed:0.9, pitch:-3, volume:110, bass:12, treble:-5, pan:0, reverb:15, echo:5,  eightD:false, spatial:false, preGain:-15, outputGain:-3 },
    '3dsurround':{ speed:1.0, pitch:0, volume:100, bass:5,  treble:3,  pan:0, reverb:30, echo:10, eightD:false, spatial:true,  preGain:-12, outputGain:-2 },
    '8daudio':  { speed:1.0, pitch:0,  volume:100, bass:3,  treble:2,  pan:0, reverb:25, echo:15, eightD:true,  spatial:false, preGain:-12, outputGain:-2 },
    concert:    { speed:1.0, pitch:0,  volume:105, bass:8,  treble:4,  pan:0, reverb:60, echo:20, eightD:false, spatial:false, preGain:-15, outputGain:-3 }
};

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(presets[btn.dataset.preset]));
});

function applyPreset(preset) {
    document.getElementById('speedSlider').value = preset.speed;
    document.getElementById('speedValue').textContent = preset.speed.toFixed(2) + 'x';
    document.getElementById('pitchSlider').value = preset.pitch;
    document.getElementById('pitchValue').textContent = preset.pitch.toFixed(1) + ' semitones';
    document.getElementById('volumeSlider').value = preset.volume;
    document.getElementById('volumeValue').textContent = preset.volume.toFixed(1) + '%';
    document.getElementById('bassSlider').value = preset.bass;
    document.getElementById('bassValue').textContent = preset.bass.toFixed(1) + ' dB';
    document.getElementById('trebleSlider').value = preset.treble;
    document.getElementById('trebleValue').textContent = preset.treble.toFixed(1) + ' dB';
    document.getElementById('panSlider').value = preset.pan;
    document.getElementById('panValue').textContent = 'Center';
    document.getElementById('reverbSlider').value = preset.reverb;
    document.getElementById('reverbValue').textContent = preset.reverb.toFixed(1) + '%';
    document.getElementById('echoSlider').value = preset.echo;
    document.getElementById('echoValue').textContent = preset.echo.toFixed(1) + '%';
    document.getElementById('preGainSlider').value = preset.preGain;
    document.getElementById('preGainValue').textContent = preset.preGain.toFixed(1) + ' dB';
    document.getElementById('outputGainSlider').value = preset.outputGain;
    document.getElementById('outputGainValue').textContent = preset.outputGain.toFixed(1) + ' dB';

    if (gainNode) gainNode.gain.value = preset.volume / 100;
    if (bassFilter) bassFilter.gain.value = preset.bass;
    if (trebleFilter) trebleFilter.gain.value = preset.treble;
    if (panNode) panNode.pan.value = preset.pan / 100;
    if (delayGain) delayGain.gain.value = Math.min(0.6, preset.echo / 100 * 0.5);
    if (preGainNode) preGainNode.gain.value = dbToGain(preset.preGain);
    if (outputGainNode) outputGainNode.gain.value = dbToGain(preset.outputGain);
    const wetLevel = preset.reverb / 100;
    if (reverbDryGain) reverbDryGain.gain.value = 1 - wetLevel;
    if (reverbWetGain) reverbWetGain.gain.value = wetLevel * 0.6;
    createReverbImpulse(2, preset.reverb / 20);

    if (preset.eightD && !eightDEnabled) eightDToggle.click();
    else if (!preset.eightD && eightDEnabled) eightDToggle.click();
    if (preset.spatial && !spatialEnabled) spatialToggle.click();
    else if (!preset.spatial && spatialEnabled) spatialToggle.click();

    updateTotalTimeDisplay();

    if (isPlaying) {
        const currentPos = audioContext.currentTime - startTime;
        stop();
        pauseTime = currentPos;
        play();
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
        const speed = parseFloat(document.getElementById('speedSlider').value);
        const pitchRatio = Math.pow(2, pitchShift / 12);
        const finalPlaybackRate = speed * pitchRatio;
        const newDuration = audioBuffer.duration / finalPlaybackRate;
        const newLength = Math.ceil(newDuration * audioContext.sampleRate);

        const offlineContext = new OfflineAudioContext(audioBuffer.numberOfChannels, newLength, audioContext.sampleRate);
        const offlineSource = offlineContext.createBufferSource();
        offlineSource.buffer = audioBuffer;
        offlineSource.playbackRate.value = finalPlaybackRate;

        const offlinePreGain = offlineContext.createGain();
        offlinePreGain.gain.value = dbToGain(-3);
        const offlineBass = offlineContext.createBiquadFilter();
        offlineBass.type = 'lowshelf'; offlineBass.frequency.value = 200;
        offlineBass.gain.value = parseFloat(document.getElementById('bassSlider').value);
        const offlineTreble = offlineContext.createBiquadFilter();
        offlineTreble.type = 'highshelf'; offlineTreble.frequency.value = 3000;
        offlineTreble.gain.value = parseFloat(document.getElementById('trebleSlider').value);
        let offlinePan = null;
        if (!spatialEnabled && !eightDEnabled) {
            offlinePan = offlineContext.createStereoPanner ? offlineContext.createStereoPanner() : null;
            if (offlinePan) offlinePan.pan.value = parseFloat(document.getElementById('panSlider').value) / 100;
        }
        const offlineGain = offlineContext.createGain();
        offlineGain.gain.value = parseFloat(document.getElementById('volumeSlider').value) / 100;
        const offlineDelay = offlineContext.createDelay(5.0);
        offlineDelay.delayTime.value = 0.3;
        const offlineDelayGain = offlineContext.createGain();
        const echoValue = parseFloat(document.getElementById('echoSlider').value);
        offlineDelayGain.gain.value = Math.min(0.6, echoValue / 100 * 0.5);
        const offlineConvolver = offlineContext.createConvolver();
        const offlineReverbDry = offlineContext.createGain();
        const offlineReverbWet = offlineContext.createGain();
        const reverbValue = parseFloat(document.getElementById('reverbSlider').value) / 100;
        offlineReverbDry.gain.value = 1 - reverbValue;
        offlineReverbWet.gain.value = reverbValue * 0.6;
        const reverbLength = offlineContext.sampleRate * 2;
        const reverbImpulse = offlineContext.createBuffer(2, reverbLength, offlineContext.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = reverbImpulse.getChannelData(ch);
            for (let i = 0; i < reverbLength; i++) d[i] = (Math.random() * 2 - 1) * Math.pow((reverbLength - i) / reverbLength, reverbValue * 20);
        }
        offlineConvolver.buffer = reverbImpulse;
        const offlineCompressor = offlineContext.createDynamicsCompressor();
        offlineCompressor.threshold.value = -3; offlineCompressor.knee.value = 6;
        offlineCompressor.ratio.value = 12; offlineCompressor.attack.value = 0.003; offlineCompressor.release.value = 0.25;
        const offlineOutputGain = offlineContext.createGain();
        offlineOutputGain.gain.value = dbToGain(2);

        let cn = offlineSource;
        cn.connect(offlinePreGain); cn = offlinePreGain;
        cn.connect(offlineBass); offlineBass.connect(offlineTreble); cn = offlineTreble;
        if (offlinePan) { cn.connect(offlinePan); cn = offlinePan; }
        cn.connect(offlineGain);
        if (echoValue > 0) { offlineGain.connect(offlineDelay); offlineDelay.connect(offlineDelayGain); offlineDelayGain.connect(offlineDelay); offlineDelayGain.connect(offlineGain); }
        const offlineMerger = offlineContext.createGain();
        offlineGain.connect(offlineReverbDry); offlineReverbDry.connect(offlineMerger);
        if (reverbValue > 0) { offlineGain.connect(offlineConvolver); offlineConvolver.connect(offlineReverbWet); offlineReverbWet.connect(offlineMerger); }
        offlineMerger.connect(offlineCompressor);
        offlineCompressor.connect(offlineOutputGain);
        offlineOutputGain.connect(offlineContext.destination);

        offlineSource.start();
        let renderedBuffer = await offlineContext.startRendering();

        let maxPeak = 0;
        for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
            const d = renderedBuffer.getChannelData(ch);
            for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > maxPeak) maxPeak = Math.abs(d[i]);
        }
        const normGain = maxPeak > 0 ? 0.95 / maxPeak : 1;
        if (normGain > 1.0) {
            const normBuf = offlineContext.createBuffer(renderedBuffer.numberOfChannels, renderedBuffer.length, renderedBuffer.sampleRate);
            for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
                const inp = renderedBuffer.getChannelData(ch), out = normBuf.getChannelData(ch);
                for (let i = 0; i < inp.length; i++) out[i] = inp[i] * normGain;
            }
            renderedBuffer = normBuf;
        }

        const wav = audioBufferToWav(renderedBuffer);
        const blob = new Blob([wav], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const effects = [];
        if (speed !== 1.0) effects.push(speed + 'x');
        if (pitchShift !== 0) effects.push((pitchShift > 0 ? '+' : '') + pitchShift + 'st');
        if (parseFloat(document.getElementById('bassSlider').value) > 0) effects.push('bass');
        if (parseFloat(document.getElementById('reverbSlider').value) > 0) effects.push('reverb');
        if (parseFloat(document.getElementById('echoSlider').value) > 0) effects.push('echo');
        a.download = 'edited_' + currentFileName.replace(/\.[^/.]+$/, '') + (effects.length ? '_' + effects.join('_') : '') + '.wav';
        a.click();
        URL.revokeObjectURL(url);

        downloadBtn.querySelector('span').textContent = 'Export';
        downloadBtn.disabled = false;
    } catch (error) {
        console.error('Error downloading audio:', error);
        alert('Failed to download audio: ' + error.message);
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
waveformCanvas.width = waveformCanvas.offsetWidth * 2;
waveformCanvas.height = waveformCanvas.offsetHeight * 2;

// ====================================
// KEYBOARD SHORTCUTS
// ====================================

document.addEventListener('keydown', (e) => {
    if (!audioBuffer) return;
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    switch(e.key.toLowerCase()) {
        case ' ': case 'k': e.preventDefault(); play(); break;
        case 'arrowleft':   e.preventDefault(); seekRelative(-5); break;
        case 'arrowright':  e.preventDefault(); seekRelative(5);  break;
        case 'j':           e.preventDefault(); seekRelative(-10); break;
        case 'l':           e.preventDefault(); seekRelative(10);  break;
        case 'home':        e.preventDefault(); seekTo(0); break;
        case 'end':         e.preventDefault(); seekTo(audioBuffer.duration); break;
        case 'arrowup':     e.preventDefault(); changeVolume(5); break;
        case 'arrowdown':   e.preventDefault(); changeVolume(-5); break;
        case 'm':           e.preventDefault(); toggleMute(); break;
    }
});

function seekRelative(seconds) {
    if (!audioBuffer) return;
    const currentPos = isPlaying ? (audioContext.currentTime - startTime) : pauseTime;
    const newTime = Math.max(0, Math.min(audioBuffer.duration, currentPos + seconds));
    const wasPlaying = isPlaying;
    if (isPlaying) pauseWithoutReset();
    pauseTime = newTime;
    progressFill.style.width = ((newTime / audioBuffer.duration) * 100) + '%';
    currentTimeEl.textContent = formatTime(newTime);
    if (wasPlaying) play();
}

function seekTo(time) {
    if (!audioBuffer) return;
    const newTime = Math.max(0, Math.min(audioBuffer.duration, time));
    const wasPlaying = isPlaying;
    if (isPlaying) pauseWithoutReset();
    pauseTime = newTime;
    progressFill.style.width = ((newTime / audioBuffer.duration) * 100) + '%';
    currentTimeEl.textContent = formatTime(newTime);
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

console.log('🎵 Audio Editor — fixed & running ✅');
