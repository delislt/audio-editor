// ============================================================
// Audio Editor — script.js
// Pitch shifting via inline Phase Vocoder AudioWorklet.
// Pitch and tempo are fully independent, update live.
// ============================================================

let audioContext;
let audioBuffer;
let sourceNode;
let pitchNode   = null;  // AudioWorkletNode (PitchShiftProcessor)
let stReady     = false;
let stLoading   = null;  // Promise while loading
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
let isPlaying        = false;
let startTime        = 0;
let pauseTime        = 0;
let animationId;
let progressRafId;
let meterInterval;
let eightDAudioInterval;
let eightDEnabled    = false;
let limiterEnabled   = true;
let currentFileName  = '';
let clipCount        = 0;
let peakHold         = 0;
let peakHoldTime     = 0;
let currentSpeed     = 1.0;

// DOM
const uploadSection  = document.getElementById('uploadSection');
const fileInput      = document.getElementById('fileInput');
const playBtn        = document.getElementById('playBtn');
const stopBtn        = document.getElementById('stopBtn');
const resetBtn       = document.getElementById('resetBtn');
const downloadBtn    = document.getElementById('downloadBtn');
const progressBar    = document.getElementById('progressBar');
const progressFill   = document.getElementById('progressFill');
const progressThumb  = document.getElementById('progressThumb');
const currentTimeEl  = document.getElementById('currentTime');
const totalTimeEl    = document.getElementById('totalTime');
const fileNameEl     = document.getElementById('fileName');
const waveformCanvas = document.getElementById('waveform');
const waveformCtx    = waveformCanvas.getContext('2d');
const playIcon       = document.getElementById('playIcon');
const pauseIcon      = document.getElementById('pauseIcon');

function showPlayIcon()  { playIcon.style.display = ''; pauseIcon.style.display = 'none'; }
function showPauseIcon() { playIcon.style.display = 'none'; pauseIcon.style.display = ''; }

function getSpeed()   { return parseFloat(document.getElementById('speedSlider').value); }
function getPitchST() { return parseFloat(document.getElementById('pitchSlider').value); }
function pitchSTtoRatio(st) { return Math.pow(2, st / 12); }

function getAdjustedDuration() {
    return audioBuffer ? audioBuffer.duration / getSpeed() : 0;
}

// ── Progress ──────────────────────────────────────────────────────────────────
function syncProgressUI(sourceTime) {
    if (!audioBuffer) return;
    if (sourceTime === undefined) sourceTime = getCurrentSourceTime();
    const ratio = Math.max(0, Math.min(1, sourceTime / audioBuffer.duration));
    const pct   = (ratio * 100).toFixed(4) + '%';
    progressFill.style.width = pct;
    if (progressThumb) progressThumb.style.left = pct;
    const adj = getAdjustedDuration();
    currentTimeEl.textContent = formatTime(ratio * adj);
    totalTimeEl.textContent   = formatTime(adj);
}

function getCurrentSourceTime() {
    if (!audioBuffer) return 0;
    if (isPlaying) {
        const wall = audioContext.currentTime - startTime;
        return Math.min(wall * currentSpeed, audioBuffer.duration);
    }
    return Math.min(pauseTime, audioBuffer.duration);
}

