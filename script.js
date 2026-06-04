// ============================================================
// Audio Editor — script.js
// Pitch shift: Tone.js PitchShift (phase vocoder FFT real)
//              → pitch alterado SEM mudar velocidade
// Speed:       Tone.Player.playbackRate
//              → velocidade alterada SEM mudar pitch
// Completamente independentes.
// ============================================================

// ── Estado global ─────────────────────────────────────────────────────────────
let audioContext;          // contexto nativo (para waveform / analyser / export)
let audioBuffer;           // AudioBuffer original decodificado
let tonePlayer;            // Tone.Player — fonte de áudio
let tonePitchShift;        // Tone.PitchShift — phase vocoder
let toneGain;              // Tone.Gain — volume
let toneBass;              // Tone.EQ3 ou Filter
let toneTreble;
let tonePan;               // Tone.Panner
let toneReverb;            // Tone.Reverb
let toneDelay;             // Tone.FeedbackDelay
let toneCompressor;        // Tone.Compressor
let analyserNode;          // AnalyserNode nativo (ligado via Tone.Destination)
let analyserGain;          // Gain nativo para analyser

let isPlaying    = false;
let pauseOffset  = 0;      // posição (segundos) onde a reprodução foi pausada
let playStarted  = 0;      // Tone.now() quando play() foi chamado
let eightDEnabled  = false;
let eightDAudioInterval = null;
let limiterEnabled = true;
let currentFileName = '';
let meterInterval   = null;
let progressRafId   = null;
let animationId     = null;
let isDragging      = false;
let wasPausedBeforeDrag = false;
let previousVolume  = 100;
let isMuted         = false;

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
const pitchProcessingBanner = document.getElementById('pitchProcessingBanner');
const pitchProcessingInline = document.getElementById('pitchProcessingInline');
const eightDToggle   = document.getElementById('eightDToggle');

