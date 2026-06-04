// Phase Vocoder — pitch shift sem alterar a velocidade (Time-Scale Modification)
// Implementação OLA (Overlap-Add) com janela Hann e correção de fase.
//
// Parâmetros:
//   pitchRatio  — razão de transposição (ex.: 2^(semitones/12))
//                 1.0 = sem mudança, 2.0 = oitava acima, 0.5 = oitava abaixo

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
        this._frameSize    = 2048;
        this._hopSize      = 512;   // 75% overlap (4 frames)
        this._overlap      = this._frameSize / this._hopSize; // 4

        // Janela de análise/síntese Hann
        this._window = new Float32Array(this._frameSize);
        for (let i = 0; i < this._frameSize; i++) {
            this._window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / this._frameSize));
        }

        // Buffers de entrada / saída por canal (máx. estéreo)
        this._maxChannels = 2;
        this._inBuf   = Array.from({ length: this._maxChannels }, () => new Float32Array(this._frameSize * 4));
        this._outBuf  = Array.from({ length: this._maxChannels }, () => new Float32Array(this._frameSize * 4));
        this._inWrite  = 0;  // cabeça de escrita no ring-buffer de entrada
        this._inRead   = 0;  // cabeça de leitura (posição fracionária no src)
        this._outRead  = 0;  // amostras prontas para leitura na saída
        this._outWrite = 0;  // cabeça de escrita na saída
        this._bufMask  = this._frameSize * 4 - 1;

        // Fases para correção de fase entre frames (por canal)
        this._lastPhase    = Array.from({ length: this._maxChannels }, () => new Float32Array(this._frameSize));
        this._phaseAccum   = Array.from({ length: this._maxChannels }, () => new Float32Array(this._frameSize));

        // Buffers temporários para FFT
        this._analysisFrame = new Float32Array(this._frameSize);
        this._synthFrame    = new Float32Array(this._frameSize);
        this._real = new Float32Array(this._frameSize);
        this._imag = new Float32Array(this._frameSize);
    }

    // FFT in-place (Cooley-Tukey, radix-2, iterativo)
    _fft(real, imag, inverse) {
        const n = real.length;
        // Bit-reversal
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                [real[i], real[j]] = [real[j], real[i]];
                [imag[i], imag[j]] = [imag[j], imag[i]];
            }
        }
        // Butterfly
        for (let len = 2; len <= n; len <<= 1) {
            const ang = 2 * Math.PI / len * (inverse ? -1 : 1);
            const wRe = Math.cos(ang), wIm = Math.sin(ang);
            for (let i = 0; i < n; i += len) {
                let curRe = 1, curIm = 0;
                for (let j = 0; j < len / 2; j++) {
                    const uRe = real[i+j],       uIm = imag[i+j];
                    const vRe = real[i+j+len/2] * curRe - imag[i+j+len/2] * curIm;
                    const vIm = real[i+j+len/2] * curIm + imag[i+j+len/2] * curRe;
                    real[i+j]         = uRe + vRe;  imag[i+j]         = uIm + vIm;
                    real[i+j+len/2]   = uRe - vRe;  imag[i+j+len/2]   = uIm - vIm;
                    const newRe = curRe * wRe - curIm * wIm;
                    curIm = curRe * wIm + curIm * wRe;
                    curRe = newRe;
                }
            }
        }
        if (inverse) {
            for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; }
        }
    }

    // Processa um frame de análise e gera um frame de síntese (por canal)
    _processFrame(ch, pitchRatio) {
        const fs   = this._frameSize;
        const hop  = this._hopSize;
        const win  = this._window;
        const mask = this._bufMask;

        // Lê 'frameSize' amostras do ring-buffer de entrada (análise)
        const real = this._real;
        const imag = this._imag;
        for (let i = 0; i < fs; i++) {
            real[i] = this._inBuf[ch][(this._inWrite - fs + i) & mask] * win[i];
            imag[i] = 0;
        }

        this._fft(real, imag, false);

        // Modificação de fase — realoca bins para transposição de pitch
        const synthReal = new Float32Array(fs);
        const synthImag = new Float32Array(fs);

        for (let k = 0; k < fs; k++) {
            // Frequência original do bin k
            const mag   = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
            const phase = Math.atan2(imag[k], real[k]);

            // Diferença de fase esperada para este hop
            const expectedPhase = (2 * Math.PI * hop * k) / fs;
            let deltaPhase = phase - this._lastPhase[ch][k] - expectedPhase;
            // Normaliza para [-π, π]
            deltaPhase -= 2 * Math.PI * Math.round(deltaPhase / (2 * Math.PI));
            // Frequência instantânea verdadeira
            const trueFreq = expectedPhase + deltaPhase;

            this._lastPhase[ch][k]  = phase;

            // Mapeamento de bin para transposição
            const targetBin = Math.round(k * pitchRatio);
            if (targetBin >= 0 && targetBin < fs) {
                this._phaseAccum[ch][targetBin] += trueFreq * pitchRatio;
                const newPhase = this._phaseAccum[ch][targetBin];
                synthReal[targetBin] += mag * Math.cos(newPhase);
                synthImag[targetBin] += mag * Math.sin(newPhase);
            }
        }

        // IFFT — volta para o domínio do tempo
        this._fft(synthReal, synthImag, true);

        // Overlap-add na saída com janela de síntese
        const outBuf   = this._outBuf[ch];
        const outStart = this._outWrite & mask;
        for (let i = 0; i < fs; i++) {
            const idx = (outStart + i) & mask;
            outBuf[idx] += synthReal[i] * win[i];
        }
    }

    process(inputs, outputs, parameters) {
        const input  = inputs[0];
        const output = outputs[0];
        if (!input || !input.length || !input[0].length) return true;

        const numCh     = Math.min(input.length, this._maxChannels, output.length);
        const blockSize = input[0].length; // normalmente 128
        const pitchRatio = parameters.pitchRatio[0];
        const mask       = this._bufMask;
        const hop        = this._hopSize;

        for (let ch = 0; ch < numCh; ch++) {
            const inp = input[ch];
            const out = output[ch];

            // Escreve amostras no ring-buffer de entrada
            for (let i = 0; i < blockSize; i++) {
                this._inBuf[ch][this._inWrite & mask] = inp[i];
                this._inWrite++;

                // A cada hop amostras, processa um novo frame
                if ((this._inWrite % hop) === 0) {
                    this._processFrame(ch, pitchRatio);
                    this._outWrite += hop;
                }
            }

            // Lê blockSize amostras do buffer de saída
            for (let i = 0; i < blockSize; i++) {
                out[i] = this._outBuf[ch][this._outRead & mask];
                this._outBuf[ch][this._outRead & mask] = 0; // limpa após leitura
                this._outRead++;
            }
        }

        return true;
    }
}

registerProcessor('pitch-shifter-processor', PitchShifterProcessor);