function pauseWithoutReset() {
    if (sourceNode)  { try { sourceNode.stop(); }  catch(e){} sourceNode.disconnect(); }
    if (pitchNode)   { try { pitchNode.disconnect(); } catch(e){} pitchNode = null; }
    isPlaying = false;
    showPlayIcon();
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ====================================
// WORKLET — load local pitch-worklet.js
// ====================================
async function ensureWorklet() {
    if (stReady)   return true;
    if (stLoading) return stLoading;
    stLoading = (async () => {
        try {
            await audioContext.audioWorklet.addModule('./pitch-worklet.js');
            stReady = true;
            console.log('✅ Pitch worklet loaded');
            return true;
        } catch (err) {
            console.warn('⚠️ Pitch worklet failed — using native fallback:', err);
            return false;
        } finally {
            stLoading = null;
        }
    })();
    return stLoading;
}

function createPitchNode(pitchRatio, tempo) {
    try {
        const node = new AudioWorkletNode(audioContext, 'pitch-shift-processor', {
            numberOfInputs: 1, numberOfOutputs: 1,
            outputChannelCount: [1]
        });
        node.parameters.get('pitch').setValueAtTime(pitchRatio, 0);
        node.parameters.get('tempo').setValueAtTime(tempo, 0);
        return node;
    } catch(e) {
        console.warn('createPitchNode failed:', e);
        return null;
    }
}

// ── Live update: poke AudioParams directly, zero interruption ─────────────────
function updateLiveParams(speed, pitchST) {
    currentSpeed = speed;
    const ratio = pitchSTtoRatio(pitchST);

    if (pitchNode) {
        // Update in-flight worklet params
        pitchNode.parameters.get('pitch').setValueAtTime(ratio, audioContext.currentTime);
        pitchNode.parameters.get('tempo').setValueAtTime(speed, audioContext.currentTime);
        // sourceNode runs at 1x — speed is handled by the worklet
        // Re-anchor startTime for progress bar accuracy
        const srcNow = getCurrentSourceTime();
        startTime = audioContext.currentTime - srcNow / speed;
        return;
    }

    // Fallback: native playbackRate (pitch+speed linked, but no gap)
    if (sourceNode) {
        const rate = speed * ratio;
        try { sourceNode.playbackRate.setValueAtTime(rate, audioContext.currentTime); } catch(e){}
        currentSpeed = rate;
        const srcNow = getCurrentSourceTime();
        startTime = audioContext.currentTime - srcNow / currentSpeed;
    }
}

// ====================================
// FILE UPLOAD
// ====================================
uploadSection.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadAudioFile(f); });
uploadSection.addEventListener('dragover',  (e) => { e.preventDefault(); uploadSection.classList.add('drag-over'); });
uploadSection.addEventListener('dragleave', () => uploadSection.classList.remove('drag-over'));
uploadSection.addEventListener('drop', (e) => {
    e.preventDefault(); uploadSection.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('audio/')) loadAudioFile(f);
    else alert('Please upload a valid audio file (MP3, WAV, OGG)');
});

// ====================================
// AUDIO LOADING
// ====================================
async function loadAudioFile(file) {
    currentFileName = file.name;
    fileNameEl.textContent = currentFileName;
    try {
        if (audioContext) { try { await audioContext.close(); } catch(e){} }
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        stReady = false; stLoading = null;

        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        document.querySelectorAll('.player-section').forEach(el => el.classList.add('active'));
        initializeAudioNodes();
        drawWaveform();

        pauseTime = 0; startTime = 0; isPlaying = false;
        showPlayIcon();
        syncProgressUI(0);

        ensureWorklet(); // pre-load in background
        console.log('✅ Audio loaded:', file.name);
    } catch(err) {
        console.error('Error loading audio:', err);
        alert('Failed to load audio file.');
    }
}

// ====================================
// AUDIO NODES
// ====================================
function initializeAudioNodes() {
    preGainNode = audioContext.createGain(); preGainNode.gain.value = dbToGain(-9);
    gainNode    = audioContext.createGain(); gainNode.gain.value = 1.0;

    bassFilter = audioContext.createBiquadFilter();
    bassFilter.type = 'lowshelf'; bassFilter.frequency.value = 200; bassFilter.gain.value = 0;
    midFilter = audioContext.createBiquadFilter();
    midFilter.type = 'peaking'; midFilter.frequency.value = 1000; midFilter.Q.value = 0.8; midFilter.gain.value = 0;
    trebleFilter = audioContext.createBiquadFilter();
    trebleFilter.type = 'highshelf'; trebleFilter.frequency.value = 3000; trebleFilter.gain.value = 0;

    panNode = audioContext.createStereoPanner ? audioContext.createStereoPanner() : null;

    convolverNode = audioContext.createConvolver();
    reverbDryGain = audioContext.createGain(); reverbDryGain.gain.value = 1.0;
    reverbWetGain = audioContext.createGain(); reverbWetGain.gain.value = 0.0;
    createReverbImpulse(2, 0);

    delayNode = audioContext.createDelay(5.0); delayNode.delayTime.value = 0.3;
    delayGain = audioContext.createGain(); delayGain.gain.value = 0;

    compressorNode = audioContext.createDynamicsCompressor();
    compressorNode.threshold.value = -6; compressorNode.knee.value = 0;
    compressorNode.ratio.value = 20; compressorNode.attack.value = 0.003; compressorNode.release.value = 0.1;

    outputGainNode = audioContext.createGain(); outputGainNode.gain.value = dbToGain(-1);
    analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8;
}

