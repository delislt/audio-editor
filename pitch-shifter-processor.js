// Phase Vocoder — pitch shift sem alterar a velocidade
// Bugs corrigidos:
//   - contadores de posição (inWrite, outRead, outWrite) por canal
//   - buffers real/imag/synth por canal (sem cross-talk L/R)
//   - normalização OLA correta
//   - bypass direto quando pitchRatio ≈ 1.0

class PitchShifterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [{
            name: 'pitchRatio',
            defaultValue: 1.0,
            minValue: 0.25,
            maxValue: 4.0,
            automationRate: 'k-rate',
        }];
    }

    constructor() {
        super();
        this._frameSize = 2048;
        this._hopSize   = 512;          // 75% overlap
        this._maxCh     = 2;
        this._bufLen    = this._frameSize * 4;  // potência de 2
        this._mask      = this._bufLen - 1;

        // Janela Hann
        const fs = this._frameSize;
        this._win = new Float32Array(fs);
        for (let i = 0; i < fs; i++)
            this._win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / fs));

        // Factor de normalização OLA: 1 / (soma das win² por hop)
        // Para Hann com 75% overlap o factor teórico é ~= hopSize / (3/8 * frameSize)
        // Calculamos numericamente para ser exacto:
        const hopSize = this._hopSize;
        const winNorm = new Float32Array(fs);
        for (let shift = 0; shift < fs; shift += hopSize)
            for (let i = 0; i < fs; i++)
                winNorm[(i + shift) % fs] += this._win[i] * this._win[i];
        this._winNorm = winNorm; // divide output por este valor

        // Buffers POR CANAL
        this._inBuf      = Array.from({length: this._maxCh}, () => new Float32Array(this._bufLen));
        this._outBuf     = Array.from({length: this._maxCh}, () => new Float32Array(this._bufLen));
        this._normBuf    = Array.from({length: this._maxCh}, () => new Float32Array(this._bufLen));

        // Contadores POR CANAL
        this._inWrite  = new Int32Array(this._maxCh);  // cabeça de escrita entrada
        this._outRead  = new Int32Array(this._maxCh);  // cabeça de leitura saída
        this._outWrite = new Int32Array(this._maxCh);  // cabeça de escrita saída

        // FFT buffers POR CANAL
        this._real      = Array.from({length: this._maxCh}, () => new Float32Array(fs));
        this._imag      = Array.from({length: this._maxCh}, () => new Float32Array(fs));
        this._synthReal = Array.from({length: this._maxCh}, () => new Float32Array(fs));
        this._synthImag = Array.from({length: this._maxCh}, () => new Float32Array(fs));

        // Fases POR CANAL
        this._lastPhase  = Array.from({length: this._maxCh}, () => new Float32Array(fs));
        this._phaseAccum = Array.from({length: this._maxCh}, () => new Float32Array(fs));
    }

    // FFT in-place Cooley-Tukey radix-2
    _fft(real, imag, inverse) {
        const n = real.length;
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                let t = real[i]; real[i] = real[j]; real[j] = t;
                t = imag[i]; imag[i] = imag[j]; imag[j] = t;
            }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = 2 * Math.PI / len * (inverse ? -1 : 1);
            const wRe = Math.cos(ang), wIm = Math.sin(ang);
            for (let i = 0; i < n; i += len) {
                let curRe = 1, curIm = 0;
                for (let j = 0; j < len >> 1; j++) {
                    const uRe = real[i+j], uIm = imag[i+j];
                    const vRe = real[i+j+(len>>1)] * curRe - imag[i+j+(len>>1)] * curIm;
                    const vIm = real[i+j+(len>>1)] * curIm + imag[i+j+(len>>1)] * curRe;
                    real[i+j]          = uRe + vRe;  imag[i+j]          = uIm + vIm;
                    real[i+j+(len>>1)] = uRe - vRe;  imag[i+j+(len>>1)] = uIm - vIm;
                    const nr = curRe * wRe - curIm * wIm;
                    curIm = curRe * wIm + curIm * wRe;
                    curRe = nr;
                }
            }
        }
        if (inverse) { for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; } }
    }

    _processFrame(ch, pitchRatio) {
        const fs   = this._frameSize;
        const hop  = this._hopSize;
        const win  = this._win;
        const mask = this._mask;
        const iw   = this._inWrite[ch];

        const real      = this._real[ch];
        const imag      = this._imag[ch];
        const synthReal = this._synthReal[ch];
        const synthImag = this._synthImag[ch];

        // Janela de análise
        for (let i = 0; i < fs; i++) {
            real[i] = this._inBuf[ch][(iw - fs + i) & mask] * win[i];
            imag[i] = 0;
        }

        this._fft(real, imag, false);

        // Zera buffers de síntese
        synthReal.fill(0);
        synthImag.fill(0);

        // Phase vocoder: realoca bins
        for (let k = 0; k < fs; k++) {
            const mag   = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
            const phase = Math.atan2(imag[k], real[k]);

            const expectedPhase = (2 * Math.PI * hop * k) / fs;
            let delta = phase - this._lastPhase[ch][k] - expectedPhase;
            delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI));
            const trueFreq = expectedPhase + delta;
            this._lastPhase[ch][k] = phase;

            const tb = Math.round(k * pitchRatio);
            if (tb >= 0 && tb < fs) {
                this._phaseAccum[ch][tb] += trueFreq * pitchRatio;
                const ph = this._phaseAccum[ch][tb];
                synthReal[tb] += mag * Math.cos(ph);
                synthImag[tb] += mag * Math.sin(ph);
            }
        }

        this._fft(synthReal, synthImag, true);

        // Overlap-add com janela de síntese + acumula normBuf
        const ow   = this._outWrite[ch];
        for (let i = 0; i < fs; i++) {
            const idx = (ow + i) & mask;
            this._outBuf[ch][idx]  += synthReal[i] * win[i];
            this._normBuf[ch][idx] += win[i] * win[i];
        }
    }

    process(inputs, outputs, parameters) {
        const input  = inputs[0];
        const output = outputs[0];
        if (!input || !input.length || !input[0].length) return true;

        const pitchRatio = parameters.pitchRatio[0];
        const bypass     = Math.abs(pitchRatio - 1.0) < 0.001;
        const numCh      = Math.min(input.length, this._maxCh, output.length);
        const blockSize  = input[0].length;   // 128
        const hop        = this._hopSize;
        const mask       = this._mask;

        for (let ch = 0; ch < numCh; ch++) {
            const inp = input[ch];
            const out = output[ch];

            if (bypass) {
                // Bypass direto: sem latência, sem degradação
                for (let i = 0; i < blockSize; i++) out[i] = inp[i];
                continue;
            }

            // Escreve no ring-buffer de entrada
            for (let i = 0; i < blockSize; i++) {
                this._inBuf[ch][this._inWrite[ch] & mask] = inp[i];
                this._inWrite[ch]++;

                // A cada hop amostras escritas, processa um frame
                if ((this._inWrite[ch] % hop) === 0) {
                    this._processFrame(ch, pitchRatio);
                    this._outWrite[ch] += hop;  // avança o ponteiro de escrita
                }
            }

            // Lê amostras do buffer de saída com normalização OLA
            for (let i = 0; i < blockSize; i++) {
                const idx  = this._outRead[ch] & mask;
                const norm = this._normBuf[ch][idx];
                out[i] = norm > 1e-6 ? this._outBuf[ch][idx] / norm : 0;
                this._outBuf[ch][idx]  = 0;
                this._normBuf[ch][idx] = 0;
                this._outRead[ch]++;
            }
        }

        return true;
    }
}

registerProcessor('pitch-shifter-processor', PitchShifterProcessor);
