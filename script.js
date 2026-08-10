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
let toneDelay;
let toneReverb;
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
let currentPresetName = 'normal';
let presetToastTimer = null;
let pointerRafId = null;
let lastPointerX = 50;
let lastPointerY = 30;
let isApplyingPreset = false;
let isLoadingAudio = false;

// DOM (aguarda DOMContentLoaded para garantir que os elementos existem)
document.addEventListener('DOMContentLoaded', initDOM);

let uploadSection, fileInput, playBtn, stopBtn, resetBtn, downloadBtn;
let progressBar, progressFill, progressThumb, currentTimeEl, totalTimeEl;
let fileNameEl, waveformCanvas, waveformCtx, playIcon, pauseIcon;
let pitchProcessingBanner, pitchProcessingInline, eightDToggle;
let activePresetNameEl, presetToast, presetToastNameEl;

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
    activePresetNameEl  = document.getElementById('activePresetName');
    presetToast         = document.getElementById('presetToast');
    presetToastNameEl   = document.getElementById('presetToastName');

    resizeWaveformCanvas();
    drawVisualizerIdle();

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
    if (!window.Tone) throw new Error('The audio engine could not be loaded. Check your connection and reload the page.');
    if (!audioBuffer) throw new Error('No audio file has been loaded.');
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
        feedback: Math.min(0.55, echoVal * 0.5),
        wet: echoVal
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
    if (!fileInput || !uploadSection) return;

    const resetFileInput = () => {
        // Permite selecionar novamente o mesmo arquivo.
        fileInput.value = '';
    };

    // O uploadSection é um label ligado ao input. Em celulares, essa ativação
    // nativa é mais confiável do que abrir o seletor apenas com input.click().
    uploadSection.addEventListener('pointerdown', resetFileInput);
    uploadSection.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        resetFileInput();
        fileInput.click();
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
        const file = e.target.files && e.target.files[0];
        if (file) loadAudioFile(file);
    });
}

function withTimeout(promise, timeoutMs, message) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function decodeAudioDataCompat(context, arrayBuffer) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const succeed = buffer => {
            if (settled) return;
            settled = true;
            resolve(buffer);
        };
        const fail = error => {
            if (settled) return;
            settled = true;
            reject(error || new Error('The browser could not decode this audio file.'));
        };

        try {
            const result = context.decodeAudioData(arrayBuffer.slice(0), succeed, fail);
            if (result && typeof result.then === 'function') result.then(succeed, fail);
        } catch (error) {
            fail(error);
        }
    });
}


function isFlacFile(file) {
    const name = file && file.name ? file.name : '';
    const type = file && file.type ? file.type.toLowerCase() : '';
    return /\.flac$/i.test(name) || type === 'audio/flac' || type === 'audio/x-flac';
}

async function decodeFlacAudio(context, arrayBuffer) {
    const flacLibrary = window['flac-decoder'];
    const DecoderClass = flacLibrary && (
        (typeof window.Worker === 'function' && flacLibrary.FLACDecoderWebWorker) ||
        flacLibrary.FLACDecoder
    );

    if (!DecoderClass) {
        throw new Error('The FLAC decoder could not be loaded. Check your connection and reload the page.');
    }

    const decoder = new DecoderClass();
    try {
        await withTimeout(
            decoder.ready,
            30000,
            'Loading the FLAC decoder took too long.'
        );

        const decoded = await withTimeout(
            decoder.decodeFile(new Uint8Array(arrayBuffer)),
            120000,
            'FLAC decoding took too long. Try a shorter file.'
        );

        const channels = decoded && Array.isArray(decoded.channelData)
            ? decoded.channelData
            : [];
        const samplesDecoded = decoded && Number.isFinite(decoded.samplesDecoded)
            ? decoded.samplesDecoded
            : 0;
        const sampleRate = decoded && Number.isFinite(decoded.sampleRate)
            ? decoded.sampleRate
            : 0;
        const channelLength = channels.length
            ? Math.min(...channels.map(channel => channel.length))
            : 0;
        const sampleCount = Math.min(samplesDecoded, channelLength);

        if (!channels.length || sampleCount <= 0 || sampleRate <= 0) {
            const decoderMessage = decoded && decoded.errors && decoded.errors[0]
                ? decoded.errors[0].message
                : 'No audio samples were found in this FLAC file.';
            throw new Error(decoderMessage);
        }

        const buffer = context.createBuffer(channels.length, sampleCount, sampleRate);
        channels.forEach((channel, channelIndex) => {
            buffer.copyToChannel(channel.subarray(0, sampleCount), channelIndex);
        });
        return buffer;
    } finally {
        try {
            if (typeof decoder.terminate === 'function') decoder.terminate();
            else if (typeof decoder.free === 'function') decoder.free();
        } catch (cleanupError) {
            console.warn('FLAC decoder cleanup error:', cleanupError);
        }
    }
}

