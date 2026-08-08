// ============================================================
// Audio Editor — script.js
// ============================================================

// ── Estado global
let audioContext;
let audioBuffer;
let tonePlayer;
let tonePitchShift;
let toneGain;
let toneBass;
let toneTreble;
let tonePan;
let toneReverb;
let toneDelay;
let toneCompressor;
let analyserNode;

let isPlaying    = false;
let pauseOffset  = 0;
let playStarted  = 0;
let playbackRateAtStart = 1;
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

// DOM (aguarda DOMContentLoaded para garantir que os elementos existem)
document.addEventListener('DOMContentLoaded', initDOM);

let uploadSection, fileInput, playBtn, stopBtn, resetBtn, downloadBtn;
let progressBar, progressFill, progressThumb, currentTimeEl, totalTimeEl;
let fileNameEl, waveformCanvas, waveformCtx, playIcon, pauseIcon;
let pitchProcessingBanner, pitchProcessingInline, eightDToggle;

function initDOM() {
    if (window.lucide) window.lucide.createIcons();
    uploadSection       = document.getElementById('uploadSection');
    fileInput           = document.getElementById('fileInput');
    playBtn             = document.getElementById('playBtn');
    stopBtn             = document.getElementById('stopBtn');
    resetBtn            = document.getElementById('resetBtn');
    downloadBtn         = document.getElementById('downloadBtn');
    progressBar         = document.getElementById('progressBar');
    progressFill        = document.getElementById('progressFill');
    progressThumb       = document.getElementById('progressThumb');
    currentTimeEl       = document.getElementById('currentTime');
    totalTimeEl         = document.getElementById('totalTime');
    fileNameEl          = document.getElementById('fileName');
    waveformCanvas      = document.getElementById('waveform');
    waveformCtx         = waveformCanvas.getContext('2d');
    playIcon            = document.getElementById('playIcon');
    pauseIcon           = document.getElementById('pauseIcon');
    pitchProcessingBanner = document.getElementById('pitchProcessingBanner');
    pitchProcessingInline = document.getElementById('pitchProcessingInline');
    eightDToggle        = document.getElementById('eightDToggle');

    waveformCanvas.width  = waveformCanvas.offsetWidth  * 2;
    waveformCanvas.height = waveformCanvas.offsetHeight * 2;

    attachListeners();
}

function showPlayIcon()  { if(playIcon)  { playIcon.style.display = ''; }  if(pauseIcon) { pauseIcon.style.display = 'none'; } }
function showPauseIcon() { if(playIcon)  { playIcon.style.display = 'none'; } if(pauseIcon) { pauseIcon.style.display = ''; } }

// ── Helpers
function getSpeedValue()     { return parseFloat(document.getElementById('speedSlider').value); }
function getPitchSemitones() { return parseFloat(document.getElementById('pitchSlider').value); }
function getDuration()       { return audioBuffer ? audioBuffer.duration : 0; }
function getAdjustedDuration() { return getDuration() / getSpeedValue(); }

function getCurrentOffset() {
    if (!isPlaying) return pauseOffset;
    const elapsed = Math.max(0, Tone.now() - playStarted) * playbackRateAtStart;
    return Math.min(pauseOffset + elapsed, getDuration());
}

function setPlaybackSpeed(speed) {
    // O evento do slider já contém a velocidade nova. Preserve primeiro a
    // posição calculada com a velocidade que estava ativa neste trecho.
    const currentOffset = getCurrentOffset();
    pauseOffset = currentOffset;

    const slider = document.getElementById('speedSlider');
    slider.value = speed;
    document.getElementById('speedValue').textContent = speed.toFixed(2) + 'x';

    if (tonePlayer) tonePlayer.playbackRate = speed;
    playbackRateAtStart = speed;
    if (isPlaying) playStarted = Tone.now();

    syncProgressUI(currentOffset);
}