function createReverbImpulse(duration, decay) {
    const rate = audioContext.sampleRate;
    const length = Math.max(1, Math.round(rate * duration));
    const impulse = audioContext.createBuffer(2, length, rate);
    const safeDecay = Math.max(0.001, decay);
    for (let ch = 0; ch < 2; ch++) {
        const buf = impulse.getChannelData(ch);
        for (let i = 0; i < length; i++)
            buf[i] = (Math.random() * 2 - 1) * Math.pow((length - i) / length, safeDecay);
    }
    convolverNode.buffer = impulse;
}

// ====================================
// PLAYBACK
// ====================================
async function play() {
    if (!audioBuffer) return;
    if (isPlaying) { pause(); return; }
    if (audioContext.state === 'suspended') audioContext.resume();

    const speed   = getSpeed();
    const pitchST = getPitchST();
    const ratio   = pitchSTtoRatio(pitchST);
    currentSpeed  = speed;

    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    const offset = Math.min(pauseTime, audioBuffer.duration - 0.001);

    const wok = await ensureWorklet();

    if (wok) {
        pitchNode = createPitchNode(ratio, speed);
    }

    if (pitchNode) {
        // sourceNode plays at native rate; worklet handles pitch + tempo
        sourceNode.playbackRate.value = 1.0;
        sourceNode.connect(pitchNode);
        connectAudioGraph(pitchNode);
    } else {
        // Fallback: native (speed+pitch linked)
        sourceNode.playbackRate.value = speed * ratio;
        connectAudioGraph(sourceNode);
    }

    sourceNode.start(0, offset);
    startTime = audioContext.currentTime - offset / currentSpeed;
    isPlaying = true;
    showPauseIcon();

    sourceNode.onended = () => { if (isPlaying) stop(); };
    visualize();
    scheduleProgressUpdate();
    startLevelMeter();
}

function pause() {
    if (!isPlaying) return;
    pauseTime = getCurrentSourceTime();
    pauseWithoutReset();
    showPlayIcon();
}

function stop() {
    if (sourceNode) { try { sourceNode.stop(); } catch(e){} sourceNode.disconnect(); }
    if (pitchNode)  { try { pitchNode.disconnect(); }  catch(e){} pitchNode = null; }
    isPlaying = false; pauseTime = 0; startTime = 0;
    showPlayIcon(); syncProgressUI(0);
    cancelAnimationFrame(progressRafId); cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ====================================
// AUDIO GRAPH
// ====================================
function connectAudioGraph(inputNode) {
    inputNode.connect(preGainNode);
    preGainNode.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    let node = trebleFilter;
    if (panNode) { node.connect(panNode); node = panNode; }
    node.connect(gainNode);

    gainNode.connect(delayNode);
    delayNode.connect(delayGain);
    delayGain.connect(delayNode);
    delayGain.connect(gainNode);

    const reverbValue = parseFloat(document.getElementById('reverbSlider').value) / 100;
    reverbDryGain.gain.value = 1 - reverbValue;
    reverbWetGain.gain.value = reverbValue * 0.6;
    const merger = audioContext.createGain();
    gainNode.connect(reverbDryGain); reverbDryGain.connect(merger);
    gainNode.connect(convolverNode); convolverNode.connect(reverbWetGain); reverbWetGain.connect(merger);

    if (limiterEnabled) { merger.connect(compressorNode); compressorNode.connect(outputGainNode); }
    else                { merger.connect(outputGainNode); }
    outputGainNode.connect(analyser);
    analyser.connect(audioContext.destination);
}

// ====================================
// LEVEL METERING
// ====================================
function startLevelMeter() {
    const meterFill     = document.getElementById('meterFill');
    const meterPeak     = document.getElementById('meterPeak');
    const clipIndicator = document.getElementById('clipIndicator');
    const peakValueEl   = document.getElementById('peakValue');
    const rmsValueEl    = document.getElementById('rmsValue');
    const bufLen = analyser.frequencyBinCount;
    const data   = new Float32Array(bufLen);
    meterInterval = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        let sumSq = 0, peak = 0;
        for (let i = 0; i < bufLen; i++) {
            const s = Math.abs(data[i]); sumSq += data[i]*data[i]; if (s > peak) peak = s;
        }
        const rmsDb  = gainToDb(Math.sqrt(sumSq / bufLen));
        const peakDb = gainToDb(peak);
        const rmsPct = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
        if (meterFill)   meterFill.style.width  = rmsPct + '%';
        if (rmsValueEl)  rmsValueEl.textContent  = rmsDb.toFixed(1) + ' dB';
        if (peak > peakHold) { peakHold = peak; peakHoldTime = Date.now(); }
        if (Date.now() - peakHoldTime > 1000) peakHold *= 0.95;
        const pkPct = Math.max(0, Math.min(100, ((gainToDb(peakHold) + 60) / 60) * 100));
        if (meterPeak)   meterPeak.style.left    = pkPct + '%';
        if (peakValueEl) peakValueEl.textContent = gainToDb(peakHold).toFixed(1) + ' dB';
        if (peakDb > -1) {
            if (clipIndicator) clipIndicator.classList.add('active');
            clipCount++;
            if (clipCount > 5) {
                const cur = parseFloat(document.getElementById('outputGainSlider').value);
                const ng  = Math.max(-12, cur - 1);
                document.getElementById('outputGainSlider').value = ng;
                document.getElementById('outputGainValue').textContent = ng.toFixed(1) + ' dB';
                outputGainNode.gain.value = dbToGain(ng); clipCount = 0;
            }
        } else {
            if (clipIndicator) clipIndicator.classList.remove('active');
            if (clipCount > 0) clipCount--;
        }
    }, 50);
}