function showPlayIcon()  { playIcon.style.display = ''; pauseIcon.style.display = 'none'; }
function showPauseIcon() { playIcon.style.display = 'none'; pauseIcon.style.display = ''; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSpeedValue()     { return parseFloat(document.getElementById('speedSlider').value); }
function getPitchSemitones() { return parseFloat(document.getElementById('pitchSlider').value); }
function getDuration()       { return audioBuffer ? audioBuffer.duration : 0; }
function getAdjustedDuration() {
    // duração real = duração do buffer / velocidade
    return getDuration() / getSpeedValue();
}

function getCurrentOffset() {
    if (!isPlaying) return pauseOffset;
    const elapsed = (Tone.now() - playStarted) * getSpeedValue();
    return Math.min(pauseOffset + elapsed, getDuration());
}

// ── Tone.js Graph ─────────────────────────────────────────────────────────────
// Fluxo:
// Player → PitchShift → EQ (bass/treble) → Pan → Gain(vol) → Delay → Reverb → Compressor → Destination
//                                                                                           ↓
//                                                                              AnalyserNode nativo
async function buildToneGraph() {
    // Teardown anterior
    teardownToneGraph();

    // Inicia Tone.js (usa AudioContext já existente se possível)
    await Tone.start();

    // Player: carrega o AudioBuffer diretamente
    tonePlayer = new Tone.Player().toDestination();
    tonePlayer.buffer = new Tone.ToneAudioBuffer();
    tonePlayer.buffer._buffer = audioBuffer;  // injeta buffer nativo
    tonePlayer.loaded = true;
    tonePlayer.loop   = false;

    // PitchShift — phase vocoder: altera pitch SEM alterar velocidade
    tonePitchShift = new Tone.PitchShift({
        pitch:    getPitchSemitones(),
        windowSize: 0.1,
        delayTime:  0,
        feedback:   0
    });

    // EQ
    const bassVal   = parseFloat(document.getElementById('bassSlider').value);
    const trebleVal = parseFloat(document.getElementById('trebleSlider').value);
    toneBass   = new Tone.Filter({ type: 'lowshelf',  frequency: 200,  gain: bassVal });
    toneTreble = new Tone.Filter({ type: 'highshelf', frequency: 3000, gain: trebleVal });

    // Pan
    const panVal = eightDEnabled ? 0 : parseFloat(document.getElementById('panSlider').value) / 100;
    tonePan = new Tone.Panner(panVal);

    // Volume
    const volVal = parseFloat(document.getElementById('volumeSlider').value) / 100;
    toneGain = new Tone.Gain(volVal);

    // Delay / Echo
    const echoVal = parseFloat(document.getElementById('echoSlider').value) / 100;
    toneDelay = new Tone.FeedbackDelay({
        delayTime: 0.3,
        feedback:  Math.min(0.55, echoVal * 0.5),
        wet:       echoVal
    });

    // Reverb
    const revVal = parseFloat(document.getElementById('reverbSlider').value) / 100;
    toneReverb = new Tone.Reverb({ decay: 2.0, wet: revVal });
    await toneReverb.ready;

    // Compressor (limiter)
    toneCompressor = new Tone.Compressor({
        threshold: -6, knee: 0, ratio: 20, attack: 0.003, release: 0.1
    });

    // Analyser nativo (para waveform/meter)
    if (!analyserNode) {
        analyserNode = Tone.getContext().rawContext.createAnalyser();
        analyserNode.fftSize = 2048;
        analyserNode.smoothingTimeConstant = 0.8;
    }
    analyserGain = Tone.getContext().rawContext.createGain();
    analyserGain.gain.value = 1;
    analyserGain.connect(analyserNode);
    analyserNode.connect(Tone.getDestination().input);

    // Cadeia: Player → PitchShift → Bass → Treble → Pan → Gain → Delay → Reverb → Compressor → Tone.Dest
    tonePlayer.disconnect();
    tonePlayer.connect(tonePitchShift);
    tonePitchShift.connect(toneBass);
    toneBass.connect(toneTreble);
    toneTreble.connect(tonePan);
    tonePan.connect(toneGain);
    toneGain.connect(toneDelay);
    toneDelay.connect(toneReverb);
    toneReverb.connect(toneCompressor);
    toneCompressor.connect(analyserGain);
    // analyserGain → analyserNode → Tone.Destination (conectado acima)
    toneCompressor.toDestination();
}

function teardownToneGraph() {
    try { if (tonePlayer)     { tonePlayer.stop(); tonePlayer.dispose(); }     } catch(e){}
    try { if (tonePitchShift) { tonePitchShift.dispose(); }                    } catch(e){}
    try { if (toneBass)       { toneBass.dispose(); }                          } catch(e){}
    try { if (toneTreble)     { toneTreble.dispose(); }                        } catch(e){}
    try { if (tonePan)        { tonePan.dispose(); }                           } catch(e){}
    try { if (toneGain)       { toneGain.dispose(); }                          } catch(e){}
    try { if (toneDelay)      { toneDelay.dispose(); }                         } catch(e){}
    try { if (toneReverb)     { toneReverb.dispose(); }                        } catch(e){}
    try { if (toneCompressor) { toneCompressor.dispose(); }                    } catch(e){}
    tonePlayer = tonePitchShift = toneBass = toneTreble = tonePan = null;
    toneGain = toneDelay = toneReverb = toneCompressor = null;
}

// ── Upload ────────────────────────────────────────────────────────────────────
// Os event listeners de clique/drag da uploadSection estão no index.html
// para evitar duplicação. Aqui apenas o listener de mudança do input.
fileInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) loadAudioFile(f);
});

async function loadAudioFile(file) {
    currentFileName = file.name;
    fileNameEl.textContent = currentFileName;
    try {
        isPlaying = false; pauseOffset = 0;
        stopLevelMeter();
        cancelAnimationFrame(progressRafId);
        cancelAnimationFrame(animationId);

        // Decodifica com AudioContext nativo
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') await audioContext.resume();
        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        await buildToneGraph();

        document.querySelectorAll('.player-section').forEach(el => el.classList.add('active'));
        drawWaveform();
        showPlayIcon();
        syncProgressUI(0);
        totalTimeEl.textContent = formatTime(getAdjustedDuration());
        console.log('✅ Tone.js graph pronto — pitch via PitchShift (phase vocoder)');
    } catch(err) {
        console.error('Erro ao carregar áudio:', err);
        alert('Falha ao carregar o arquivo. Tente outro formato.');
    }
}