// ── Tone.js Graph
async function buildToneGraph() {
    teardownToneGraph();
    if (!window.Tone) throw new Error('O processador de áudio não foi carregado. Verifique sua conexão e recarregue a página.');
    if (!audioBuffer) throw new Error('Nenhum áudio foi carregado.');
    await Tone.start();

    // O arquivo já foi decodificado pelo AudioContext nativo no upload.
    // Reutilizar o AudioBuffer evita uma segunda decodificação dentro do Tone.js,
    // que podia falhar em standardized-audio-context com a mensagem
    // "A value with the given key could not be found."
    tonePlayer = new Tone.Player(audioBuffer);
    tonePlayer.loop = false;

    tonePitchShift = new Tone.PitchShift({
        pitch: getPitchSemitones(),
        windowSize: 0.1,
        delayTime: 0,
        feedback: 0
    });

    const bassVal   = parseFloat(document.getElementById('bassSlider').value);
    const trebleVal = parseFloat(document.getElementById('trebleSlider').value);
    toneBass   = new Tone.Filter({ type: 'lowshelf',  frequency: 200,  gain: bassVal });
    toneTreble = new Tone.Filter({ type: 'highshelf', frequency: 3000, gain: trebleVal });

    const panVal = eightDEnabled ? 0 : parseFloat(document.getElementById('panSlider').value) / 100;
    tonePan = new Tone.Panner(panVal);

    const volVal = parseFloat(document.getElementById('volumeSlider').value) / 100;
    toneGain = new Tone.Gain(volVal);

    const echoVal = parseFloat(document.getElementById('echoSlider').value) / 100;
    toneDelay = new Tone.FeedbackDelay({
        delayTime: 0.3,
        feedback:  Math.min(0.55, echoVal * 0.5),
        wet:       echoVal
    });

    const revVal = parseFloat(document.getElementById('reverbSlider').value) / 100;
    toneReverb = new Tone.Reverb({ decay: 2.0, wet: revVal });
    await toneReverb.ready;

    toneCompressor = new Tone.Compressor({
        threshold: -6, knee: 0, ratio: 20, attack: 0.003, release: 0.1
    });

    if (!analyserNode) {
        analyserNode = Tone.getContext().rawContext.createAnalyser();
        analyserNode.fftSize = 2048;
        analyserNode.smoothingTimeConstant = 0.8;
    }

    tonePlayer.connect(tonePitchShift);
    tonePitchShift.connect(toneBass);
    toneBass.connect(toneTreble);
    toneTreble.connect(tonePan);
    tonePan.connect(toneGain);
    toneGain.connect(toneDelay);
    toneDelay.connect(toneReverb);
    toneReverb.connect(toneCompressor);

    // Mantém o caminho audível inteiramente no grafo do Tone.js.
    // O AnalyserNode nativo recebe apenas uma derivação para medição/visualização.
    toneCompressor.toDestination();
    toneCompressor.connect(analyserNode);
}