function stopLevelMeter() {
    if (meterInterval) { clearInterval(meterInterval); meterInterval = null; }
    const mf = document.getElementById('meterFill');     if (mf) mf.style.width  = '0%';
    const mp = document.getElementById('meterPeak');     if (mp) mp.style.left   = '0%';
    const pv = document.getElementById('peakValue');     if (pv) pv.textContent  = '-∞ dB';
    const rv = document.getElementById('rmsValue');      if (rv) rv.textContent  = '-∞ dB';
    const ci = document.getElementById('clipIndicator'); if (ci) ci.classList.remove('active');
}

// ====================================
// WAVEFORM
// ====================================
function drawWaveform() {
    const w = waveformCanvas.width  = waveformCanvas.offsetWidth  * 2;
    const h = waveformCanvas.height = waveformCanvas.offsetHeight * 2;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / w), amp = h / 2;
    waveformCtx.fillStyle = 'rgba(15,15,30,1)'; waveformCtx.fillRect(0,0,w,h);
    waveformCtx.beginPath(); waveformCtx.strokeStyle = '#667eea'; waveformCtx.lineWidth = 2;
    for (let i = 0; i < w; i++) {
        let min = 1, max = -1;
        for (let j = 0; j < step; j++) { const d = data[i*step+j]; if(d<min)min=d; if(d>max)max=d; }
        if (i===0) waveformCtx.moveTo(i,(1+min)*amp);
        else       waveformCtx.lineTo(i,(1+min)*amp);
    }
    waveformCtx.stroke();
}

function visualize() {
    const w = waveformCanvas.width, h = waveformCanvas.height;
    const bufLen = analyser.frequencyBinCount, data = new Uint8Array(bufLen);
    function draw() {
        if (!isPlaying) return;
        animationId = requestAnimationFrame(draw);
        analyser.getByteTimeDomainData(data);
        waveformCtx.fillStyle = 'rgba(15,15,30,0.3)'; waveformCtx.fillRect(0,0,w,h);
        waveformCtx.lineWidth = 3; waveformCtx.strokeStyle = '#764ba2'; waveformCtx.beginPath();
        const sw = w / bufLen; let x = 0;
        for (let i = 0; i < bufLen; i++) {
            const y = (data[i]/128.0)*h/2;
            if(i===0) waveformCtx.moveTo(x,y); else waveformCtx.lineTo(x,y);
            x += sw;
        }
        waveformCtx.lineTo(w, h/2); waveformCtx.stroke();
    }
    draw();
}

// ====================================
// PROGRESS BAR
// ====================================
function scheduleProgressUpdate() {
    cancelAnimationFrame(progressRafId);
    if (!isPlaying || isDragging) return;
    syncProgressUI(getCurrentSourceTime());
    if (getCurrentSourceTime() < audioBuffer.duration)
        progressRafId = requestAnimationFrame(scheduleProgressUpdate);
}

