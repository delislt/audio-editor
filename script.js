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
let audioContextUnlocked = false;

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

// 🍎 iOS Detection
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if (isIOS) {
    console.log('🍎 iOS device detected - applying iOS-specific audio handling');
}

// 🍎 iOS: Initialize AudioContext on ANY user interaction
async function initAudioContext() {
    if (audioContext && audioContextUnlocked) return true;
    
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('🎵 AudioContext created with state:', audioContext.state);
        }
        
        if (audioContext.state === 'suspended') {
            console.log('🍎 Attempting to resume AudioContext...');
            await audioContext.resume();
        }
        
        // 🍎 iOS: Play silent buffer to unlock audio
        if (isIOS && !audioContextUnlocked) {
            const buffer = audioContext.createBuffer(1, 1, 22050);
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start(0);
            audioContextUnlocked = true;
            console.log('✅ iOS: Audio context unlocked with silent buffer');
        }
        
        console.log('✅ AudioContext ready, state:', audioContext.state);
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize AudioContext:', error);
        return false;
    }
}

// 🍎 iOS: Initialize audio on any user interaction
if (isIOS) {
    const unlockEvents = ['touchstart', 'touchend', 'click'];
    const unlockAudio = () => {
        if (!audioContextUnlocked) {
            console.log('🍎 User interaction detected - unlocking audio...');
            initAudioContext();
        }
    };
    
    unlockEvents.forEach(event => {
        document.body.addEventListener(event, unlockAudio, { once: true });
    });
}

// ✅ NOVA FUNÇÃO: Calcula duração ajustada baseada em speed e pitch
function getAdjustedDuration() {
    if (!audioBuffer) return 0;
    
    const pitchShift = parseFloat(document.getElementById('pitchSlider').value);
    const speed = parseFloat(document.getElementById('speedSlider').value);
    const pitchRatio = Math.pow(2, pitchShift / 12);
    const finalPlaybackRate = speed * pitchRatio;
    
    return audioBuffer.duration / finalPlaybackRate;
}

// ✅ NOVA FUNÇÃO: Atualiza o display do tempo total
function updateTotalTimeDisplay() {
    if (!audioBuffer) return;
    const adjustedDuration = getAdjustedDuration();
    totalTimeEl.textContent = formatTime(adjustedDuration);
}

// 🍎 iOS: Resume AudioContext if suspended
async function resumeAudioContext() {
    if (!audioContext) {
        const success = await initAudioContext();
        if (!success) return false;
    }
    
    if (audioContext.state === 'suspended') {
        console.log('🍎 iOS: Resuming suspended AudioContext...');
        try {
            await audioContext.resume();
            console.log('✅ AudioContext resumed successfully, state:', audioContext.state);
        } catch (error) {
            console.error('❌ Failed to resume AudioContext:', error);
            alert('Failed to resume audio. Please try again.');
            return false;
        }
    }
    return true;
}

// Função auxiliar para parar SEM resetar posição
function pauseWithoutReset() {
    if (sourceNode) {
        try {
            sourceNode.stop();
            sourceNode.disconnect();
        } catch (e) {
            console.warn('Error stopping source:', e);
        }
    }
    
    isPlaying = false;
    playBtn.innerHTML = '▶️ Play';
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ====================================
// FILE UPLOAD HANDLING
// ====================================

uploadSection.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        // 🍎 Initialize audio context first
        await initAudioContext();
        loadAudioFile(file);
    }
});

uploadSection.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadSection.classList.add('drag-over');
});

uploadSection.addEventListener('dragleave', () => {
    uploadSection.classList.remove('drag-over');
});

