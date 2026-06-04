// ============================================================
// Audio Editor — script.js
// Pitch shift: OfflineAudioContext resample (sem worklet)
// Speed: sourceNode.playbackRate
// Completamente independentes, sem artefatos.
// ============================================================

let audioContext;
let audioBuffer;        // buffer original decodificado
let pitchedBuffer;      // buffer com pitch aplicado (resampleado)
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
let mergerNode;
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
let currentPlaybackRate = 1.0;
let pitchBuildPending = false; // evita reconstrução em cascata
let isPitchProcessing = false; // controla o estado de processamento de pitch

// DOM Elements
const uploadSection  = document.getElementById('uploadSection');
const fileInput      = document.getElementById('fileInput');
const playerSection  = document.getElementById('playerSection');
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
const pitchProcessingBanner = document.getElementById('pitchProcessingBanner');
const pitchProcessingInline = document.getElementById('pitchProcessingInline');

function showPlayIcon()  { playIcon.style.display = ''; pauseIcon.style.display = 'none'; }
function showPauseIcon() { playIcon.style.display = 'none'; pauseIcon.style.display = ''; }

// ── Pitch Processing State ────────────────────────────────────────────────────
function setPitchProcessing(active) {
    isPitchProcessing = active;
    // Banner global no topo
    if (pitchProcessingBanner) {
        pitchProcessingBanner.classList.toggle('visible', active);
    }
    // Spinner inline no card de pitch
    if (pitchProcessingInline) {
        pitchProcessingInline.classList.toggle('visible', active);
        pitchProcessingInline.setAttribute('aria-hidden', String(!active));
    }
    // Trava/destrava o botão play
    if (playBtn) {
        playBtn.disabled = active;
        playBtn.classList.toggle('processing', active);
        playBtn.setAttribute('aria-label', active ? 'Processing pitch…' : (isPlaying ? 'Pause' : 'Play'));
    }
    // Trava slider de pitch durante o processamento
    const pitchSlider = document.getElementById('pitchSlider');
    if (pitchSlider) pitchSlider.style.pointerEvents = active ? 'none' : '';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSpeedValue()   { return parseFloat(document.getElementById('speedSlider').value); }
function getPitchSemitones() { return parseFloat(document.getElementById('pitchSlider').value); }
function getPitchRatio()   { return Math.pow(2, getPitchSemitones() / 12); }

// duração ajustada pela VELOCIDADE (pitch não altera duração — ver buildPitchedBuffer)
function getAdjustedDuration() {
    if (!pitchedBuffer) return 0;
    return pitchedBuffer.duration / getSpeedValue();
}

// ── Pitch via resample offline ────────────────────────────────────────────────
// Técnica: toca o buffer original com playbackRate = pitchRatio num OfflineAudioContext
// cujo tamanho é original.length/pitchRatio samples → o resultado tem duração IGUAL
// ao original mas com as frequências transpostas. Sem mexer na velocidade.
async function buildPitchedBuffer() {
    if (!audioBuffer || !audioContext) return;
    const ratio   = getPitchRatio();
    const sr      = audioContext.sampleRate;
    const nCh     = audioBuffer.numberOfChannels;
    // comprimento do buffer de saída = duração original em samples
    const outLen  = Math.ceil(audioBuffer.length / ratio);
    const offCtx  = new OfflineAudioContext(nCh, outLen, sr);
    const src     = offCtx.createBufferSource();
    src.buffer    = audioBuffer;
    src.playbackRate.value = ratio;   // transpõe pitch
    src.connect(offCtx.destination);
    src.start(0);
    pitchedBuffer = await offCtx.startRendering();
}

// ── Progress UI ───────────────────────────────────────────────────────────────
function syncProgressUI(sourceTime) {
    if (!pitchedBuffer) return;
    if (sourceTime === undefined) sourceTime = getCurrentSourceTime();
    const dur   = pitchedBuffer.duration;
    const ratio = dur > 0 ? Math.max(0, Math.min(1, sourceTime / dur)) : 0;
    const pct   = (ratio * 100).toFixed(4) + '%';
    progressFill.style.width = pct;
    if (progressThumb) progressThumb.style.left = pct;
    const adjDur = getAdjustedDuration();
    currentTimeEl.textContent = formatTime(ratio * adjDur);
    totalTimeEl.textContent   = formatTime(adjDur);
}

function getCurrentSourceTime() {
    if (!pitchedBuffer) return 0;
    if (isPlaying) {
        const wall = audioContext.currentTime - startTime;
        return Math.min(wall * currentPlaybackRate, pitchedBuffer.duration);
    }
    return Math.min(pauseTime, pitchedBuffer.duration);
}

// ── Disconnect ────────────────────────────────────────────────────────────────
function disconnectAudioGraph() {
    [
        preGainNode, bassFilter, midFilter, trebleFilter, panNode,
        gainNode, delayNode, delayGain, reverbDryGain, reverbWetGain,
        convolverNode, mergerNode, compressorNode, outputGainNode, analyser,
    ].forEach(n => { if (n) try { n.disconnect(); } catch(e){} });
    mergerNode = null;
}

function pauseWithoutReset() {
    if (sourceNode) { try { sourceNode.stop(); } catch(e){} try { sourceNode.disconnect(); } catch(e){} }
    disconnectAudioGraph();
    isPlaying = false;
    showPlayIcon();
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ====================================
// FILE UPLOAD
// ====================================
uploadSection.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) loadAudioFile(f); });
uploadSection.addEventListener('dragover', e => { e.preventDefault(); uploadSection.classList.add('drag-over'); });
uploadSection.addEventListener('dragleave', () => uploadSection.classList.remove('drag-over'));
uploadSection.addEventListener('drop', e => {
    e.preventDefault(); uploadSection.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('audio/')) loadAudioFile(f);
    else alert('Please upload a valid audio file (MP3, WAV, OGG)');
});