let isDragging = false, wasPausedBeforeDrag = false;

function seekToPosition(clientX) {
    if (!audioBuffer) return;
    const rect = progressBar.getBoundingClientRect();
    pauseTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * audioBuffer.duration;
    syncProgressUI(pauseTime);
}

progressBar.addEventListener('mousedown', (e) => {
    if (!audioBuffer) return;
    isDragging = true; wasPausedBeforeDrag = !isPlaying;
    if (isPlaying) pauseWithoutReset();
    seekToPosition(e.clientX); progressBar.style.cursor = 'grabbing';
});
progressBar.addEventListener('touchstart', (e) => {
    if (!audioBuffer) return;
    isDragging = true; wasPausedBeforeDrag = !isPlaying;
    if (isPlaying) pauseWithoutReset();
    seekToPosition(e.touches[0].clientX);
}, { passive: true });
document.addEventListener('mousemove', (e) => { if (isDragging) seekToPosition(e.clientX); });
document.addEventListener('touchmove', (e) => { if (isDragging) seekToPosition(e.touches[0].clientX); }, { passive: true });
document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false; progressBar.style.cursor = 'pointer';
    if (!wasPausedBeforeDrag) play();
});
document.addEventListener('touchend', () => {
    if (!isDragging) return; isDragging = false;
    if (!wasPausedBeforeDrag) play();
});

// ====================================
// SLIDERS
// ====================================
document.getElementById('preGainSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('preGainValue').textContent = v.toFixed(1) + ' dB';
    if (preGainNode) preGainNode.gain.value = dbToGain(v);
});
document.getElementById('outputGainSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('outputGainValue').textContent = v.toFixed(1) + ' dB';
    if (outputGainNode) outputGainNode.gain.value = dbToGain(v); clipCount = 0;
});
const limiterToggle = document.getElementById('limiterToggle');
limiterToggle.addEventListener('click', () => { limiterEnabled = !limiterEnabled; limiterToggle.classList.toggle('active'); });
document.getElementById('limiterThresholdSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('limiterThresholdValue').textContent = v.toFixed(1) + ' dB';
    if (compressorNode) compressorNode.threshold.value = v;
});

document.getElementById('speedSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('speedValue').textContent = v.toFixed(2) + 'x';
    if (isPlaying) updateLiveParams(v, getPitchST());
    else { currentSpeed = v; syncProgressUI(); }
});

document.getElementById('pitchSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('pitchValue').textContent = v.toFixed(1) + ' semitones';
    if (isPlaying) updateLiveParams(getSpeed(), v);
});

document.getElementById('volumeSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('volumeValue').textContent = v.toFixed(1) + '%';
    if (gainNode) gainNode.gain.value = v / 100;
});
document.getElementById('bassSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('bassValue').textContent = v.toFixed(1) + ' dB';
    if (bassFilter) bassFilter.gain.value = Math.min(v, 15);
});
document.getElementById('trebleSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('trebleValue').textContent = v.toFixed(1) + ' dB';
    if (trebleFilter) trebleFilter.gain.value = v;
});
document.getElementById('panSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    const abs = Math.abs(v).toFixed(1);
    document.getElementById('panValue').textContent = v===0?'Center':v<0?abs+'% Left':abs+'% Right';
    if (panNode && !eightDEnabled) panNode.pan.value = v / 100;
});
document.getElementById('reverbSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('reverbValue').textContent = v.toFixed(1) + '%';
    const wet = v/100;
    if (reverbDryGain) reverbDryGain.gain.value = 1 - wet;
    if (reverbWetGain) reverbWetGain.gain.value = wet * 0.6;
    if (convolverNode) createReverbImpulse(2, Math.max(0.001, v/20));
});
document.getElementById('echoSlider').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('echoValue').textContent = v.toFixed(1) + '%';
    if (delayGain) delayGain.gain.value = Math.min(0.55, v/100*0.5);
});

const eightDToggle = document.getElementById('eightDToggle');
eightDToggle.addEventListener('click', () => {
    eightDEnabled = !eightDEnabled;
    eightDToggle.classList.toggle('active');
    eightDToggle.setAttribute('aria-checked', eightDEnabled);
    if (eightDEnabled) start8DAudio(); else stop8DAudio();
});
document.getElementById('eightDSpeed').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    document.getElementById('eightDSpeedValue').textContent = v.toFixed(1);
    if (eightDEnabled) { stop8DAudio(); start8DAudio(); }
});