// ── Playback ──────────────────────────────────────────────────────────────────
async function play() {
    if (!audioBuffer) return;
    if (isPlaying) { pause(); return; }
    await Tone.start();
    if (!tonePlayer) await buildToneGraph();

    const speed  = getSpeedValue();
    tonePlayer.playbackRate = speed;
    // PitchShift já está configurado; só garante o valor atual
    if (tonePitchShift) tonePitchShift.pitch = getPitchSemitones();

    const offset = Math.min(pauseOffset, getDuration() - 0.01);
    tonePlayer.start(Tone.now(), offset);
    playStarted = Tone.now() - offset / speed;
    isPlaying   = true;
    showPauseIcon();

    // Quando termina naturalmente
    tonePlayer.onstop = () => { if (isPlaying) _onEnded(); };

    visualize();
    scheduleProgressUpdate();
    startLevelMeter();
}

function _onEnded() {
    isPlaying = false; pauseOffset = 0;
    showPlayIcon(); syncProgressUI(0);
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

function pause() {
    if (!isPlaying) return;
    pauseOffset = getCurrentOffset();
    try { tonePlayer.stop(); } catch(e){}
    isPlaying = false; showPlayIcon();
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

function stop() {
    try { if (tonePlayer) tonePlayer.stop(); } catch(e){}
    isPlaying = false; pauseOffset = 0;
    showPlayIcon(); syncProgressUI(0);
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ── Progress UI ───────────────────────────────────────────────────────────────
function syncProgressUI(overrideOffset) {
    const offset  = overrideOffset !== undefined ? overrideOffset : getCurrentOffset();
    const dur     = getDuration();
    const adjDur  = getAdjustedDuration();
    const adjOff  = dur > 0 ? (offset / dur) * adjDur : 0;
    const ratio   = adjDur > 0 ? Math.max(0, Math.min(1, adjOff / adjDur)) : 0;
    const pct     = (ratio * 100).toFixed(4) + '%';
    progressFill.style.width = pct;
    if (progressThumb) progressThumb.style.left = pct;
    currentTimeEl.textContent = formatTime(adjOff);
    totalTimeEl.textContent   = formatTime(adjDur);
}

function scheduleProgressUpdate() {
    cancelAnimationFrame(progressRafId);
    if (!isPlaying || isDragging) return;
    syncProgressUI();
    if (getCurrentOffset() < getDuration())
        progressRafId = requestAnimationFrame(scheduleProgressUpdate);
}

// ── Seek ──────────────────────────────────────────────────────────────────────
function seekToPosition(clientX) {
    if (!audioBuffer) return;
    const rect   = progressBar.getBoundingClientRect();
    const ratio  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    pauseOffset  = ratio * getDuration();
    syncProgressUI(pauseOffset);
}

progressBar.addEventListener('mousedown', e => {
    if (!audioBuffer) return;
    isDragging = true; wasPausedBeforeDrag = !isPlaying;
    if (isPlaying) pause();
    seekToPosition(e.clientX); progressBar.style.cursor = 'grabbing';
});
progressBar.addEventListener('touchstart', e => {
    if (!audioBuffer) return;
    isDragging = true; wasPausedBeforeDrag = !isPlaying;
    if (isPlaying) pause();
    seekToPosition(e.touches[0].clientX);
}, { passive: true });
document.addEventListener('mousemove',  e => { if (isDragging) seekToPosition(e.clientX); });
document.addEventListener('touchmove',  e => { if (isDragging) seekToPosition(e.touches[0].clientX); }, { passive: true });
document.addEventListener('mouseup',    () => { if (!isDragging) return; isDragging = false; progressBar.style.cursor = 'pointer'; if (!wasPausedBeforeDrag) play(); });
document.addEventListener('touchend',   () => { if (!isDragging) return; isDragging = false; if (!wasPausedBeforeDrag) play(); });

// ── Sliders ───────────────────────────────────────────────────────────────────

// Speed — só muda playbackRate do Player (não mexe no pitch)
document.getElementById('speedSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('speedValue').textContent = v.toFixed(2) + 'x';
    if (tonePlayer) {
        if (isPlaying) {
            // Recalcula pauseOffset para manter posição correta
            pauseOffset = getCurrentOffset();
            tonePlayer.playbackRate = v;
            playStarted = Tone.now() - pauseOffset / v;
        } else {
            tonePlayer.playbackRate = v;
        }
    }
    syncProgressUI();
});

// Pitch — só muda PitchShift.pitch (não mexe na velocidade)
document.getElementById('pitchSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('pitchValue').textContent = v.toFixed(1) + ' st';
    if (tonePitchShift) {
        tonePitchShift.pitch = v;  // tempo real, sem rebuild
    }
});

document.getElementById('volumeSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('volumeValue').textContent = v.toFixed(1) + '%';
    if (toneGain) toneGain.gain.value = v / 100;
});