function teardownToneGraph() {
    try { if (tonePlayer)     { tonePlayer.onstop = () => {}; tonePlayer.stop(); tonePlayer.dispose(); } } catch(e){}
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

// ── Upload
function attachUploadListeners() {
    if (!fileInput) return;
    const chooseFileBtn = document.getElementById('chooseFileBtn');
    const openFilePicker = () => {
        fileInput.value = '';
        fileInput.click();
    };

    chooseFileBtn.addEventListener('click', e => {
        e.stopPropagation();
        openFilePicker();
    });
    uploadSection.addEventListener('click', e => {
        if (!chooseFileBtn.contains(e.target)) openFilePicker();
    });
    ['dragenter', 'dragover'].forEach(type => uploadSection.addEventListener(type, e => {
        e.preventDefault();
        uploadSection.classList.add('drag-over');
    }));
    ['dragleave', 'dragend'].forEach(type => uploadSection.addEventListener(type, () => {
        uploadSection.classList.remove('drag-over');
    }));
    uploadSection.addEventListener('drop', e => {
        e.preventDefault();
        uploadSection.classList.remove('drag-over');
        const file = e.dataTransfer && e.dataTransfer.files[0];
        if (file) loadAudioFile(file);
    });
    fileInput.addEventListener('change', e => {
        const f = e.target.files[0];
        if (f) loadAudioFile(f);
    });
}

async function loadAudioFile(file) {
    const chooseFileBtn = document.getElementById('chooseFileBtn');
    const originalButtonContent = chooseFileBtn.innerHTML;
    const validExtension = file && /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
    if (!file || (!(file.type || '').startsWith('audio/') && !validExtension)) {
        alert('Selecione um arquivo de áudio válido (MP3, WAV, OGG, M4A, AAC ou FLAC).');
        return;
    }

    try {
        chooseFileBtn.disabled = true;
        chooseFileBtn.textContent = 'Carregando…';
        uploadSection.setAttribute('aria-busy', 'true');
        isPlaying = false; pauseOffset = 0; playbackRateAtStart = getSpeedValue();
        teardownToneGraph();
        stopLevelMeter();
        cancelAnimationFrame(progressRafId);
        cancelAnimationFrame(animationId);

        const fileData = await file.arrayBuffer();

        // Decodifica uma única vez. O mesmo AudioBuffer é usado para waveform,
        // exportação e reprodução pelo Tone.Player.
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') await audioContext.resume();
        const decodedBuffer = await audioContext.decodeAudioData(fileData.slice(0));
        audioBuffer = decodedBuffer;
        currentFileName = file.name;
        if (fileNameEl) fileNameEl.textContent = currentFileName;

        document.querySelectorAll('.player-section').forEach(el => el.classList.add('active'));
        drawWaveform();
        showPlayIcon();
        syncProgressUI(0);
        if (totalTimeEl) totalTimeEl.textContent = formatTime(getAdjustedDuration());
        console.log('✅ Áudio carregado:', file.name);
    } catch(err) {
        console.error('Erro ao carregar áudio:', err);
        audioBuffer = null;
        alert('Não foi possível decodificar este arquivo. Tente outro formato ou arquivo.\n\nDetalhes: ' + err.message);
    } finally {
        chooseFileBtn.disabled = false;
        chooseFileBtn.innerHTML = originalButtonContent;
        uploadSection.removeAttribute('aria-busy');
        if (window.lucide) window.lucide.createIcons();
    }
}

// ── Playback
async function play() {
    if (!audioBuffer) return;
    if (isPlaying) { pause(); return; }
    try {
        if (!window.Tone) throw new Error('O processador de áudio não foi carregado. Verifique sua conexão e recarregue a página.');
        await Tone.start();
        if (!tonePlayer) await buildToneGraph();
    } catch (err) {
        console.error('Erro ao iniciar reprodução:', err);
        alert(err.message);
        return;
    }

    const speed = getSpeedValue();
    tonePlayer.playbackRate = speed;
    playbackRateAtStart = speed;
    if (tonePitchShift) tonePitchShift.pitch = getPitchSemitones();

    const maxOffset = Math.max(0, getDuration() - 0.01);
    const offset = Math.max(0, Math.min(pauseOffset, maxOffset));
    const startAt = Tone.now();
    pauseOffset = offset;
    tonePlayer.onstop = () => {};
    tonePlayer.start(startAt, offset);
    playStarted = startAt;
    isPlaying   = true;
    showPauseIcon();

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
    isPlaying = false;
    try { tonePlayer.stop(); } catch(e){}
    showPlayIcon();
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

function stop() {
    isPlaying = false;
    try { if (tonePlayer) tonePlayer.stop(); } catch(e){}
    pauseOffset = 0;
    showPlayIcon(); syncProgressUI(0);
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
}

// ── Progress UI
function syncProgressUI(overrideOffset) {
    const offset = overrideOffset !== undefined ? overrideOffset : getCurrentOffset();
    const dur    = getDuration();
    const adjDur = getAdjustedDuration();
    const adjOff = dur > 0 ? (offset / dur) * adjDur : 0;
    const ratio  = adjDur > 0 ? Math.max(0, Math.min(1, adjOff / adjDur)) : 0;
    const pct    = (ratio * 100).toFixed(4) + '%';
    if (progressFill)  progressFill.style.width = pct;
    if (progressThumb) progressThumb.style.left = pct;
    if (currentTimeEl) currentTimeEl.textContent = formatTime(adjOff);
    if (totalTimeEl)   totalTimeEl.textContent   = formatTime(adjDur);
}

function scheduleProgressUpdate() {
    cancelAnimationFrame(progressRafId);
    if (!isPlaying || isDragging) return;
    const offset = getCurrentOffset();
    syncProgressUI(offset);
    if (offset >= getDuration()) {
        _onEnded();
        return;
    }
    progressRafId = requestAnimationFrame(scheduleProgressUpdate);
}

// ── Seek
function seekToPosition(clientX) {
    if (!audioBuffer || !progressBar) return;
    const rect  = progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    pauseOffset = ratio * getDuration();
    syncProgressUI(pauseOffset);
}

// ── Attach all listeners (called from initDOM)
function attachListeners() {
    attachUploadListeners();

    // Seek
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

    // Sliders
    document.getElementById('speedSlider').addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        setPlaybackSpeed(v);
    });

    document.getElementById('pitchSlider').addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        document.getElementById('pitchValue').textContent = v.toFixed(1) + ' st';
        if (tonePitchShift) tonePitchShift.pitch = v;
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

    // Stubs
    document.getElementById('preGainSlider').addEventListener('input', () => {});
    document.getElementById('outputGainSlider').addEventListener('input', () => {});
    document.getElementById('limiterToggle').addEventListener('click', () => {
        limiterEnabled = !limiterEnabled;
        document.getElementById('limiterToggle').classList.toggle('active');
    });

    // 8D
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

    // Buttons
    playBtn.addEventListener('click', play);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', () => applyPreset(presets.normal));

    // Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => { const p = presets[btn.dataset.preset]; if (p) applyPreset(p); });
    });

    // Download
    downloadBtn.addEventListener('click', handleDownload);

    // Keyboard
    document.addEventListener('keydown', handleKeydown);

    // Resize
    window.addEventListener('resize', () => { if (audioBuffer) drawWaveform(); });
}