async function decodeSelectedAudio(context, file, arrayBuffer, updateStatus) {
    if (!isFlacFile(file)) {
        return withTimeout(
            decodeAudioDataCompat(context, arrayBuffer),
            60000,
            'Audio decoding timed out. Try converting the file to MP3 or WAV.'
        );
    }

    updateStatus('Decoding FLAC...');
    try {
        return await decodeFlacAudio(context, arrayBuffer);
    } catch (flacError) {
        console.warn('WebAssembly FLAC decoding failed. Trying the browser decoder:', flacError);
        updateStatus('Trying browser FLAC decoder...');

        try {
            return await withTimeout(
                decodeAudioDataCompat(context, arrayBuffer),
                60000,
                'FLAC decoding timed out.'
            );
        } catch (nativeError) {
            const details = flacError && flacError.message
                ? flacError.message
                : 'Unknown FLAC decoding error.';
            throw new Error('This FLAC file could not be decoded. ' + details);
        }
    }
}

async function loadAudioFile(file) {
    if (isLoadingAudio) return;

    const chooseFileBtn = document.getElementById('chooseFileBtn');
    const originalButtonContent = chooseFileBtn.innerHTML;
    const validExtension = file && /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
    if (!file || (!(file.type || '').startsWith('audio/') && !validExtension)) {
        alert('Choose a valid audio file: MP3, WAV, OGG, M4A, AAC, or FLAC.');
        return;
    }

    isLoadingAudio = true;
    try {
        chooseFileBtn.textContent = 'Reading file...';
        uploadSection.setAttribute('aria-busy', 'true');
        uploadSection.setAttribute('aria-disabled', 'true');
        isPlaying = false;
        pauseOffset = 0;
        playbackRateAtStart = getSpeedValue();
        teardownToneGraph();
        stopLevelMeter();
        cancelAnimationFrame(progressRafId);
        cancelAnimationFrame(animationId);

        const fileData = await withTimeout(
            Promise.resolve().then(() => file.arrayBuffer()),
            90000,
            'Reading this file took too long. If it is stored in the cloud, download it to the device and try again.'
        );

        chooseFileBtn.textContent = 'Decoding...';
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('This browser does not support audio decoding.');
        if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextClass();

        // Decoding does not require the AudioContext to be resumed. FLAC uses
        // a dedicated WebAssembly decoder because native support varies by browser.
        const decodedBuffer = await decodeSelectedAudio(
            audioContext,
            file,
            fileData,
            status => { chooseFileBtn.textContent = status; }
        );

        audioBuffer = decodedBuffer;
        currentFileName = file.name;
        if (fileNameEl) fileNameEl.textContent = currentFileName;

        document.querySelectorAll('.player-section').forEach(el => el.classList.add('active'));
        chooseFileBtn.textContent = 'Building waveform...';
        await new Promise(resolve => requestAnimationFrame(resolve));
        drawWaveform();
        showPlayIcon();
        syncProgressUI(0);
        if (totalTimeEl) totalTimeEl.textContent = formatTime(getAdjustedDuration());
        console.log('Audio loaded:', file.name);
    } catch (error) {
        console.error('Audio loading error:', error);
        audioBuffer = null;
        const details = error && error.message ? error.message : 'Unknown decoding error.';
        alert('This audio file could not be opened. The file may be damaged or use an unsupported codec.\n\nDetails: ' + details);
    } finally {
        isLoadingAudio = false;
        chooseFileBtn.innerHTML = originalButtonContent;
        uploadSection.removeAttribute('aria-busy');
        uploadSection.removeAttribute('aria-disabled');
        if (window.lucide) window.lucide.createIcons();
    }
}