document.getElementById('bassSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('bassValue').textContent = v.toFixed(1) + ' dB';
    if (toneBass) toneBass.gain.value = v;
});

document.getElementById('trebleSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('trebleValue').textContent = v.toFixed(1) + ' dB';
    if (toneTreble) toneTreble.gain.value = v;
});

document.getElementById('panSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    const av = Math.abs(v).toFixed(1);
    document.getElementById('panValue').textContent = v === 0 ? 'Center' : v < 0 ? av + '% Left' : av + '% Right';
    if (tonePan && !eightDEnabled) tonePan.pan.value = v / 100;
});

document.getElementById('reverbSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('reverbValue').textContent = v.toFixed(1) + '%';
    if (toneReverb) toneReverb.wet.value = v / 100;
});

document.getElementById('echoSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('echoValue').textContent = v.toFixed(1) + '%';
    if (toneDelay) {
        toneDelay.wet.value      = v / 100;
        toneDelay.feedback.value = Math.min(0.55, v / 100 * 0.5);
    }
});

// Stubs para inputs ocultos de compatibilidade
document.getElementById('preGainSlider').addEventListener('input', () => {});
document.getElementById('outputGainSlider').addEventListener('input', () => {});
document.getElementById('limiterToggle').addEventListener('click', () => {
    limiterEnabled = !limiterEnabled;
    document.getElementById('limiterToggle').classList.toggle('active');
});

// ── 8D Audio ──────────────────────────────────────────────────────────────────
eightDToggle.addEventListener('click', () => {
    eightDEnabled = !eightDEnabled;
    eightDToggle.classList.toggle('active');
    eightDToggle.setAttribute('aria-checked', String(eightDEnabled));
    if (eightDEnabled) start8DAudio(); else stop8DAudio();
});
document.getElementById('eightDSpeed').addEventListener('input', e => {
    document.getElementById('eightDSpeedValue').textContent = parseFloat(e.target.value).toFixed(1);
    if (eightDEnabled) { stop8DAudio(); start8DAudio(); }
});

function start8DAudio() {
    if (!tonePan) return;
    const speed = parseFloat(document.getElementById('eightDSpeed').value);
    let angle = 0;
    eightDAudioInterval = setInterval(() => {
        angle += 0.05 * speed;
        if (tonePan) tonePan.pan.value = Math.sin(angle);
    }, 50);
}
function stop8DAudio() {
    if (eightDAudioInterval) { clearInterval(eightDAudioInterval); eightDAudioInterval = null; }
    if (tonePan) tonePan.pan.value = parseFloat(document.getElementById('panSlider').value) / 100;
}

// ── Waveform / Visualize ──────────────────────────────────────────────────────
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
        for (let j = 0; j < step; j++) { const d = data[i*step+j]||0; if(d<mn)mn=d; if(d>mx)mx=d; }
        const y = (1 + mn) * amp;
        if (i === 0) waveformCtx.moveTo(i, y); else waveformCtx.lineTo(i, y);
    }
    waveformCtx.stroke();
}