// ====================================
// LOAD AUDIO
// ====================================
async function loadAudioFile(file) {
    currentFileName = file.name;
    fileNameEl.textContent = currentFileName;
    try {
        if (audioContext) try { await audioContext.close(); } catch(e){}
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        // Constrói buffer com pitch inicial (0 semitones = ratio 1 = cópia direta)
        setPitchProcessing(true);
        await buildPitchedBuffer();
        setPitchProcessing(false);
        document.querySelectorAll('.player-section').forEach(el => el.classList.add('active'));
        initializeAudioNodes();
        drawWaveform();
        pauseTime = 0; startTime = 0; isPlaying = false;
        showPlayIcon();
        syncProgressUI(0);
        console.log('✅ Audio loaded');
    } catch (err) {
        setPitchProcessing(false);
        console.error('Error loading audio:', err);
        alert('Failed to load audio file. Please try another file.');
    }
}

// ====================================
// INIT NODES
// ====================================
function initializeAudioNodes() {
    preGainNode = audioContext.createGain();
    preGainNode.gain.value = dbToGain(-9);

    gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    bassFilter = audioContext.createBiquadFilter();
    bassFilter.type = 'lowshelf'; bassFilter.frequency.value = 200; bassFilter.gain.value = 0;

    midFilter = audioContext.createBiquadFilter();
    midFilter.type = 'peaking'; midFilter.frequency.value = 1000; midFilter.Q.value = 0.8; midFilter.gain.value = 0;

    trebleFilter = audioContext.createBiquadFilter();
    trebleFilter.type = 'highshelf'; trebleFilter.frequency.value = 3000; trebleFilter.gain.value = 0;

    panNode = audioContext.createStereoPanner ? audioContext.createStereoPanner() : null;

    convolverNode  = audioContext.createConvolver();
    reverbDryGain  = audioContext.createGain(); reverbDryGain.gain.value  = 1.0;
    reverbWetGain  = audioContext.createGain(); reverbWetGain.gain.value  = 0.0;
    createReverbImpulse(2, 0);

    delayNode = audioContext.createDelay(5.0); delayNode.delayTime.value = 0.3;
    delayGain = audioContext.createGain();     delayGain.gain.value      = 0;

    compressorNode = audioContext.createDynamicsCompressor();
    compressorNode.threshold.value = -6; compressorNode.knee.value    = 0;
    compressorNode.ratio.value     = 20; compressorNode.attack.value  = 0.003;
    compressorNode.release.value   = 0.1;

    outputGainNode = audioContext.createGain();
    outputGainNode.gain.value = dbToGain(-1);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8;

    mergerNode = null;
}

// ====================================
// REVERB
// ====================================
function createReverbImpulse(duration, decay) {
    const rate   = audioContext.sampleRate;
    const length = Math.max(1, Math.round(rate * duration));
    const impulse = audioContext.createBuffer(2, length, rate);
    const safe   = Math.max(0.001, decay);
    for (let ch = 0; ch < 2; ch++) {
        const buf = impulse.getChannelData(ch);
        for (let i = 0; i < length; i++)
            buf[i] = (Math.random() * 2 - 1) * Math.pow((length - i) / length, safe);
    }
    convolverNode.buffer = impulse;
}