uploadSection.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadSection.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
        // 🍎 Initialize audio context first
        await initAudioContext();
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
        // 🍎 Ensure AudioContext is initialized
        const success = await initAudioContext();
        if (!success) {
            alert('Failed to initialize audio system. Please try again.');
            return;
        }

        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        document.querySelectorAll('.player-section').forEach(el => {
            el.classList.add('active');
        });

        initializeAudioNodes();
        drawWaveform();
        updateTotalTimeDisplay();

        console.log('✅ Audio loaded successfully');
        
        // 🍎 iOS: Show helpful message
        if (isIOS) {
            console.log('🍎 iOS: Audio ready - click Play to start');
        }
    } catch (error) {
        console.error('Error loading audio:', error);
        alert('Failed to load audio file. Please try another file.');
    }
}

// ====================================
// AUDIO NODES SETUP WITH GAIN STAGING
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
        audioContext.createStereoPanner() : 
        null;

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

async function play() {
    if (!audioBuffer) return;

    if (isPlaying) {
        pause();
        return;
    }

    // 🍎 iOS: CRITICAL - Resume AudioContext before playing
    console.log('🍎 Checking AudioContext state before play:', audioContext?.state);
    const resumed = await resumeAudioContext();
    if (!resumed) {
        alert('Failed to start audio. Please try again.');
        return;
    }
    
    console.log('🍎 AudioContext state after resume:', audioContext.state);

    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;

    connectAudioGraph();

    const offset = pauseTime;
    
    try {
        console.log('🎵 Starting playback at offset:', offset);
        sourceNode.start(0, offset);
        startTime = audioContext.currentTime - offset;
        isPlaying = true;

        playBtn.innerHTML = '⏸️ Pause';
        
        sourceNode.onended = () => {
            if (isPlaying) {
                stop();
            }
        };

        visualize();
        updateProgress();
        startLevelMeter();
        
        console.log('✅ Playback started successfully');
    } catch (error) {
        console.error('❌ Failed to start playback:', error);
        alert('Failed to play audio. Error: ' + error.message + '\n\nPlease try uploading the file again.');
        isPlaying = false;
        playBtn.innerHTML = '▶️ Play';
    }
}

function pause() {
    if (!isPlaying) return;

    pauseTime = audioContext.currentTime - startTime;
    try {
        sourceNode.stop();
    } catch (e) {
        console.warn('Error stopping source:', e);
    }
    isPlaying = false;
    playBtn.innerHTML = '▶️ Play';
    
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

function stop() {
    if (sourceNode) {
        try {
            sourceNode.stop();
            sourceNode.disconnect();
        } catch (e) {
            console.warn('Error stopping source:', e);
        }
    }
    
    isPlaying = false;
    pauseTime = 0;
    startTime = 0;
    playBtn.innerHTML = '▶️ Play';
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
    
    const wetGain = reverbValue;
    const dryGain = 1 - reverbValue;
    
    reverbDryGain.gain.value = dryGain;
    reverbWetGain.gain.value = wetGain * 0.6;

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
// LEVEL METERING & CLIPPING DETECTION
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

        let sumSquares = 0;
        let peak = 0;

        for (let i = 0; i < bufferLength; i++) {
            const sample = Math.abs(dataArray[i]);
            sumSquares += dataArray[i] * dataArray[i];
            if (sample > peak) peak = sample;
        }

        const rms = Math.sqrt(sumSquares / bufferLength);
        const rmsDb = gainToDb(rms);
        const peakDb = gainToDb(peak);

        const rmsPercent = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
        meterFill.style.width = rmsPercent + '%';
        rmsValueEl.textContent = rmsDb.toFixed(1) + ' dB';

        if (peak > peakHold) {
            peakHold = peak;
            peakHoldTime = Date.now();
        }

        if (Date.now() - peakHoldTime > 1000) {
            peakHold *= 0.95;
        }

        const peakPercent = Math.max(0, Math.min(100, ((gainToDb(peakHold) + 60) / 60) * 100));
        meterPeak.style.left = peakPercent + '%';
        peakValueEl.textContent = gainToDb(peakHold).toFixed(1) + ' dB';

        if (peakDb > -1) {
            clipIndicator.classList.add('active');
            clipCount++;
            
            if (clipCount > 5) {
                const currentOutputGain = parseFloat(document.getElementById('outputGainSlider').value);
                const newGain = Math.max(-12, currentOutputGain - 1);
                document.getElementById('outputGainSlider').value = newGain;
                document.getElementById('outputGainValue').textContent = newGain.toFixed(1) + ' dB';
                outputGainNode.gain.value = dbToGain(newGain);
                clipCount = 0;
                console.warn('⚠️ Auto-reducing output gain to prevent clipping');
            }
        } else {
            clipIndicator.classList.remove('active');
            if (clipCount > 0) clipCount--;
        }
    }, 50);
}

