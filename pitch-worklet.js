/**
 * pitch-worklet.js — Phase Vocoder pitch shifter
 * Runs inside an AudioWorkletProcessor (separate thread).
 * AudioParams:
 *   pitch  — ratio (1.0 = no shift, 2.0 = +1 octave, 0.5 = -1 octave)
 *   tempo  — playback speed ratio (1.0 = normal)
 *
 * Algorithm: time-domain OLA (Overlap-Add) with phase-locked vocoder.
 * Frame size: 2048, hop: 512. Latency ≈ 46 ms @ 44100 Hz.
 */
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0, automationRate: 'k-rate' },
      { name: 'tempo', defaultValue: 1.0, minValue: 0.1,  maxValue: 4.0, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this._frameSize = 2048;
    this._hopSize   = 512;
    this._overlap   = this._frameSize / this._hopSize; // 4

    // Input ring buffer
    this._inBuf  = new Float32Array(this._frameSize * 4);
    this._inPos  = 0;
    this._inFill = 0;

    // Output ring buffer
    this._outBuf = new Float32Array(this._frameSize * 8);
    this._outPos = 0;
    this._outFill = 0;

    // Phase vocoder state
    this._lastPhase  = new Float32Array(this._frameSize);
    this._phaseAccum = new Float32Array(this._frameSize);

    // Hann window
    this._window = new Float32Array(this._frameSize);
    for (let i = 0; i < this._frameSize; i++) {
      this._window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (this._frameSize - 1)));
    }

    // FFT buffers (Cooley-Tukey in-place)
    this._fftRe  = new Float32Array(this._frameSize);
    this._fftIm  = new Float32Array(this._frameSize);
    this._fftRe2 = new Float32Array(this._frameSize);
    this._fftIm2 = new Float32Array(this._frameSize);

    // How many input samples to consume per output hop (tempo stretch)
    this._inputHopAccum = 0;
  }

  // ── Cooley-Tukey FFT (in-place, size must be power of 2) ──────────────────
  _fft(re, im, inverse) {
    const n = re.length;
    // Bit-reversal
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    // Butterfly
    for (let len = 2; len <= n; len <<= 1) {
      const ang = 2 * Math.PI / len * (inverse ? -1 : 1);
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curRe = 1, curIm = 0;
        for (let j = 0; j < len / 2; j++) {
          const uRe = re[i+j],          uIm = im[i+j];
          const vRe = re[i+j+len/2] * curRe - im[i+j+len/2] * curIm;
          const vIm = re[i+j+len/2] * curIm + im[i+j+len/2] * curRe;
          re[i+j]         = uRe + vRe;  im[i+j]         = uIm + vIm;
          re[i+j+len/2]   = uRe - vRe;  im[i+j+len/2]   = uIm - vIm;
          const tmpRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe; curRe = tmpRe;
        }
      }
    }
    if (inverse) { for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; } }
  }

  // ── Process one frame of frameSize samples ─────────────────────────────────
  _processFrame(pitch) {
    const N    = this._frameSize;
    const hop  = this._hopSize;
    const pi2  = 2 * Math.PI;
    const re   = this._fftRe;
    const im   = this._fftIm;
    const re2  = this._fftRe2;
    const im2  = this._fftIm2;
    const win  = this._window;
    const last = this._lastPhase;
    const accum= this._phaseAccum;

    // Copy windowed frame into FFT buffers
    for (let i = 0; i < N; i++) {
      const idx = (this._inPos - N + i + this._inBuf.length) % this._inBuf.length;
      re[i] = this._inBuf[idx] * win[i];
      im[i] = 0;
    }

    this._fft(re, im, false);

    // Phase vocoder: compute true frequency, shift bins
    re2.fill(0); im2.fill(0);
    const pitchBins = Math.round(pitch * N) - N; // bin shift
    // Simpler approach: direct bin resampling
    for (let k = 0; k < N / 2; k++) {
      const magnitude = Math.sqrt(re[k]*re[k] + im[k]*im[k]);
      const phase     = Math.atan2(im[k], re[k]);

      // True frequency via phase difference
      let dphi = phase - last[k] - pi2 * hop * k / N;
      // Wrap to [-π, π]
      dphi -= pi2 * Math.round(dphi / pi2);
      const trueFreq = pi2 * k / N + dphi / hop;

      last[k]   = phase;
      accum[k] += hop * trueFreq * pitch;

      // Target bin after pitch shift
      const tk = Math.round(k * pitch);
      if (tk >= 0 && tk < N / 2) {
        re2[tk] += magnitude * Math.cos(accum[k]);
        im2[tk] += magnitude * Math.sin(accum[k]);
        // Mirror
        re2[N - tk] = re2[tk];
        im2[N - tk] = -im2[tk];
      }
    }

    this._fft(re2, im2, true);

    // Overlap-add into output buffer
    const gain = 1 / (this._overlap * 0.5);
    for (let i = 0; i < N; i++) {
      const outIdx = (this._outPos + i) % this._outBuf.length;
      this._outBuf[outIdx] += re2[i] * win[i] * gain;
    }
    this._outFill += hop;
    this._outPos   = (this._outPos + hop) % this._outBuf.length;
  }

  process(inputs, outputs, parameters) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const inp   = input[0];
    const out   = output[0];
    const pitch = parameters.pitch[0];
    const tempo = parameters.tempo[0];
    const block = inp.length; // 128
    const N     = this._frameSize;
    const hop   = this._hopSize;

    // Write input samples
    for (let i = 0; i < block; i++) {
      this._inBuf[this._inPos] = inp[i];
      this._inPos = (this._inPos + 1) % this._inBuf.length;
      this._inFill++;

      // Accumulate input hop scaled by tempo
      this._inputHopAccum += tempo;
      if (this._inputHopAccum >= hop && this._inFill >= N) {
        this._inputHopAccum -= hop;
        this._processFrame(pitch);
        // Consume input hop
        this._inFill = Math.max(0, this._inFill - hop);
      }
    }

    // Read output
    const readPos = (this._outPos - this._outFill + this._outBuf.length * 2) % this._outBuf.length;
    for (let i = 0; i < block; i++) {
      if (this._outFill > 0) {
        const idx = (readPos + i) % this._outBuf.length;
        out[i] = this._outBuf[idx];
        this._outBuf[idx] = 0; // clear after reading
        if (i === block - 1) this._outFill = Math.max(0, this._outFill - block);
      } else {
        out[i] = 0;
      }
    }

    return true;
  }
}

registerProcessor('pitch-shift-processor', PitchShiftProcessor);