// ====================================
// PLAYBACK
// ====================================
function play() {
    if (!pitchedBuffer) return;
    if (isPitchProcessing) return; // bloqueia play durante processamento
    if (isPlaying) { pause(); return; }
    if (audioContext.state === 'suspended') audioContext.resume();

    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = pitchedBuffer;  // buffer já com pitch aplicado

    // Apenas a velocidade no playbackRate — pitch já está no buffer
    currentPlaybackRate = getSpeedValue();
    sourceNode.playbackRate.value = currentPlaybackRate;

    connectAudioGraph();

    const offset = Math.min(pauseTime, pitchedBuffer.duration - 0.001);
    sourceNode.start(0, offset);
    startTime = audioContext.currentTime - (offset / currentPlaybackRate);
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
    try { sourceNode.stop(); } catch(e){}
    disconnectAudioGraph();
    isPlaying = false; showPlayIcon();
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

function stop() {
    if (sourceNode) { try { sourceNode.stop(); } catch(e){} try { sourceNode.disconnect(); } catch(e){} }
    disconnectAudioGraph();
    isPlaying = false; pauseTime = 0; startTime = 0;
    showPlayIcon(); syncProgressUI(0);
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ====================================
// CONNECT GRAPH
// ====================================
function connectAudioGraph() {
    disconnectAudioGraph();
    sourceNode.connect(preGainNode);
    preGainNode.connect(bassFilter);
    bassFilter.connect(midFilter);
    midFilter.connect(trebleFilter);
    let last = trebleFilter;
    if (panNode) { last.connect(panNode); last = panNode; }
    last.connect(gainNode);
    gainNode.connect(delayNode);
    delayNode.connect(delayGain);
    delayGain.connect(delayNode);
    delayGain.connect(gainNode);
    const reverbValue = parseFloat(document.getElementById('reverbSlider').value) / 100;
    reverbDryGain.gain.value = 1 - reverbValue;
    reverbWetGain.gain.value = reverbValue * 0.6;
    mergerNode = audioContext.createGain();
    gainNode.connect(reverbDryGain); reverbDryGain.connect(mergerNode);
    gainNode.connect(convolverNode); convolverNode.connect(reverbWetGain); reverbWetGain.connect(mergerNode);
    if (limiterEnabled) {
        mergerNode.connect(compressorNode); compressorNode.connect(outputGainNode);
    } else {
        mergerNode.connect(outputGainNode);
    }
    outputGainNode.connect(analyser);
    analyser.connect(audioContext.destination);
}

// ====================================
// LEVEL METER
// ====================================
function startLevelMeter() {
    const meterFill     = document.getElementById('meterFill');
    const meterPeak     = document.getElementById('meterPeak');
    const clipIndicator = document.getElementById('clipIndicator');
    const peakValueEl   = document.getElementById('peakValue');
    const rmsValueEl    = document.getElementById('rmsValue');
    const bufLen        = analyser.frequencyBinCount;
    const data          = new Float32Array(bufLen);
    meterInterval = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        let sumSq = 0, peak = 0;
        for (let i = 0; i < bufLen; i++) {
            const s = Math.abs(data[i]); sumSq += data[i] * data[i]; if (s > peak) peak = s;
        }
        const rms = Math.sqrt(sumSq / bufLen);
        const rmsDb  = gainToDb(rms), peakDb = gainToDb(peak);
        const rmsPct = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
        if (meterFill)   meterFill.style.width = rmsPct + '%';
        if (rmsValueEl)  rmsValueEl.textContent = rmsDb.toFixed(1) + ' dB';
        if (peak > peakHold) { peakHold = peak; peakHoldTime = Date.now(); }
        if (Date.now() - peakHoldTime > 1000) peakHold *= 0.95;
        const pkPct = Math.max(0, Math.min(100, ((gainToDb(peakHold) + 60) / 60) * 100));
        if (meterPeak)   meterPeak.style.left = pkPct + '%';
        if (peakValueEl) peakValueEl.textContent = gainToDb(peakHold).toFixed(1) + ' dB';
        if (peakDb > -1) {
            if (clipIndicator) clipIndicator.classList.add('active');
            clipCount++;
            if (clipCount > 5) {
                const cur = parseFloat(document.getElementById('outputGainSlider').value);
                const nv  = Math.max(-12, cur - 1);
                document.getElementById('outputGainSlider').value = nv;
                document.getElementById('outputGainValue').textContent = nv.toFixed(1) + ' dB';
                outputGainNode.gain.value = dbToGain(nv); clipCount = 0;
            }
        } else { if (clipIndicator) clipIndicator.classList.remove('active'); if (clipCount > 0) clipCount--; }
    }, 50);
}

