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

// Placeholder for the remaining code
console.log('🎵 Real-Time Audio Editor v2.4 - Enhanced iOS Safari support 🍎✅');