// ====================================
// 8D AUDIO
// ====================================
function start8DAudio() {
    if (!panNode) return;
    const speed = parseFloat(document.getElementById('eightDSpeed').value);
    let angle = 0;
    eightDAudioInterval = setInterval(() => { angle += 0.05*speed; if(panNode) panNode.pan.value = Math.sin(angle); }, 50);
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
    btn.addEventListener('click', () => { const p = presets[btn.dataset.preset]; if(p) applyPreset(p); });
});

function applyPreset(p) {
    document.getElementById('speedSlider').value  = p.speed;  document.getElementById('speedValue').textContent  = p.speed.toFixed(2)+'x';
    document.getElementById('pitchSlider').value  = p.pitch;  document.getElementById('pitchValue').textContent  = p.pitch.toFixed(1)+' semitones';
    document.getElementById('volumeSlider').value = p.volume; document.getElementById('volumeValue').textContent = p.volume.toFixed(1)+'%';
    document.getElementById('bassSlider').value   = p.bass;   document.getElementById('bassValue').textContent   = p.bass.toFixed(1)+' dB';
    document.getElementById('trebleSlider').value = p.treble; document.getElementById('trebleValue').textContent = p.treble.toFixed(1)+' dB';
    document.getElementById('panSlider').value    = p.pan;    document.getElementById('panValue').textContent    = 'Center';
    document.getElementById('reverbSlider').value = p.reverb; document.getElementById('reverbValue').textContent = p.reverb.toFixed(1)+'%';
    document.getElementById('echoSlider').value   = p.echo;   document.getElementById('echoValue').textContent   = p.echo.toFixed(1)+'%';
    document.getElementById('preGainSlider').value    = p.preGain;    document.getElementById('preGainValue').textContent    = p.preGain.toFixed(1)+' dB';
    document.getElementById('outputGainSlider').value = p.outputGain; document.getElementById('outputGainValue').textContent = p.outputGain.toFixed(1)+' dB';

    if (gainNode)       gainNode.gain.value       = p.volume/100;
    if (bassFilter)     bassFilter.gain.value     = p.bass;
    if (trebleFilter)   trebleFilter.gain.value   = p.treble;
    if (panNode)        panNode.pan.value         = p.pan/100;
    if (delayGain)      delayGain.gain.value      = Math.min(0.55, p.echo/100*0.5);
    if (preGainNode)    preGainNode.gain.value    = dbToGain(p.preGain);
    if (outputGainNode) outputGainNode.gain.value = dbToGain(p.outputGain);
    const wet = p.reverb/100;
    if (reverbDryGain) reverbDryGain.gain.value = 1 - wet;
    if (reverbWetGain) reverbWetGain.gain.value = wet * 0.6;
    if (convolverNode) createReverbImpulse(2, Math.max(0.001, p.reverb/20));

    if (p.eightD && !eightDEnabled)      eightDToggle.click();
    else if (!p.eightD && eightDEnabled) eightDToggle.click();

    currentSpeed = p.speed;
    if (audioBuffer) {
        if (isPlaying) updateLiveParams(p.speed, p.pitch);
        else           syncProgressUI();
    }
}