function visualize() {
    const w = waveformCanvas.width, h = waveformCanvas.height;
    const bufLen = analyserNode ? analyserNode.frequencyBinCount : 1024;
    const data   = new Uint8Array(bufLen);
    function draw() {
        if (!isPlaying) return;
        animationId = requestAnimationFrame(draw);
        if (analyserNode) analyserNode.getByteTimeDomainData(data);
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

// ── Level Meter ───────────────────────────────────────────────────────────────
function startLevelMeter() {
    if (!analyserNode) return;
    const bufLen = analyserNode.frequencyBinCount;
    const data   = new Float32Array(bufLen);
    let peakHold = 0, peakHoldTime = 0, clipCount = 0;
    meterInterval = setInterval(() => {
        analyserNode.getFloatTimeDomainData(data);
        let sumSq = 0, peak = 0;
        for (let i = 0; i < bufLen; i++) { const s = Math.abs(data[i]); sumSq += data[i]*data[i]; if(s>peak)peak=s; }
        const rms   = Math.sqrt(sumSq / bufLen);
        const rmsDb = gainToDb(rms), peakDb = gainToDb(peak);
        const rmsPct = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
        const mf = document.getElementById('meterFill');
        const rv = document.getElementById('rmsValue');
        if (mf) mf.style.width = rmsPct + '%';
        if (rv) rv.textContent  = rmsDb.toFixed(1) + ' dB';
        if (peak > peakHold) { peakHold = peak; peakHoldTime = Date.now(); }
        if (Date.now() - peakHoldTime > 1000) peakHold *= 0.95;
        const pkPct = Math.max(0, Math.min(100, ((gainToDb(peakHold) + 60) / 60) * 100));
        const mp = document.getElementById('meterPeak'); const pv = document.getElementById('peakValue');
        if (mp) mp.style.left = pkPct + '%';
        if (pv) pv.textContent = gainToDb(peakHold).toFixed(1) + ' dB';
        const ci = document.getElementById('clipIndicator');
        if (peakDb > -1) { if(ci)ci.classList.add('active'); clipCount++; }
        else { if(ci)ci.classList.remove('active'); if(clipCount>0)clipCount--; }
    }, 50);
}
function stopLevelMeter() {
    if (meterInterval) { clearInterval(meterInterval); meterInterval = null; }
    const mf=document.getElementById('meterFill'); const mp=document.getElementById('meterPeak');
    const pv=document.getElementById('peakValue'); const rv=document.getElementById('rmsValue');
    if(mf)mf.style.width='0%'; if(mp)mp.style.left='0%';
    if(pv)pv.textContent='-∞ dB'; if(rv)rv.textContent='-∞ dB';
}

// ── Presets ───────────────────────────────────────────────────────────────────
const presets = {
    normal:     { speed:1.00, pitch:  0, volume:100, bass: 0, treble: 0, pan:0, reverb:  0, echo: 0, eightD:false },
    nightcore:  { speed:1.30, pitch:  3, volume:100, bass: 0, treble: 5, pan:0, reverb: 10, echo: 0, eightD:false },
    deepbass:   { speed:0.90, pitch: -3, volume:110, bass:12, treble:-5, pan:0, reverb: 15, echo: 5, eightD:false },
    '8daudio':  { speed:1.00, pitch:  0, volume:100, bass: 3, treble: 2, pan:0, reverb: 25, echo:15, eightD:true  },
    concert:    { speed:1.00, pitch:  0, volume:105, bass: 8, treble: 4, pan:0, reverb: 60, echo:20, eightD:false },
    slowcore:   { speed:0.72, pitch: -2, volume:100, bass: 4, treble:-2, pan:0, reverb: 65, echo:12, eightD:false },
    lofi:       { speed:0.92, pitch: -1, volume: 95, bass: 6, treble:-4, pan:0, reverb: 30, echo: 8, eightD:false },
    vaporwave:  { speed:0.80, pitch: -4, volume:100, bass: 5, treble: 0, pan:0, reverb: 50, echo:18, eightD:false },
    phonecall:  { speed:1.00, pitch:  2, volume:100, bass:-8, treble: 6, pan:0, reverb:  5, echo: 0, eightD:false },
    underwater: { speed:0.85, pitch: -5, volume:100, bass: 8, treble:-8, pan:0, reverb: 80, echo:30, eightD:false },
};

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => { const p = presets[btn.dataset.preset]; if (p) applyPreset(p); });
});