// ── Playback
async function play() {
    if (!audioBuffer) return;
    if (isPlaying) { pause(); return; }
    try {
        if (!window.Tone) throw new Error('The audio engine could not be loaded. Check your connection and reload the page.');
        await Tone.start();
        if (!tonePlayer) await buildToneGraph();
    } catch (err) {
        console.error('Playback error:', err);
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
    setVisualizerLive(false);
    drawWaveform();
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
    setVisualizerLive(false);
    drawWaveform();
}

function stop() {
    isPlaying = false;
    try { if (tonePlayer) tonePlayer.stop(); } catch(e){}
    pauseOffset = 0;
    showPlayIcon(); syncProgressUI(0);
    cancelAnimationFrame(progressRafId);
    cancelAnimationFrame(animationId);
    stopLevelMeter();
    setVisualizerLive(false);
    drawWaveform();
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
            toneDelay.wet.value = v / 100;
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
        if (!isApplyingPreset) markPresetCustom();
    });
    document.getElementById('eightDSpeed').addEventListener('input', e => {
        document.getElementById('eightDSpeedValue').textContent = parseFloat(e.target.value).toFixed(1);
        if (eightDEnabled) { stop8DAudio(); start8DAudio(); }
    });

    // Buttons
    playBtn.addEventListener('click', play);
    stopBtn.addEventListener('click', stop);
    resetBtn.addEventListener('click', () => applyPreset(presets.normal, 'normal'));

    // Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const presetName = btn.dataset.preset;
            const preset = presets[presetName];
            if (preset) applyPreset(preset, presetName);
        });
    });

    document.querySelectorAll('.preset-filter').forEach(filterBtn => {
        filterBtn.addEventListener('click', () => filterPresets(filterBtn.dataset.filter));
    });

    initializeInteractiveDesign();

    // Download
    downloadBtn.addEventListener('click', handleDownload);

    // Keyboard
    document.addEventListener('keydown', handleKeydown);

    // Resize
    window.addEventListener('resize', () => {
        resizeWaveformCanvas();
        if (!isPlaying) drawWaveform();
    });
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
function resizeWaveformCanvas() {
    if (!waveformCanvas) return { width: 1, height: 1, dpr: 1 };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = waveformCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (waveformCanvas.width !== width || waveformCanvas.height !== height) {
        waveformCanvas.width = width;
        waveformCanvas.height = height;
    }
    return { width, height, dpr };
}

function getVisualizerColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
        primary: styles.getPropertyValue('--vibe-primary').trim() || '#8b5cf6',
        secondary: styles.getPropertyValue('--vibe-secondary').trim() || '#22d3ee',
        light: document.documentElement.getAttribute('data-theme') === 'light'
    };
}

function drawVisualizerBackdrop(width, height, colors) {
    const background = waveformCtx.createLinearGradient(0, 0, width, height);
    if (colors.light) {
        background.addColorStop(0, '#eef0fb');
        background.addColorStop(0.5, '#e3e8f6');
        background.addColorStop(1, '#edf7fa');
    } else {
        background.addColorStop(0, '#070813');
        background.addColorStop(0.5, '#0c0d1b');
        background.addColorStop(1, '#071319');
    }
    waveformCtx.fillStyle = background;
    waveformCtx.fillRect(0, 0, width, height);

    waveformCtx.save();
    waveformCtx.strokeStyle = colors.light ? 'rgba(79,70,130,.09)' : 'rgba(255,255,255,.045)';
    waveformCtx.lineWidth = 1;
    const grid = Math.max(24, Math.round(width / 28));
    for (let x = 0; x <= width; x += grid) {
        waveformCtx.beginPath();
        waveformCtx.moveTo(x, 0);
        waveformCtx.lineTo(x, height);
        waveformCtx.stroke();
    }
    for (let y = 0; y <= height; y += grid) {
        waveformCtx.beginPath();
        waveformCtx.moveTo(0, y);
        waveformCtx.lineTo(width, y);
        waveformCtx.stroke();
    }
    waveformCtx.restore();
}

function setVisualizerLive(live) {
    const container = document.getElementById('visualizerContainer');
    const label = document.getElementById('visualizerMode');
    if (container) container.classList.toggle('is-live', live);
    if (label) label.textContent = live ? 'LIVE SPECTRUM' : 'TRACK WAVEFORM';
}

function drawVisualizerIdle() {
    if (!waveformCanvas || !waveformCtx) return;
    const { width, height, dpr } = resizeWaveformCanvas();
    const colors = getVisualizerColors();
    drawVisualizerBackdrop(width, height, colors);

    const center = height / 2;
    const barCount = 56;
    const gap = 3 * dpr;
    const barWidth = Math.max(2 * dpr, (width - gap * (barCount - 1)) / barCount);
    const gradient = waveformCtx.createLinearGradient(0, center - height * .25, 0, center + height * .25);
    gradient.addColorStop(0, colors.primary);
    gradient.addColorStop(1, colors.secondary);
    waveformCtx.fillStyle = gradient;
    waveformCtx.globalAlpha = .42;
    for (let i = 0; i < barCount; i++) {
        const envelope = Math.sin((i / (barCount - 1)) * Math.PI);
        const variation = .35 + .65 * Math.abs(Math.sin(i * 1.73));
        const barHeight = (6 * dpr) + envelope * variation * height * .22;
        const x = i * (barWidth + gap);
        waveformCtx.fillRect(x, center - barHeight, barWidth, barHeight * 2);
    }
    waveformCtx.globalAlpha = 1;
}