function stopLevelMeter() {
    if (meterInterval) { clearInterval(meterInterval); meterInterval = null; }
    const ids = ['meterFill','meterPeak','peakValue','rmsValue','clipIndicator'];
    const [mf, mp, pv, rv, ci] = ids.map(id => document.getElementById(id));
    if (mf) mf.style.width = '0%'; if (mp) mp.style.left = '0%';
    if (pv) pv.textContent = '-∞ dB'; if (rv) rv.textContent = '-∞ dB';
    if (ci) ci.classList.remove('active');
}

// ====================================
// WAVEFORM
// ====================================
function drawWaveform() {
    const w = waveformCanvas.width  = waveformCanvas.offsetWidth  * 2;
    const h = waveformCanvas.height = waveformCanvas.offsetHeight * 2;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / w), amp = h / 2;
    waveformCtx.fillStyle = 'rgba(15,15,30,1)';
    waveformCtx.fillRect(0, 0, w, h);
    waveformCtx.beginPath();
    waveformCtx.strokeStyle = '#667eea'; waveformCtx.lineWidth = 2;
    for (let i = 0; i < w; i++) {
        let mn = 1, mx = -1;
        for (let j = 0; j < step; j++) { const d = data[i*step+j]; if(d<mn)mn=d; if(d>mx)mx=d; }
        const y = (1 + mn) * amp;
        if (i === 0) waveformCtx.moveTo(i, y); else waveformCtx.lineTo(i, y);
    }
    waveformCtx.stroke();
}

function visualize() {
    const w = waveformCanvas.width, h = waveformCanvas.height;
    const bufLen = analyser.frequencyBinCount;
    const data   = new Uint8Array(bufLen);
    function draw() {
        if (!isPlaying) return;
        animationId = requestAnimationFrame(draw);
        analyser.getByteTimeDomainData(data);
        waveformCtx.fillStyle = 'rgba(15,15,30,0.3)';
        waveformCtx.fillRect(0, 0, w, h);
        waveformCtx.lineWidth = 3; waveformCtx.strokeStyle = '#764ba2';
        waveformCtx.beginPath();
        const sw = w / bufLen; let x = 0;
        for (let i = 0; i < bufLen; i++) {
            const y = (data[i] / 128.0) * h / 2;
            if (i === 0) waveformCtx.moveTo(x, y); else waveformCtx.lineTo(x, y);
            x += sw;
        }
        waveformCtx.lineTo(w, h / 2); waveformCtx.stroke();
    }
    draw();
}

// ====================================
// PROGRESS BAR / SEEK
// ====================================
function scheduleProgressUpdate() {
    cancelAnimationFrame(progressRafId);
    if (!isPlaying || isDragging) return;
    const src = getCurrentSourceTime();
    syncProgressUI(src);
    if (pitchedBuffer && src < pitchedBuffer.duration)
        progressRafId = requestAnimationFrame(scheduleProgressUpdate);
}

let isDragging = false, wasPausedBeforeDrag = false;

function seekToPosition(clientX) {
    if (!pitchedBuffer) return;
    const rect = progressBar.getBoundingClientRect();
    pauseTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * pitchedBuffer.duration;
    syncProgressUI(pauseTime);
}

progressBar.addEventListener('mousedown', e => {
    if (!pitchedBuffer) return;
    isDragging = true; wasPausedBeforeDrag = !isPlaying;
    if (isPlaying) pauseWithoutReset();
    seekToPosition(e.clientX); progressBar.style.cursor = 'grabbing';
});
progressBar.addEventListener('touchstart', e => {
    if (!pitchedBuffer) return;
    isDragging = true; wasPausedBeforeDrag = !isPlaying;
    if (isPlaying) pauseWithoutReset();
    seekToPosition(e.touches[0].clientX);
}, { passive: true });
document.addEventListener('mousemove',  e => { if (isDragging) seekToPosition(e.clientX); });
document.addEventListener('touchmove',  e => { if (isDragging) seekToPosition(e.touches[0].clientX); }, { passive: true });
document.addEventListener('mouseup',    () => { if (!isDragging) return; isDragging = false; progressBar.style.cursor = 'pointer'; if (!wasPausedBeforeDrag) play(); });
document.addEventListener('touchend',   () => { if (!isDragging) return; isDragging = false; if (!wasPausedBeforeDrag) play(); });

// ====================================
// SLIDERS
// ====================================
document.getElementById('preGainSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('preGainValue').textContent = v.toFixed(1) + ' dB';
    if (preGainNode) preGainNode.gain.value = dbToGain(v);
});

document.getElementById('outputGainSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('outputGainValue').textContent = v.toFixed(1) + ' dB';
    if (outputGainNode) outputGainNode.gain.value = dbToGain(v);
    clipCount = 0;
});