// ====================================
// BUTTONS
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

        const pitchShift = getPitchST();
        const speed      = getSpeed();
        const finalRate  = speed * pitchSTtoRatio(pitchShift);
        const newLen     = Math.ceil((audioBuffer.duration / finalRate) * audioContext.sampleRate);

        const offCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, newLen, audioContext.sampleRate);
        const offSrc = offCtx.createBufferSource();
        offSrc.buffer = audioBuffer; offSrc.playbackRate.value = finalRate;

        const offPreGain = offCtx.createGain(); offPreGain.gain.value = dbToGain(parseFloat(document.getElementById('preGainSlider').value));
        const offBass    = offCtx.createBiquadFilter(); offBass.type='lowshelf'; offBass.frequency.value=200; offBass.gain.value=parseFloat(document.getElementById('bassSlider').value);
        const offMid     = offCtx.createBiquadFilter(); offMid.type='peaking';  offMid.frequency.value=1000; offMid.Q.value=0.8; offMid.gain.value=0;
        const offTreble  = offCtx.createBiquadFilter(); offTreble.type='highshelf'; offTreble.frequency.value=3000; offTreble.gain.value=parseFloat(document.getElementById('trebleSlider').value);
        const offPan     = offCtx.createStereoPanner ? offCtx.createStereoPanner() : null;
        if (offPan) offPan.pan.value = eightDEnabled ? 0 : parseFloat(document.getElementById('panSlider').value)/100;
        const offGain    = offCtx.createGain(); offGain.gain.value = parseFloat(document.getElementById('volumeSlider').value)/100;
        const offDelay   = offCtx.createDelay(5.0); offDelay.delayTime.value=0.3;
        const offDelayG  = offCtx.createGain(); const echoV = parseFloat(document.getElementById('echoSlider').value); offDelayG.gain.value = Math.min(0.55, echoV/100*0.5);
        const offConv    = offCtx.createConvolver();
        const offDry     = offCtx.createGain(); const offWet = offCtx.createGain();
        const revV       = parseFloat(document.getElementById('reverbSlider').value)/100;
        offDry.gain.value = 1-revV; offWet.gain.value = revV*0.6;
        const rLen = offCtx.sampleRate*2, rBuf = offCtx.createBuffer(2,rLen,offCtx.sampleRate);
        const dv = Math.max(0.001, revV*20);
        for(let ch=0;ch<2;ch++){const d=rBuf.getChannelData(ch);for(let i=0;i<rLen;i++) d[i]=(Math.random()*2-1)*Math.pow((rLen-i)/rLen,dv);} offConv.buffer=rBuf;
        const offComp = offCtx.createDynamicsCompressor(); offComp.threshold.value=-3; offComp.knee.value=6; offComp.ratio.value=12; offComp.attack.value=0.003; offComp.release.value=0.25;
        const offOut  = offCtx.createGain(); offOut.gain.value = dbToGain(parseFloat(document.getElementById('outputGainSlider').value));

        offSrc.connect(offPreGain); offPreGain.connect(offBass); offBass.connect(offMid); offMid.connect(offTreble);
        let cn = offTreble; if(offPan){cn.connect(offPan);cn=offPan;} cn.connect(offGain);
        if(echoV>0){offGain.connect(offDelay);offDelay.connect(offDelayG);offDelayG.connect(offDelay);offDelayG.connect(offGain);}
        const offMerger = offCtx.createGain();
        offGain.connect(offDry); offDry.connect(offMerger);
        if(revV>0){offGain.connect(offConv);offConv.connect(offWet);offWet.connect(offMerger);}
        offMerger.connect(offComp); offComp.connect(offOut); offOut.connect(offCtx.destination);
        offSrc.start();
        let rendered = await offCtx.startRendering();

        let maxPk = 0;
        for(let ch=0;ch<rendered.numberOfChannels;ch++){const d=rendered.getChannelData(ch);for(let i=0;i<d.length;i++) if(Math.abs(d[i])>maxPk)maxPk=Math.abs(d[i]);}
        const ng = maxPk > 0.05 ? (0.944/maxPk) : 1;
        if(ng<1.5){for(let ch=0;ch<rendered.numberOfChannels;ch++){const d=rendered.getChannelData(ch);for(let i=0;i<d.length;i++) d[i]=Math.max(-1,Math.min(1,d[i]*ng));}}

        const wav  = audioBufferToWav(rendered);
        const blob = new Blob([wav],{type:'audio/wav'});
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a'); a.href=url;
        const fx=[];
        if(speed!==1.0)    fx.push(speed+'x');
        if(pitchShift!==0) fx.push((pitchShift>0?'+':'')+pitchShift+'st');
        if(parseFloat(document.getElementById('bassSlider').value)>0)   fx.push('bass');
        if(parseFloat(document.getElementById('reverbSlider').value)>0) fx.push('reverb');
        if(parseFloat(document.getElementById('echoSlider').value)>0)   fx.push('echo');
        a.download='edited_'+currentFileName.replace(/\.[^/.]+$/,'')+(fx.length?'_'+fx.join('_'):'')+'.wav';
        a.click(); URL.revokeObjectURL(url);
    } catch(err) {
        console.error('Export error:',err); alert('Failed to export: '+err.message);
    } finally {
        downloadBtn.querySelector('span').textContent='Export'; downloadBtn.disabled=false;
    }
});