function drawWaveform() {
    if (!waveformCanvas || !waveformCtx) return;
    if (!audioBuffer) {
        drawVisualizerIdle();
        return;
    }

    setVisualizerLive(false);
    const { width, height, dpr } = resizeWaveformCanvas();
    const colors = getVisualizerColors();
    drawVisualizerBackdrop(width, height, colors);

    const data = audioBuffer.getChannelData(0);
    const columns = Math.max(160, Math.floor(width / (2 * dpr)));
    const step = Math.max(1, Math.floor(data.length / columns));
    const top = new Float32Array(columns);
    const bottom = new Float32Array(columns);

    for (let i = 0; i < columns; i++) {
        let min = 1;
        let max = -1;
        const start = i * step;
        const end = Math.min(data.length, start + step);
        const sampleStride = Math.max(1, Math.floor(step / 256));
        for (let j = start; j < end; j += sampleStride) {
            const sample = data[j];
            if (sample < min) min = sample;
            if (sample > max) max = sample;
        }
        top[i] = max;
        bottom[i] = min;
    }

    const center = height / 2;
    const amplitude = height * .38;
    const xStep = width / Math.max(1, columns - 1);
    const fill = waveformCtx.createLinearGradient(0, center - amplitude, 0, center + amplitude);
    fill.addColorStop(0, colors.primary);
    fill.addColorStop(.48, colors.secondary);
    fill.addColorStop(.52, colors.secondary);
    fill.addColorStop(1, colors.primary);

    waveformCtx.save();
    waveformCtx.beginPath();
    waveformCtx.moveTo(0, center - top[0] * amplitude);
    for (let i = 1; i < columns; i++) waveformCtx.lineTo(i * xStep, center - top[i] * amplitude);
    for (let i = columns - 1; i >= 0; i--) waveformCtx.lineTo(i * xStep, center - bottom[i] * amplitude);
    waveformCtx.closePath();
    waveformCtx.fillStyle = fill;
    waveformCtx.globalAlpha = colors.light ? .62 : .72;
    waveformCtx.shadowColor = colors.primary;
    waveformCtx.shadowBlur = 22 * dpr;
    waveformCtx.fill();
    waveformCtx.restore();

    waveformCtx.strokeStyle = colors.light ? 'rgba(50,45,90,.24)' : 'rgba(255,255,255,.18)';
    waveformCtx.lineWidth = dpr;
    waveformCtx.beginPath();
    waveformCtx.moveTo(0, center);
    waveformCtx.lineTo(width, center);
    waveformCtx.stroke();
}