const limiterToggle = document.getElementById('limiterToggle');
limiterToggle.addEventListener('click', () => {
    limiterEnabled = !limiterEnabled;
    limiterToggle.classList.toggle('active');
});

document.getElementById('limiterThresholdSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('limiterThresholdValue').textContent = v.toFixed(1) + ' dB';
    if (compressorNode) compressorNode.threshold.value = v;
});

document.getElementById('speedSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('speedValue').textContent = v.toFixed(2) + 'x';
    if (pitchedBuffer) {
        if (isPlaying && sourceNode) {
            const cur = getCurrentSourceTime();
            currentPlaybackRate = getSpeedValue();
            sourceNode.playbackRate.value = currentPlaybackRate;
            startTime = audioContext.currentTime - (cur / currentPlaybackRate);
        } else {
            currentPlaybackRate = getSpeedValue();
        }
        syncProgressUI();
    }
});

// Pitch: rebuild buffer e reinicia a reprodução na mesma posição
let pitchDebounceTimer = null;
document.getElementById('pitchSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('pitchValue').textContent = v.toFixed(1) + ' st';
    // Mostra o spinner inline imediatamente (feedback visual antes do debounce)
    if (pitchProcessingInline) {
        pitchProcessingInline.classList.add('visible');
        pitchProcessingInline.setAttribute('aria-hidden', 'false');
    }
    // Debounce: espera 300ms sem mover o slider para reconstruir
    clearTimeout(pitchDebounceTimer);
    pitchDebounceTimer = setTimeout(async () => {
        if (!audioBuffer) {
            setPitchProcessing(false);
            return;
        }
        const wasPlaying = isPlaying;
        const savedTime  = getCurrentSourceTime();
        if (isPlaying) pauseWithoutReset();
        setPitchProcessing(true);
        await buildPitchedBuffer();
        setPitchProcessing(false);
        pauseTime = savedTime;
        syncProgressUI(savedTime);
        if (wasPlaying) play();
    }, 300);
});

document.getElementById('volumeSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('volumeValue').textContent = v.toFixed(1) + '%';
    if (gainNode) gainNode.gain.value = v / 100;
});

document.getElementById('bassSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('bassValue').textContent = v.toFixed(1) + ' dB';
    if (bassFilter) bassFilter.gain.value = Math.min(v, 15);
});

document.getElementById('trebleSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('trebleValue').textContent = v.toFixed(1) + ' dB';
    if (trebleFilter) trebleFilter.gain.value = v;
});

document.getElementById('panSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    const av = Math.abs(v).toFixed(1);
    document.getElementById('panValue').textContent = v === 0 ? 'Center' : v < 0 ? av + '% Left' : av + '% Right';
    if (panNode && !eightDEnabled) panNode.pan.value = v / 100;
});

document.getElementById('reverbSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('reverbValue').textContent = v.toFixed(1) + '%';
    const wet = v / 100;
    if (reverbDryGain) reverbDryGain.gain.value = 1 - wet;
    if (reverbWetGain) reverbWetGain.gain.value = wet * 0.6;
    if (convolverNode) createReverbImpulse(2, Math.max(0.001, v / 20));
});

document.getElementById('echoSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('echoValue').textContent = v.toFixed(1) + '%';
    if (delayGain) delayGain.gain.value = Math.min(0.55, v / 100 * 0.5);
});

const eightDToggle = document.getElementById('eightDToggle');
eightDToggle.addEventListener('click', () => {
    eightDEnabled = !eightDEnabled;
    eightDToggle.classList.toggle('active');
    eightDToggle.setAttribute('aria-checked', eightDEnabled);
    if (eightDEnabled) start8DAudio(); else stop8DAudio();
});

document.getElementById('eightDSpeed').addEventListener('input', e => {
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
    eightDAudioInterval = setInterval(() => { angle += 0.05 * speed; if (panNode) panNode.pan.value = Math.sin(angle); }, 50);
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
    btn.addEventListener('click', () => { const p = presets[btn.dataset.preset]; if (p) applyPreset(p); });
});