function stopLevelMeter() {
    if (meterInterval) {
        clearInterval(meterInterval);
        meterInterval = null;
    }
    
    document.getElementById('meterFill').style.width = '0%';
    document.getElementById('meterPeak').style.left = '0%';
    document.getElementById('peakValue').textContent = '-∞ dB';
    document.getElementById('rmsValue').textContent = '-∞ dB';
    document.getElementById('clipIndicator').classList.remove('active');
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
        let min = 1.0;
        let max = -1.0;

        for (let j = 0; j < step; j++) {
            const datum = data[(i * step) + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }

        const x = i;
        const y1 = (1 + min) * amp;

        if (i === 0) {
            waveformCtx.moveTo(x, y1);
        } else {
            waveformCtx.lineTo(x, y1);
        }
    }

    waveformCtx.stroke();
}

// ====================================
// REAL-TIME VISUALIZATION
// ====================================

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

            if (i === 0) {
                waveformCtx.moveTo(x, y);
            } else {
                waveformCtx.lineTo(x, y);
            }

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

    if (currentTime < duration) {
        setTimeout(updateProgress, 100);
    }
}

progressBar.addEventListener('mousedown', startDragging);
progressBar.addEventListener('touchstart', startDragging);

document.addEventListener('mousemove', (e) => {
    if (isDragging) {
        updateSeekPosition(e.clientX);
    }
});

document.addEventListener('touchmove', (e) => {
    if (isDragging) {
        updateSeekPosition(e.touches[0].clientX);
    }
});

document.addEventListener('mouseup', stopDragging);
document.addEventListener('touchend', stopDragging);

function startDragging(e) {
    if (!audioBuffer) return;
    
    isDragging = true;
    wasPausedBeforeDrag = !isPlaying;
    
    if (isPlaying) {
        try {
            sourceNode.stop();
        } catch (e) {
            console.warn('Error stopping:', e);
        }
        isPlaying = false;
    }
    
    progressBar.style.cursor = 'grabbing';
}

function updateSeekPosition(clientX) {
    if (!audioBuffer || !isDragging) return;
    
    const rect = progressBar.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * audioBuffer.duration;
    
    progressFill.style.width = (percentage * 100) + '%';
    currentTimeEl.textContent = formatTime(newTime);
    pauseTime = newTime;
}

function stopDragging() {
    if (!isDragging) return;
    
    isDragging = false;
    progressBar.style.cursor = 'pointer';
    
    if (!wasPausedBeforeDrag) {
        play();
    }
}

progressBar.addEventListener('click', (e) => {
    if (!audioBuffer || isDragging) return;

    const rect = progressBar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * audioBuffer.duration;

    const wasPlaying = isPlaying;

    if (isPlaying && sourceNode) {
        try {
            sourceNode.stop();
            sourceNode.disconnect();
        } catch (e) {
            console.warn('Error stopping:', e);
        }
        isPlaying = false;
        cancelAnimationFrame(animationId);
        stopLevelMeter();
    }
    
    pauseTime = newTime;
    progressFill.style.width = (percentage * 100) + '%';
    currentTimeEl.textContent = formatTime(newTime);
    
    if (wasPlaying) {
        play();
    }
});

// ====================================
// CONTROL SLIDERS - Continues from previous file
// ====================================