function visualize() {
    if (!waveformCanvas || !waveformCtx || !analyserNode) return;
    setVisualizerLive(true);

    const frequencyData = new Uint8Array(analyserNode.frequencyBinCount);
    const waveformData = new Uint8Array(analyserNode.frequencyBinCount);

    function draw() {
        if (!isPlaying) return;
        animationId = requestAnimationFrame(draw);

        const { width, height, dpr } = resizeWaveformCanvas();
        const colors = getVisualizerColors();
        analyserNode.getByteFrequencyData(frequencyData);
        analyserNode.getByteTimeDomainData(waveformData);
        drawVisualizerBackdrop(width, height, colors);

        let bassEnergy = 0;
        const bassBins = Math.min(24, frequencyData.length);
        for (let i = 0; i < bassBins; i++) bassEnergy += frequencyData[i];
        bassEnergy = bassEnergy / Math.max(1, bassBins) / 255;

        const glow = waveformCtx.createRadialGradient(width * .5, height * .5, 0, width * .5, height * .5, width * .55);
        glow.addColorStop(0, colors.secondary);
        glow.addColorStop(1, 'transparent');
        waveformCtx.fillStyle = glow;
        waveformCtx.globalAlpha = .05 + bassEnergy * .15;
        waveformCtx.fillRect(0, 0, width, height);
        waveformCtx.globalAlpha = 1;

        const barCount = Math.max(36, Math.min(92, Math.floor(width / (9 * dpr))));
        const gap = 3 * dpr;
        const barWidth = Math.max(2 * dpr, (width - gap * (barCount - 1)) / barCount);
        const usableBins = Math.floor(frequencyData.length * .58);
        const binStep = usableBins / barCount;
        const center = height / 2;
        const barsGradient = waveformCtx.createLinearGradient(0, center - height * .42, 0, center + height * .42);
        barsGradient.addColorStop(0, colors.primary);
        barsGradient.addColorStop(.5, colors.secondary);
        barsGradient.addColorStop(1, colors.primary);

        waveformCtx.save();
        waveformCtx.fillStyle = barsGradient;
        waveformCtx.shadowColor = colors.secondary;
        waveformCtx.shadowBlur = 12 * dpr;
        for (let i = 0; i < barCount; i++) {
            const bin = Math.min(frequencyData.length - 1, Math.floor(i * binStep));
            const value = frequencyData[bin] / 255;
            const shaped = Math.pow(value, .72);
            const barHeight = 3 * dpr + shaped * height * .38;
            const x = i * (barWidth + gap);
            waveformCtx.globalAlpha = .28 + shaped * .72;
            waveformCtx.fillRect(x, center - barHeight, barWidth, barHeight * 2);
        }
        waveformCtx.restore();

        const waveGradient = waveformCtx.createLinearGradient(0, 0, width, 0);
        waveGradient.addColorStop(0, colors.primary);
        waveGradient.addColorStop(.5, '#ffffff');
        waveGradient.addColorStop(1, colors.secondary);
        waveformCtx.beginPath();
        for (let x = 0; x < width; x += Math.max(1, dpr * 2)) {
            const index = Math.min(waveformData.length - 1, Math.floor((x / width) * waveformData.length));
            const value = (waveformData[index] - 128) / 128;
            const y = center + value * height * .19;
            if (x === 0) waveformCtx.moveTo(x, y);
            else waveformCtx.lineTo(x, y);
        }
        waveformCtx.strokeStyle = waveGradient;
        waveformCtx.lineWidth = 2 * dpr;
        waveformCtx.shadowColor = colors.primary;
        waveformCtx.shadowBlur = 12 * dpr;
        waveformCtx.stroke();
        waveformCtx.shadowBlur = 0;
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
    normal:       { label:'Normal',       speed:1.00, pitch: 0.0, volume:100, bass: 0, treble: 0, pan:  0, reverb: 0, echo: 0, eightD:false, colors:['#8b5cf6','#22d3ee'] },
    nightcore:    { label:'Nightcore',    speed:1.30, pitch: 3.0, volume:100, bass: 1, treble: 6, pan:  0, reverb: 8, echo: 0, eightD:false, colors:['#ff56c7','#22d3ee'] },
    deepbass:     { label:'Deep Bass',    speed:0.90, pitch:-3.0, volume:110, bass:15, treble:-5,pan:  0, reverb:10, echo: 5, eightD:false, colors:['#7c3aed','#f43f5e'] },
    '8daudio':    { label:'8D Orbit',      speed:1.00, pitch: 0.0, volume:100, bass: 3, treble: 2, pan:  0, reverb:24, echo:15, eightD:true,  colors:['#06b6d4','#8b5cf6'] },
    concert:      { label:'Concert Hall',  speed:1.00, pitch: 0.0, volume:103, bass: 7, treble: 4, pan:  0, reverb:58, echo:20, eightD:false, colors:['#f59e0b','#ec4899'] },
    slowcore:     { label:'Slowcore',      speed:0.72, pitch:-2.0, volume:100, bass: 5, treble:-2,pan:  0, reverb:62, echo:12, eightD:false, colors:['#6366f1','#94a3b8'] },
    lofi:         { label:'Lo-Fi',         speed:0.92, pitch:-1.0, volume: 95, bass: 7, treble:-5,pan: -6, reverb:25, echo: 8, eightD:false, colors:['#f59e0b','#84cc16'] },
    vaporwave:    { label:'Vaporwave',     speed:0.80, pitch:-4.0, volume:100, bass: 5, treble: 0, pan: 12, reverb:48, echo:18, eightD:false, colors:['#ff56c7','#22d3ee'] },
    phonecall:    { label:'Phone Call',    speed:1.00, pitch: 2.0, volume: 96, bass: 0, treble: 9, pan:  0, reverb: 3, echo: 0, eightD:false, colors:['#10b981','#facc15'] },
    underwater:   { label:'Underwater',    speed:0.85, pitch:-5.0, volume:100, bass:10, treble:-9,pan: -8, reverb:78, echo:30, eightD:false, colors:['#0284c7','#22d3ee'] },
    hyperpop:     { label:'Hyperpop',      speed:1.15, pitch: 4.0, volume:104, bass: 4, treble:10, pan:  0, reverb:16, echo: 0, eightD:false, colors:['#f43f5e','#a855f7'] },
    cinematic:    { label:'Cinematic',     speed:0.92, pitch:-2.0, volume:105, bass:11, treble: 3, pan:  0, reverb:55, echo: 0, eightD:false, colors:['#f97316','#7c3aed'] },
    dreamscape:   { label:'Dreamscape',    speed:0.82, pitch:-3.0, volume: 94, bass: 3, treble: 2, pan: 10, reverb:74, echo: 0, eightD:false, colors:['#818cf8','#f0abfc'] },
    cathedral:    { label:'Cathedral',     speed:1.00, pitch: 0.0, volume:100, bass: 2, treble: 5, pan:  0, reverb:92, echo: 0, eightD:false, colors:['#fbbf24','#a78bfa'] },
    subterranean: { label:'Subterranean',  speed:0.68, pitch:-7.0, volume:112, bass:20, treble:-10,pan: 0, reverb:18, echo: 0, eightD:false, colors:['#ef4444','#581c87'] },
    crystal:      { label:'Crystal',       speed:1.05, pitch: 5.0, volume: 96, bass: 0, treble:13, pan:  6, reverb:34, echo: 0, eightD:false, colors:['#67e8f9','#c4b5fd'] },
    alienradio:   { label:'Alien Radio',   speed:1.10, pitch: 7.0, volume: 98, bass: 1, treble:11, pan:-18, reverb:14, echo: 0, eightD:true,  colors:['#84cc16','#22d3ee'] },
    tapewarmth:   { label:'Tape Warmth',   speed:0.96, pitch:-0.5, volume: 97, bass: 6, treble:-4,pan: -4, reverb:12, echo: 0, eightD:false, colors:['#fb923c','#eab308'] },
    slowedreverb: { label:'Slowed + Reverb', speed:0.85, pitch: 0.0, volume:100, bass: 0, treble: 0, pan: 0, reverb:50, echo: 0, eightD:false, colors:['#8b5cf6','#38bdf8'] },
    softslowed:   { label:'Soft Slowed',      speed:0.92, pitch: 0.0, volume:100, bass: 0, treble: 0, pan: 0, reverb:30, echo: 0, eightD:false, colors:['#a78bfa','#67e8f9'] },
    deepslowed:   { label:'Deep Slowed',      speed:0.75, pitch: 0.0, volume:100, bass: 0, treble: 0, pan: 0, reverb:65, echo: 0, eightD:false, colors:['#6366f1','#0ea5e9'] },
    ultraslowed:  { label:'Ultra Slowed',     speed:0.65, pitch: 0.0, volume:100, bass: 0, treble: 0, pan: 0, reverb:82, echo: 0, eightD:false, colors:['#4f46e5','#7dd3fc'] }
};

function formatPanValue(value) {
    const absolute = Math.abs(value).toFixed(1);
    if (value === 0) return 'Center';
    return value < 0 ? absolute + '% Left' : absolute + '% Right';
}

function updateRangeFill(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const value = parseFloat(slider.value);
    const progress = max === min ? 0 : ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--range-progress', progress.toFixed(2) + '%');
}

function updateAllRangeFills() {
    document.querySelectorAll('input[type="range"]').forEach(updateRangeFill);
}

function markPresetCustom() {
    if (isApplyingPreset || currentPresetName === 'custom') return;
    currentPresetName = 'custom';
    if (activePresetNameEl) activePresetNameEl.textContent = 'Custom';
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
    });
}