async function applyPreset(p) {
    document.getElementById('speedSlider').value   = p.speed;
    document.getElementById('speedValue').textContent  = p.speed.toFixed(2) + 'x';
    document.getElementById('pitchSlider').value   = p.pitch;
    document.getElementById('pitchValue').textContent  = p.pitch.toFixed(1) + ' st';
    document.getElementById('volumeSlider').value  = p.volume;
    document.getElementById('volumeValue').textContent = p.volume.toFixed(1) + '%';
    document.getElementById('bassSlider').value    = p.bass;
    document.getElementById('bassValue').textContent   = p.bass.toFixed(1) + ' dB';
    document.getElementById('trebleSlider').value  = p.treble;
    document.getElementById('trebleValue').textContent = p.treble.toFixed(1) + ' dB';
    document.getElementById('panSlider').value     = p.pan;
    document.getElementById('panValue').textContent    = 'Center';
    document.getElementById('reverbSlider').value  = p.reverb;
    document.getElementById('reverbValue').textContent = p.reverb.toFixed(1) + '%';
    document.getElementById('echoSlider').value    = p.echo;
    document.getElementById('echoValue').textContent   = p.echo.toFixed(1) + '%';
    document.getElementById('preGainSlider').value     = p.preGain;
    document.getElementById('preGainValue').textContent= p.preGain.toFixed(1) + ' dB';
    document.getElementById('outputGainSlider').value      = p.outputGain;
    document.getElementById('outputGainValue').textContent = p.outputGain.toFixed(1) + ' dB';

    if (gainNode)       gainNode.gain.value       = p.volume / 100;
    if (bassFilter)     bassFilter.gain.value     = p.bass;
    if (trebleFilter)   trebleFilter.gain.value   = p.treble;
    if (panNode)        panNode.pan.value         = p.pan / 100;
    if (delayGain)      delayGain.gain.value      = Math.min(0.55, p.echo / 100 * 0.5);
    if (preGainNode)    preGainNode.gain.value    = dbToGain(p.preGain);
    if (outputGainNode) outputGainNode.gain.value = dbToGain(p.outputGain);
    const wet = p.reverb / 100;
    if (reverbDryGain)  reverbDryGain.gain.value  = 1 - wet;
    if (reverbWetGain)  reverbWetGain.gain.value  = wet * 0.6;
    if (convolverNode)  createReverbImpulse(2, Math.max(0.001, p.reverb / 20));

    if (p.eightD && !eightDEnabled)      eightDToggle.click();
    else if (!p.eightD && eightDEnabled) eightDToggle.click();

    if (audioBuffer) {
        const wasPlaying = isPlaying;
        const savedTime  = getCurrentSourceTime();
        if (isPlaying) pauseWithoutReset();
        setPitchProcessing(true);
        await buildPitchedBuffer();
        setPitchProcessing(false);
        currentPlaybackRate = getSpeedValue();
        pauseTime = savedTime;
        syncProgressUI(savedTime);
        if (wasPlaying) play();
        else syncProgressUI();
    }
}

// ====================================
// BUTTONS
// ====================================
playBtn.addEventListener('click',  play);
stopBtn.addEventListener('click',  stop);
resetBtn.addEventListener('click', () => applyPreset(presets.normal));