function applyPreset(p) {
    document.getElementById('speedSlider').value  = p.speed;
    document.getElementById('speedValue').textContent = p.speed.toFixed(2) + 'x';
    document.getElementById('pitchSlider').value  = p.pitch;
    document.getElementById('pitchValue').textContent = p.pitch.toFixed(1) + ' st';
    document.getElementById('volumeSlider').value = p.volume;
    document.getElementById('volumeValue').textContent = p.volume.toFixed(1) + '%';
    document.getElementById('bassSlider').value   = p.bass;
    document.getElementById('bassValue').textContent  = p.bass.toFixed(1) + ' dB';
    document.getElementById('trebleSlider').value = p.treble;
    document.getElementById('trebleValue').textContent = p.treble.toFixed(1) + ' dB';
    document.getElementById('panSlider').value    = p.pan;
    document.getElementById('panValue').textContent   = 'Center';
    document.getElementById('reverbSlider').value = p.reverb;
    document.getElementById('reverbValue').textContent = p.reverb.toFixed(1) + '%';
    document.getElementById('echoSlider').value   = p.echo;
    document.getElementById('echoValue').textContent  = p.echo.toFixed(1) + '%';

    if (toneGain)      toneGain.gain.value       = p.volume / 100;
    if (toneBass)      toneBass.gain.value        = p.bass;
    if (toneTreble)    toneTreble.gain.value      = p.treble;
    if (tonePan && !p.eightD) tonePan.pan.value   = p.pan / 100;
    if (toneDelay)     { toneDelay.wet.value = p.echo/100; toneDelay.feedback.value = Math.min(0.55, p.echo/100*0.5); }
    if (toneReverb)    toneReverb.wet.value        = p.reverb / 100;
    if (tonePitchShift) tonePitchShift.pitch       = p.pitch;
    if (tonePlayer)    tonePlayer.playbackRate     = p.speed;

    if (p.eightD && !eightDEnabled)      eightDToggle.click();
    else if (!p.eightD && eightDEnabled) eightDToggle.click();

    syncProgressUI();
}

// ── Buttons ───────────────────────────────────────────────────────────────────
playBtn.addEventListener('click', play);
stopBtn.addEventListener('click', stop);
resetBtn.addEventListener('click', () => applyPreset(presets.normal));