function setActivePreset(presetName, preset) {
    currentPresetName = presetName;
    if (activePresetNameEl) activePresetNameEl.textContent = preset.label;
    document.querySelectorAll('.preset-btn').forEach(btn => {
        const isActive = btn.dataset.preset === presetName;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    document.documentElement.style.setProperty('--vibe-primary', preset.colors[0]);
    document.documentElement.style.setProperty('--vibe-secondary', preset.colors[1]);
    document.body.dataset.vibe = presetName;

    if (presetToastNameEl) presetToastNameEl.textContent = preset.label;
    if (presetToast) {
        clearTimeout(presetToastTimer);
        presetToast.classList.remove('visible');
        requestAnimationFrame(() => presetToast.classList.add('visible'));
        presetToastTimer = setTimeout(() => presetToast.classList.remove('visible'), 1500);
    }

    document.body.classList.remove('preset-switching');
    requestAnimationFrame(() => {
        document.body.classList.add('preset-switching');
        setTimeout(() => document.body.classList.remove('preset-switching'), 720);
    });
}

function filterPresets(filterName) {
    document.querySelectorAll('.preset-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filterName);
    });
    document.querySelectorAll('.preset-btn').forEach((btn, index) => {
        const shouldShow = filterName === 'all' || btn.dataset.category === filterName;
        btn.classList.toggle('is-hidden', !shouldShow);
        if (shouldShow) btn.style.setProperty('--reveal-delay', (index % 6) * 35 + 'ms');
    });
}

function applyPreset(preset, presetName = 'normal') {
    isApplyingPreset = true;

    setPlaybackSpeed(preset.speed);
    document.getElementById('pitchSlider').value  = preset.pitch;
    document.getElementById('pitchValue').textContent = preset.pitch.toFixed(1) + ' st';
    document.getElementById('volumeSlider').value = preset.volume;
    document.getElementById('volumeValue').textContent = preset.volume.toFixed(1) + '%';
    document.getElementById('bassSlider').value   = preset.bass;
    document.getElementById('bassValue').textContent  = preset.bass.toFixed(1) + ' dB';
    document.getElementById('trebleSlider').value = preset.treble;
    document.getElementById('trebleValue').textContent = preset.treble.toFixed(1) + ' dB';
    document.getElementById('panSlider').value    = preset.pan;
    document.getElementById('panValue').textContent = formatPanValue(preset.pan);
    document.getElementById('reverbSlider').value = preset.reverb;
    document.getElementById('reverbValue').textContent = preset.reverb.toFixed(1) + '%';
    document.getElementById('echoSlider').value = preset.echo;
    document.getElementById('echoValue').textContent = preset.echo.toFixed(1) + '%';

    if (toneGain)       toneGain.gain.value         = preset.volume / 100;
    if (toneBass)       toneBass.gain.value          = preset.bass;
    if (toneTreble)     toneTreble.gain.value        = preset.treble;
    if (tonePan && !preset.eightD) tonePan.pan.value = preset.pan / 100;
    if (toneDelay) {
        toneDelay.wet.value = preset.echo / 100;
        toneDelay.feedback.value = Math.min(0.55, preset.echo / 100 * 0.5);
    }
    if (toneReverb)     toneReverb.wet.value         = preset.reverb / 100;
    if (tonePitchShift) tonePitchShift.pitch         = preset.pitch;

    if (preset.eightD && !eightDEnabled)      eightDToggle.click();
    else if (!preset.eightD && eightDEnabled) eightDToggle.click();

    updateAllRangeFills();
    syncProgressUI();
    setActivePreset(presetName, preset);
    isApplyingPreset = false;
}

function initializeInteractiveDesign() {
    updateAllRangeFills();

    document.querySelectorAll('input[type="range"]').forEach(slider => {
        slider.addEventListener('input', () => {
            updateRangeFill(slider);
            markPresetCustom();
        });
    });

    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (finePointer && !reducedMotion) {
        document.addEventListener('pointermove', event => {
            lastPointerX = event.clientX;
            lastPointerY = event.clientY;
            if (pointerRafId) return;
            pointerRafId = requestAnimationFrame(() => {
                document.documentElement.style.setProperty('--pointer-x', lastPointerX + 'px');
                document.documentElement.style.setProperty('--pointer-y', lastPointerY + 'px');
                pointerRafId = null;
            });
        });

        document.querySelectorAll('.control-group, .preset-btn').forEach(card => {
            card.addEventListener('pointermove', event => {
                const rect = card.getBoundingClientRect();
                const x = (event.clientX - rect.left) / rect.width;
                const y = (event.clientY - rect.top) / rect.height;
                card.style.setProperty('--glow-x', (x * 100).toFixed(1) + '%');
                card.style.setProperty('--glow-y', (y * 100).toFixed(1) + '%');
                card.style.setProperty('--tilt-x', ((0.5 - y) * 5).toFixed(2) + 'deg');
                card.style.setProperty('--tilt-y', ((x - 0.5) * 6).toFixed(2) + 'deg');
            });
            card.addEventListener('pointerleave', () => {
                card.style.setProperty('--tilt-x', '0deg');
                card.style.setProperty('--tilt-y', '0deg');
            });
        });
    }
}

// ── Export / Download
async function handleDownload() {
    if (!audioBuffer) { alert('Load an audio file first.'); return; }

    const formatSelect = document.getElementById('exportFormat');
    const exportFormat = formatSelect ? formatSelect.value : 'wav';

    try {
        downloadBtn.querySelector('span').textContent = 'Rendering...';
        downloadBtn.disabled = true;
        if (formatSelect) formatSelect.disabled = true;

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

        const echoV = parseFloat(document.getElementById('echoSlider').value) / 100;
        const revV = parseFloat(document.getElementById('reverbSlider').value) / 100;
        const tailSeconds = Math.max(revV > 0 ? 2.25 : 0, echoV > 0 ? 3 : 0);
        const finalLen = Math.ceil(pitchedBuf.length / speed + tailSeconds * sr);
        const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offCtx = new OfflineContext(2, finalLen, sr);
        const src      = offCtx.createBufferSource();
        src.buffer     = pitchedBuf;
        src.playbackRate.value = speed;

        const bass   = offCtx.createBiquadFilter(); bass.type='lowshelf';  bass.frequency.value=200;  bass.gain.value=parseFloat(document.getElementById('bassSlider').value);
        const treble = offCtx.createBiquadFilter(); treble.type='highshelf'; treble.frequency.value=3000; treble.gain.value=parseFloat(document.getElementById('trebleSlider').value);
        const pan    = offCtx.createStereoPanner ? offCtx.createStereoPanner() : null;
        if (pan && !eightDEnabled) pan.pan.value = parseFloat(document.getElementById('panSlider').value) / 100;
        const gainN  = offCtx.createGain(); gainN.gain.value = parseFloat(document.getElementById('volumeSlider').value) / 100;

        const delay = offCtx.createDelay(5.0); delay.delayTime.value = 0.3;
        const delayFeedback = offCtx.createGain(); delayFeedback.gain.value = Math.min(0.55, echoV * 0.5);
        const echoWet = offCtx.createGain(); echoWet.gain.value = echoV;
        const echoBus = offCtx.createGain();

        const conv   = offCtx.createConvolver();
        const rDry   = offCtx.createGain();
        const rWet   = offCtx.createGain();
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

        gainN.connect(echoBus);
        if (echoV > 0) {
            gainN.connect(delay);
            delay.connect(delayFeedback);
            delayFeedback.connect(delay);
            delay.connect(echoWet);
            echoWet.connect(echoBus);
        }

        const merger = offCtx.createGain();
        echoBus.connect(rDry); rDry.connect(merger);
        if (revV > 0) { echoBus.connect(conv); conv.connect(rWet); rWet.connect(merger); }
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

        const fx = [];
        if (speed !== 1.0) fx.push(speed + 'x');
        if (pitch !== 0) fx.push((pitch > 0 ? '+' : '') + pitch + 'st');
        if (revV > 0) fx.push('reverb');
        if (echoV > 0) fx.push('echo');

        let outputBlob;
        let extension;
        if (exportFormat.startsWith('mp3-')) {
            const bitrate = parseInt(exportFormat.split('-')[1], 10) || 320;
            downloadBtn.querySelector('span').textContent = 'Preparing MP3...';
            const mp3Buffer = await resampleAudioBuffer(rendered, 44100);
            outputBlob = await audioBufferToMp3(mp3Buffer, bitrate);
            extension = 'mp3';
        } else {
            outputBlob = new Blob([audioBufferToWav(rendered)], { type: 'audio/wav' });
            extension = 'wav';
        }

        const baseName = currentFileName.replace(/\.[^/.]+$/, '');
        const fileName = 'edited_' + baseName + (fx.length ? '_' + fx.join('_') : '') + '.' + extension;
        downloadBlob(outputBlob, fileName);
    } catch(err) {
        console.error('Export error:', err);
        alert('Export failed: ' + err.message);
    } finally {
        downloadBtn.querySelector('span').textContent = 'Export';
        downloadBtn.disabled = false;
        if (formatSelect) formatSelect.disabled = false;
    }
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function resampleAudioBuffer(buffer, targetSampleRate) {
    if (buffer.sampleRate === targetSampleRate) return buffer;
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) throw new Error('This browser does not support the feature required for MP3 export.');

    const frameCount = Math.ceil(buffer.duration * targetSampleRate);
    const context = new OfflineContext(Math.min(2, buffer.numberOfChannels), frameCount, targetSampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
    return context.startRendering();
}

function floatToInt16(floatData) {
    const pcm = new Int16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
        const sample = Math.max(-1, Math.min(1, floatData[i]));
        pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return pcm;
}

async function audioBufferToMp3(buffer, bitrate) {
    if (!window.lamejs || !window.lamejs.Mp3Encoder) {
        throw new Error('The MP3 encoder could not be loaded. Check your connection and try again.');
    }

    const channels = Math.min(2, buffer.numberOfChannels);
    const encoder = new window.lamejs.Mp3Encoder(channels, buffer.sampleRate, bitrate);
    const left = floatToInt16(buffer.getChannelData(0));
    const right = channels > 1 ? floatToInt16(buffer.getChannelData(1)) : left;
    const blockSize = 1152;
    const mp3Chunks = [];
    const totalBlocks = Math.ceil(left.length / blockSize);

    for (let offset = 0, block = 0; offset < left.length; offset += blockSize, block++) {
        const leftChunk = left.subarray(offset, Math.min(offset + blockSize, left.length));
        const rightChunk = right.subarray(offset, Math.min(offset + blockSize, right.length));
        const encoded = channels > 1
            ? encoder.encodeBuffer(leftChunk, rightChunk)
            : encoder.encodeBuffer(leftChunk);
        if (encoded.length) mp3Chunks.push(new Uint8Array(encoded));

        if (block % 48 === 0) {
            const progress = Math.min(99, Math.round((block / Math.max(1, totalBlocks)) * 100));
            downloadBtn.querySelector('span').textContent = 'MP3 ' + progress + '%';
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }

    const flushed = encoder.flush();
    if (flushed.length) mp3Chunks.push(new Uint8Array(flushed));
    return new Blob(mp3Chunks, { type: 'audio/mpeg' });
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

console.log('🎵 Audio Editor — Tone.js PitchShift (real phase vocoder) ✅');