// Este arquivo não é mais usado.
// Pitch shift é feito via AudioBufferSourceNode.detune (Web Audio API nativa).
// Mantido apenas para não quebrar referências antigas.
registerProcessor('pitch-shifter-processor', class extends AudioWorkletProcessor {
    process(i,o){if(o[0])for(let c=0;c<o[0].length;c++)if(i[0]&&i[0][c])o[0][c].set(i[0][c]);return true;}
});