// ── 8D Audio
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

// ── Waveform / Visualize
function drawWaveform() {
    if (!waveformCanvas) return;
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
    if (!waveformCanvas) return;
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

// ── Level Meter
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

// ── Presets
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

function applyPreset(p) {
    setPlaybackSpeed(p.speed);
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

    if (p.eightD && !eightDEnabled)      eightDToggle.click();
    else if (!p.eightD && eightDEnabled) eightDToggle.click();

    syncProgressUI();
}

// ── Export / Download
async function handleDownload() {
    if (!audioBuffer) { alert('Carregue um arquivo de áudio primeiro.'); return; }
    try {
        downloadBtn.querySelector('span').textContent = 'Processing...';
        downloadBtn.disabled = true;

        const pitch = getPitchSemitones();
        const speed = getSpeedValue();
        const sr    = audioBuffer.sampleRate;
        const nCh   = audioBuffer.numberOfChannels;

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

        const finalLen = Math.ceil(pitchedBuf.length / speed);
        const offCtx   = new OfflineAudioContext(2, finalLen, sr);
        const src      = offCtx.createBufferSource();
        src.buffer     = pitchedBuf;
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

        const comp = offCtx.createDynamicsCompressor();
        comp.threshold.value=-3; comp.knee.value=6; comp.ratio.value=12; comp.attack.value=0.003; comp.release.value=0.25;
        const outG = offCtx.createGain(); outG.gain.value = 0.944;

        src.connect(bass); bass.connect(treble); treble.connect(pan||gainN);
        if (pan) pan.connect(gainN);
        gainN.connect(delay); delay.connect(dGain); dGain.connect(delay); dGain.connect(gainN);
        const merger = offCtx.createGain();
        gainN.connect(rDry); rDry.connect(merger);
        if (revV > 0) { gainN.connect(conv); conv.connect(rWet); rWet.connect(merger); }
        merger.connect(comp); comp.connect(outG); outG.connect(offCtx.destination);
        src.start(0);

        let rendered = await offCtx.startRendering();

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
        const blob2 = new Blob([wav], { type: 'audio/wav' });
        const url  = URL.createObjectURL(blob2);
        const a    = document.createElement('a');
        a.href     = url;
        const fx = [];
        if (speed !== 1.0) fx.push(speed + 'x');
        if (pitch !== 0)   fx.push((pitch > 0 ? '+' : '') + pitch + 'st');
        a.download = 'edited_' + currentFileName.replace(/\.[^/.]+$/, '') + (fx.length ? '_' + fx.join('_') : '') + '.wav';
        a.click(); URL.revokeObjectURL(url);
    } catch(err) {
        console.error('Erro de export:', err);
        alert('Falha ao exportar: ' + err.message);
    } finally {
        downloadBtn.querySelector('span').textContent = 'Export';
        downloadBtn.disabled = false;
    }
}

// ── WAV Encoder
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

// ── Keyboard Shortcuts
function handleKeydown(e) {
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
}

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

// ── Utils
function formatTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s/60), sec = Math.floor(s%60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
}
function gainToDb(g)  { return 20 * Math.log10(Math.max(g, 0.00001)); }
function dbToGain(db) { return Math.pow(10, db / 20); }

console.log('🎵 Audio Editor — Tone.js PitchShift (phase vocoder real) ✅');