// ── Export / Download ─────────────────────────────────────────────────────────
// Para export, usa OfflineAudioContext + buildPitchedBufferForExport
// que aplica pitch via phase vocoder (OLA) independente da velocidade.
downloadBtn.addEventListener('click', async () => {
    if (!audioBuffer) { alert('Carregue um arquivo de áudio primeiro.'); return; }
    try {
        downloadBtn.querySelector('span').textContent = 'Processing...';
        downloadBtn.disabled = true;

        const pitch = getPitchSemitones();
        const speed = getSpeedValue();
        const sr    = audioBuffer.sampleRate;
        const nCh   = audioBuffer.numberOfChannels;

        // Etapa 1: pitch shift offline via OLA (mesmo algoritmo do Tone.js)
        let pitchedBuf;
        if (Math.abs(pitch) < 0.01) {
            pitchedBuf = audioBuffer;
        } else {
            const ratio     = Math.pow(2, pitch / 12);
            const frameSize = 2048;
            const hopOut    = 512;
            const hopIn     = hopOut * ratio;
            const inLen     = audioBuffer.length;
            const outLen    = Math.ceil(inLen / ratio);
            const win       = new Float32Array(frameSize);
            for (let i = 0; i < frameSize; i++)
                win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
            const outs = Array.from({length: nCh}, () => new Float32Array(outLen));
            for (let ch = 0; ch < nCh; ch++) {
                const inp = audioBuffer.getChannelData(ch), out = outs[ch];
                let inPos = 0, outPos = 0;
                while (outPos + frameSize <= outLen) {
                    const base = Math.round(inPos);
                    for (let i = 0; i < frameSize; i++) {
                        const s = base + i;
                        out[outPos + i] += (s < inLen ? inp[s] : 0) * win[i];
                    }
                    inPos += hopIn; outPos += hopOut;
                }
            }
            const stretched = audioContext.createBuffer(nCh, outLen, sr);
            for (let ch = 0; ch < nCh; ch++) stretched.getChannelData(ch).set(outs[ch]);
            const oCtx  = new OfflineAudioContext(nCh, inLen, sr);
            const oSrc  = oCtx.createBufferSource();
            oSrc.buffer = stretched;
            oSrc.playbackRate.value = ratio;
            oSrc.connect(oCtx.destination);
            oSrc.start(0);
            pitchedBuf = await oCtx.startRendering();
        }

        // Etapa 2: speed + EQ + reverb + echo offline
        const finalLen   = Math.ceil(pitchedBuf.length / speed);
        const offCtx     = new OfflineAudioContext(2, finalLen, sr);
        const src        = offCtx.createBufferSource();
        src.buffer       = pitchedBuf;
        src.playbackRate.value = speed;

        const bass   = offCtx.createBiquadFilter(); bass.type='lowshelf';  bass.frequency.value=200;  bass.gain.value=parseFloat(document.getElementById('bassSlider').value);
        const treble = offCtx.createBiquadFilter(); treble.type='highshelf'; treble.frequency.value=3000; treble.gain.value=parseFloat(document.getElementById('trebleSlider').value);
        const pan    = offCtx.createStereoPanner ? offCtx.createStereoPanner() : null;
        if (pan && !eightDEnabled) pan.pan.value = parseFloat(document.getElementById('panSlider').value) / 100;
        const gainN  = offCtx.createGain(); gainN.gain.value = parseFloat(document.getElementById('volumeSlider').value) / 100;

        const echoV  = parseFloat(document.getElementById('echoSlider').value);
        const delay  = offCtx.createDelay(5.0); delay.delayTime.value = 0.3;
        const dGain  = offCtx.createGain(); dGain.gain.value = Math.min(0.55, echoV/100*0.5);

        const conv   = offCtx.createConvolver();
        const rDry   = offCtx.createGain();
        const rWet   = offCtx.createGain();
        const revV   = parseFloat(document.getElementById('reverbSlider').value) / 100;
        rDry.gain.value = 1 - revV; rWet.gain.value = revV * 0.6;
        const rLen   = sr * 2;
        const rImp   = offCtx.createBuffer(2, rLen, sr);
        for (let c = 0; c < 2; c++) {
            const d = rImp.getChannelData(c);
            for (let i = 0; i < rLen; i++) d[i] = (Math.random()*2-1) * Math.pow((rLen-i)/rLen, Math.max(0.001, revV*20));
        }
        conv.buffer = rImp;

        const comp   = offCtx.createDynamicsCompressor();
        comp.threshold.value=-3; comp.knee.value=6; comp.ratio.value=12; comp.attack.value=0.003; comp.release.value=0.25;
        const outG   = offCtx.createGain(); outG.gain.value = 0.944;

        src.connect(bass); bass.connect(treble); treble.connect(pan||gainN);
        if (pan) pan.connect(gainN);
        gainN.connect(delay); delay.connect(dGain); dGain.connect(delay); dGain.connect(gainN);
        const merger = offCtx.createGain();
        gainN.connect(rDry); rDry.connect(merger);
        if (revV > 0) { gainN.connect(conv); conv.connect(rWet); rWet.connect(merger); }
        merger.connect(comp); comp.connect(outG); outG.connect(offCtx.destination);
        src.start(0);

        let rendered = await offCtx.startRendering();

        // Normalização
        let maxP = 0;
        for (let c = 0; c < rendered.numberOfChannels; c++) {
            const d = rendered.getChannelData(c);
            for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > maxP) maxP = Math.abs(d[i]);
        }
        if (maxP > 0.05 && maxP < 1.5) {
            const ng = 0.944 / maxP;
            for (let c = 0; c < rendered.numberOfChannels; c++) {
                const d = rendered.getChannelData(c);
                for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * ng));
            }
        }

        const wav  = audioBufferToWav(rendered);
        const blob = new Blob([wav], { type: 'audio/wav' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        const fx = [];
        if (speed !== 1.0)  fx.push(speed + 'x');
        if (pitch !== 0)    fx.push((pitch > 0 ? '+' : '') + pitch + 'st');
        a.download = 'edited_' + currentFileName.replace(/\.[^/.]+$/, '') + (fx.length ? '_' + fx.join('_') : '') + '.wav';
        a.click(); URL.revokeObjectURL(url);
    } catch(err) {
        console.error('Erro de export:', err);
        alert('Falha ao exportar: ' + err.message);
    } finally {
        downloadBtn.querySelector('span').textContent = 'Export';
        downloadBtn.disabled = false;
    }
});