// ====================================
// DOWNLOAD / EXPORT
// ====================================
downloadBtn.addEventListener('click', async () => {
    if (!audioBuffer) { alert('Please load an audio file first'); return; }
    try {
        downloadBtn.querySelector('span').textContent = 'Processing...';
        downloadBtn.disabled = true;

        const pitchSemitones = parseFloat(document.getElementById('pitchSlider').value);
        const speed          = parseFloat(document.getElementById('speedSlider').value);
        // Tamanho final = duração_com_pitch / velocidade
        const pitchRatio  = Math.pow(2, pitchSemitones / 12);
        const pitchedLen  = Math.ceil(audioBuffer.length / pitchRatio);
        const finalLen    = Math.ceil(pitchedLen / speed);

        // Passo 1: aplica pitch
        const pitchCtx  = new OfflineAudioContext(audioBuffer.numberOfChannels, pitchedLen, audioContext.sampleRate);
        const pitchSrc  = pitchCtx.createBufferSource();
        pitchSrc.buffer = audioBuffer;
        pitchSrc.playbackRate.value = pitchRatio;
        pitchSrc.connect(pitchCtx.destination);
        pitchSrc.start(0);
        const pitchedOut = await pitchCtx.startRendering();

        // Passo 2: aplica velocidade + efeitos
        const offlineCtx = new OfflineAudioContext(2, finalLen, audioContext.sampleRate);
        const offlineSrc = offlineCtx.createBufferSource();
        offlineSrc.buffer = pitchedOut;
        offlineSrc.playbackRate.value = speed;

        const offlinePreGain = offlineCtx.createGain();
        offlinePreGain.gain.value = dbToGain(parseFloat(document.getElementById('preGainSlider').value));

        const offlineBass = offlineCtx.createBiquadFilter();
        offlineBass.type = 'lowshelf'; offlineBass.frequency.value = 200;
        offlineBass.gain.value = parseFloat(document.getElementById('bassSlider').value);

        const offlineMid = offlineCtx.createBiquadFilter();
        offlineMid.type = 'peaking'; offlineMid.frequency.value = 1000; offlineMid.Q.value = 0.8; offlineMid.gain.value = 0;

        const offlineTreble = offlineCtx.createBiquadFilter();
        offlineTreble.type = 'highshelf'; offlineTreble.frequency.value = 3000;
        offlineTreble.gain.value = parseFloat(document.getElementById('trebleSlider').value);

        const offlinePan = offlineCtx.createStereoPanner ? offlineCtx.createStereoPanner() : null;
        if (offlinePan) offlinePan.pan.value = eightDEnabled ? 0 : parseFloat(document.getElementById('panSlider').value) / 100;

        const offlineGain = offlineCtx.createGain();
        offlineGain.gain.value = parseFloat(document.getElementById('volumeSlider').value) / 100;

        const echoValue = parseFloat(document.getElementById('echoSlider').value);
        const offlineDelay = offlineCtx.createDelay(5.0); offlineDelay.delayTime.value = 0.3;
        const offlineDelayGain = offlineCtx.createGain();
        offlineDelayGain.gain.value = Math.min(0.55, echoValue / 100 * 0.5);

        const offlineConvolver = offlineCtx.createConvolver();
        const offlineRevDry   = offlineCtx.createGain();
        const offlineRevWet   = offlineCtx.createGain();
        const reverbValue     = parseFloat(document.getElementById('reverbSlider').value) / 100;
        offlineRevDry.gain.value = 1 - reverbValue;
        offlineRevWet.gain.value = reverbValue * 0.6;
        const revLen = offlineCtx.sampleRate * 2;
        const revImpulse = offlineCtx.createBuffer(2, revLen, offlineCtx.sampleRate);
        const decayVal = Math.max(0.001, reverbValue * 20);
        for (let ch = 0; ch < 2; ch++) {
            const d = revImpulse.getChannelData(ch);
            for (let i = 0; i < revLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow((revLen - i) / revLen, decayVal);
        }
        offlineConvolver.buffer = revImpulse;

        const offlineComp = offlineCtx.createDynamicsCompressor();
        offlineComp.threshold.value = -3; offlineComp.knee.value = 6;
        offlineComp.ratio.value = 12; offlineComp.attack.value = 0.003; offlineComp.release.value = 0.25;

        const offlineOut = offlineCtx.createGain();
        offlineOut.gain.value = dbToGain(parseFloat(document.getElementById('outputGainSlider').value));

        offlineSrc.connect(offlinePreGain);
        offlinePreGain.connect(offlineBass); offlineBass.connect(offlineMid); offlineMid.connect(offlineTreble);
        let cn = offlineTreble;
        if (offlinePan) { cn.connect(offlinePan); cn = offlinePan; }
        cn.connect(offlineGain);
        if (echoValue > 0) {
            offlineGain.connect(offlineDelay); offlineDelay.connect(offlineDelayGain);
            offlineDelayGain.connect(offlineDelay); offlineDelayGain.connect(offlineGain);
        }
        const offlineMerger = offlineCtx.createGain();
        offlineGain.connect(offlineRevDry); offlineRevDry.connect(offlineMerger);
        if (reverbValue > 0) {
            offlineGain.connect(offlineConvolver); offlineConvolver.connect(offlineRevWet); offlineRevWet.connect(offlineMerger);
        }
        offlineMerger.connect(offlineComp); offlineComp.connect(offlineOut); offlineOut.connect(offlineCtx.destination);
        offlineSrc.start();

        let rendered = await offlineCtx.startRendering();

        // Normalização
        let maxPeak = 0;
        for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
            const d = rendered.getChannelData(ch);
            for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > maxPeak) maxPeak = Math.abs(d[i]);
        }
        const ng = maxPeak > 0.05 ? (0.944 / maxPeak) : 1;
        if (ng < 1.5) {
            for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
                const d = rendered.getChannelData(ch);
                for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * ng));
            }
        }

        const wav  = audioBufferToWav(rendered);
        const blob = new Blob([wav], { type: 'audio/wav' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        const fx = [];
        if (speed !== 1.0) fx.push(speed + 'x');
        if (pitchSemitones !== 0) fx.push((pitchSemitones > 0 ? '+' : '') + pitchSemitones + 'st');
        if (parseFloat(document.getElementById('bassSlider').value)   > 0) fx.push('bass');
        if (parseFloat(document.getElementById('reverbSlider').value) > 0) fx.push('reverb');
        if (parseFloat(document.getElementById('echoSlider').value)   > 0) fx.push('echo');
        a.download = 'edited_' + currentFileName.replace(/\.[^/.]+$/, '') + (fx.length ? '_' + fx.join('_') : '') + '.wav';
        a.click(); URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Export error:', err);
        alert('Failed to export audio: ' + err.message);
    } finally {
        downloadBtn.querySelector('span').textContent = 'Export';
        downloadBtn.disabled = false;
    }
});