// ====================================
// WAV ENCODER
// ====================================
function audioBufferToWav(buf) {
    const nCh=buf.numberOfChannels,len=buf.length*nCh*2;
    const ab=new ArrayBuffer(44+len); const v=new DataView(ab);
    writeStr(v,0,'RIFF'); v.setUint32(4,36+len,true);
    writeStr(v,8,'WAVE'); writeStr(v,12,'fmt ');
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,nCh,true);
    v.setUint32(24,buf.sampleRate,true); v.setUint32(28,buf.sampleRate*nCh*2,true);
    v.setUint16(32,nCh*2,true); v.setUint16(34,16,true);
    writeStr(v,36,'data'); v.setUint32(40,len,true);
    const chs=[]; for(let i=0;i<nCh;i++) chs.push(buf.getChannelData(i));
    let off=44;
    for(let i=0;i<buf.length;i++) for(let ch=0;ch<nCh;ch++){
        const s=Math.max(-1,Math.min(1,chs[ch][i]));
        v.setInt16(off,s<0?s*0x8000:s*0x7FFF,true); off+=2;
    }
    return ab;
}
function writeStr(view,off,str){for(let i=0;i<str.length;i++) view.setUint8(off+i,str.charCodeAt(i));}

// ====================================
// UTILITIES
// ====================================
function formatTime(s){if(!isFinite(s)||s<0)return'0:00';const m=Math.floor(s/60),sc=Math.floor(s%60);return m+':'+(sc<10?'0':'')+sc;}
function dbToGain(db){return Math.pow(10,db/20);}
function gainToDb(g){return 20*Math.log10(Math.max(g,0.00001));}

window.addEventListener('resize',()=>{if(audioBuffer)drawWaveform();});
waveformCanvas.width  = waveformCanvas.offsetWidth  * 2;
waveformCanvas.height = waveformCanvas.offsetHeight * 2;

// ====================================
// KEYBOARD SHORTCUTS
// ====================================
document.addEventListener('keydown',(e)=>{
    if(!audioBuffer)return;
    if(['input','textarea'].includes(e.target.tagName.toLowerCase()))return;
    switch(e.key.toLowerCase()){
        case ' ':case'k': e.preventDefault();play();break;
        case 'arrowleft':  e.preventDefault();seekRelative(-5);break;
        case 'arrowright': e.preventDefault();seekRelative(5);break;
        case 'j':          e.preventDefault();seekRelative(-10);break;
        case 'l':          e.preventDefault();seekRelative(10);break;
        case 'home':       e.preventDefault();seekTo(0);break;
        case 'end':        e.preventDefault();seekTo(audioBuffer.duration);break;
        case 'arrowup':    e.preventDefault();changeVolume(5);break;
        case 'arrowdown':  e.preventDefault();changeVolume(-5);break;
        case 'm':          e.preventDefault();toggleMute();break;
    }
});

function seekRelative(secs){
    if(!audioBuffer)return;
    const was=isPlaying; if(was)pauseWithoutReset();
    pauseTime=Math.max(0,Math.min(audioBuffer.duration,getCurrentSourceTime()+secs));
    syncProgressUI(pauseTime); if(was)play();
}
function seekTo(t){
    if(!audioBuffer)return;
    const was=isPlaying; if(was)pauseWithoutReset();
    pauseTime=Math.max(0,Math.min(audioBuffer.duration,t));
    syncProgressUI(pauseTime); if(was)play();
}

let previousVolume=100,isMuted=false;
function changeVolume(delta){
    const sl=document.getElementById('volumeSlider');
    const nv=Math.max(0,Math.min(150,parseFloat(sl.value)+delta));
    sl.value=nv; document.getElementById('volumeValue').textContent=nv.toFixed(1)+'%';
    if(gainNode)gainNode.gain.value=nv/100;
}
function toggleMute(){
    const sl=document.getElementById('volumeSlider');
    if(isMuted){
        sl.value=previousVolume; document.getElementById('volumeValue').textContent=previousVolume.toFixed(1)+'%';
        if(gainNode)gainNode.gain.value=previousVolume/100; isMuted=false;
    }else{
        previousVolume=parseFloat(sl.value); sl.value=0;
        document.getElementById('volumeValue').textContent='0% (Muted)';
        if(gainNode)gainNode.gain.value=0; isMuted=true;
    }
}

console.log('🎵 Audio Editor — Phase Vocoder pitch shift ✅');