// ── WAV Encoder ───────────────────────────────────────────────────────────────
function audioBufferToWav(buffer) {
    const nCh = buffer.numberOfChannels, len = buffer.length * nCh * 2;
    const ab = new ArrayBuffer(44 + len), view = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o+i, s.charCodeAt(i)); };
    ws(0,'RIFF'); view.setUint32(4, 36+len, true);
    ws(8,'WAVE'); ws(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true);
    view.setUint16(22,nCh,true); view.setUint32(24,buffer.sampleRate,true);
    view.setUint32(28,buffer.sampleRate*nCh*2,true);
    view.setUint16(32,nCh*2,true); view.setUint16(34,16,true);
    ws(36,'data'); view.setUint32(40,len,true);
    const chs = Array.from({length:nCh},(_,i)=>buffer.getChannelData(i));
    let off = 44;
    for (let i = 0; i < buffer.length; i++)
        for (let c = 0; c < nCh; c++) {
            const s = Math.max(-1,Math.min(1,chs[c][i]));
            view.setInt16(off, s<0 ? s*0x8000 : s*0x7FFF, true); off += 2;
        }
    return ab;
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (!audioBuffer) return;
    const tag = e.target.tagName.toLowerCase();
    if (tag==='textarea') return;
    if (tag==='input' && e.target.type!=='range') return;
    switch (e.key) {
        case ' ': case 'k': case 'K': e.preventDefault(); play(); break;
        case 'ArrowLeft':  e.preventDefault(); seekRelative(-5);  break;
        case 'ArrowRight': e.preventDefault(); seekRelative(5);   break;
        case 'j': case 'J': e.preventDefault(); seekRelative(-10); break;
        case 'l': case 'L': e.preventDefault(); seekRelative(10);  break;
        case 'Home': e.preventDefault(); seekTo(0); break;
        case 'End':  e.preventDefault(); seekTo(getDuration()); break;
        case 'ArrowUp':   e.preventDefault(); changeVolume(5);  break;
        case 'ArrowDown': e.preventDefault(); changeVolume(-5); break;
        case 'm': case 'M': e.preventDefault(); toggleMute(); break;
    }
});

function seekRelative(s) {
    if (!audioBuffer) return;
    const was = isPlaying;
    if (isPlaying) pause();
    pauseOffset = Math.max(0, Math.min(getDuration(), getCurrentOffset() + s));
    syncProgressUI(pauseOffset);
    if (was) play();
}
function seekTo(t) {
    if (!audioBuffer) return;
    const was = isPlaying;
    if (isPlaying) pause();
    pauseOffset = Math.max(0, Math.min(getDuration(), t));
    syncProgressUI(pauseOffset);
    if (was) play();
}

function changeVolume(d) {
    const sl = document.getElementById('volumeSlider');
    const nv = Math.max(0, Math.min(150, parseFloat(sl.value) + d));
    sl.value = nv; document.getElementById('volumeValue').textContent = nv.toFixed(1) + '%';
    if (toneGain) toneGain.gain.value = nv / 100;
}
function toggleMute() {
    const sl = document.getElementById('volumeSlider');
    if (isMuted) {
        sl.value = previousVolume;
        document.getElementById('volumeValue').textContent = previousVolume.toFixed(1) + '%';
        if (toneGain) toneGain.gain.value = previousVolume / 100;
        isMuted = false;
    } else {
        previousVolume = parseFloat(sl.value); sl.value = 0;
        document.getElementById('volumeValue').textContent = '0% (Muted)';
        if (toneGain) toneGain.gain.value = 0; isMuted = true;
    }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function formatTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s/60), sec = Math.floor(s%60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
}
function gainToDb(g)  { return 20 * Math.log10(Math.max(g, 0.00001)); }
function dbToGain(db) { return Math.pow(10, db / 20); }

window.addEventListener('resize', () => { if (audioBuffer) drawWaveform(); });
waveformCanvas.width  = waveformCanvas.offsetWidth  * 2;
waveformCanvas.height = waveformCanvas.offsetHeight * 2;

console.log('🎵 Audio Editor — Tone.js PitchShift (phase vocoder real) ✅');