// ====================================
// WAV ENCODER
// ====================================
function audioBufferToWav(buffer) {
    const nCh = buffer.numberOfChannels, len = buffer.length * nCh * 2;
    const ab = new ArrayBuffer(44 + len), view = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    ws(0,'RIFF'); view.setUint32(4, 36 + len, true);
    ws(8,'WAVE'); ws(12,'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, nCh, true); view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * nCh * 2, true);
    view.setUint16(32, nCh * 2, true); view.setUint16(34, 16, true);
    ws(36,'data'); view.setUint32(40, len, true);
    const chs = Array.from({length: nCh}, (_, i) => buffer.getChannelData(i));
    let off = 44;
    for (let i = 0; i < buffer.length; i++)
        for (let c = 0; c < nCh; c++) {
            const s = Math.max(-1, Math.min(1, chs[c][i]));
            view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
        }
    return ab;
}

// ====================================
// UTILS
// ====================================
function formatTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
}
function dbToGain(db) { return Math.pow(10, db / 20); }
function gainToDb(g)  { return 20 * Math.log10(Math.max(g, 0.00001)); }

window.addEventListener('resize', () => { if (audioBuffer) drawWaveform(); });
waveformCanvas.width  = waveformCanvas.offsetWidth  * 2;
waveformCanvas.height = waveformCanvas.offsetHeight * 2;

// ====================================
// KEYBOARD SHORTCUTS
// ====================================
document.addEventListener('keydown', e => {
    if (!pitchedBuffer) return;
    if (isPitchProcessing) return; // bloqueia atalhos durante processamento
    const tag  = e.target.tagName.toLowerCase();
    const type = (e.target.type || '').toLowerCase();
    if (tag === 'textarea') return;
    if (tag === 'input' && type !== 'range') return;
    if (tag === 'button' || (tag === 'input' && type === 'range')) e.target.blur();
    switch (e.key) {
        case ' ': case 'k': case 'K': e.preventDefault(); play(); break;
        case 'ArrowLeft':  e.preventDefault(); seekRelative(-5);  break;
        case 'ArrowRight': e.preventDefault(); seekRelative(5);   break;
        case 'j': case 'J': e.preventDefault(); seekRelative(-10); break;
        case 'l': case 'L': e.preventDefault(); seekRelative(10);  break;
        case 'Home': e.preventDefault(); seekTo(0); break;
        case 'End':  e.preventDefault(); seekTo(pitchedBuffer.duration); break;
        case 'ArrowUp':   e.preventDefault(); changeVolume(5);  break;
        case 'ArrowDown': e.preventDefault(); changeVolume(-5); break;
        case 'm': case 'M': e.preventDefault(); toggleMute(); break;
    }
});

function seekRelative(s) {
    if (!pitchedBuffer) return;
    const newTime = Math.max(0, Math.min(pitchedBuffer.duration, getCurrentSourceTime() + s));
    const was = isPlaying;
    if (isPlaying) pauseWithoutReset();
    pauseTime = newTime; syncProgressUI(pauseTime);
    if (was) play();
}
function seekTo(t) {
    if (!pitchedBuffer) return;
    const newTime = Math.max(0, Math.min(pitchedBuffer.duration, t));
    const was = isPlaying;
    if (isPlaying) pauseWithoutReset();
    pauseTime = newTime; syncProgressUI(pauseTime);
    if (was) play();
}

let previousVolume = 100, isMuted = false;
function changeVolume(d) {
    const sl = document.getElementById('volumeSlider');
    const nv = Math.max(0, Math.min(150, parseFloat(sl.value) + d));
    sl.value = nv; document.getElementById('volumeValue').textContent = nv.toFixed(1) + '%';
    if (gainNode) gainNode.gain.value = nv / 100;
}
function toggleMute() {
    const sl = document.getElementById('volumeSlider');
    if (isMuted) {
        sl.value = previousVolume;
        document.getElementById('volumeValue').textContent = previousVolume.toFixed(1) + '%';
        if (gainNode) gainNode.gain.value = previousVolume / 100;
        isMuted = false;
    } else {
        previousVolume = parseFloat(sl.value); sl.value = 0;
        document.getElementById('volumeValue').textContent = '0% (Muted)';
        if (gainNode) gainNode.gain.value = 0; isMuted = true;
    }
}

console.log('🎵 Audio Editor — pitch via OfflineAudioContext resample ✅');
