# Audio Editor

Static, local-first audio editor for desktop and mobile browsers.

Live site: https://delislt.github.io/audio-editor/

## Features

- Imports MP3, WAV, FLAC, M4A/AAC and OGG with drag and drop or a file picker.
- Displays file name, duration, size and detected format.
- Play, pause, stop, seek, monitor volume, back 10 seconds and forward 10 seconds.
- Zoomable and horizontally scrollable waveform with touch, pen and mouse selection.
- Trim, cut, copy, paste, delete, reverse, fade in, fade out, normalize and remove silence.
- Bounded Undo/Redo history and immutable original audio for Reset All and Original/Modified comparison.
- Independent Speed/Tempo and Pitch through Tone.js granular synthesis, with a dry player bypass at neutral values.
- Fine tuning in cents, processing gain, Bass/Mid/Treble and five configurable advanced EQ bands.
- Reverb, echo, pan, 8D orbit, vocal boost, stereo width, distortion, high-pass, low-pass, compressor and limiter.
- 22 original factory presets plus Vocal Boost and Podcast.
- Versioned custom presets stored locally with save, apply, rename and delete actions.
- Output metering with peak, RMS and clipping indication after the processing chain.
- Offline export that uses the same effect graph as playback.
- Real WAV 16/24-bit, MP3, FLAC and M4A/AAC output with sample-rate, channel, bitrate and filename settings.
- No backend or build step. The project remains deployable directly to GitHub Pages.

## Architecture

- `audio-editor-core.js` contains browser-independent buffer editing, selection, history, filename, preset and validation logic.
- `audio-engine.js` owns the single real-time Tone.js/Web Audio graph and the iOS audio-session unlock path.
- `export-engine.js` renders the shared processing graph through `Tone.Offline` and encodes the selected format.
- `script.js` coordinates the central editor state, DOM, waveform, presets and user operations.
- `originalBuffer` remains unchanged. Destructive edits replace only `workingBuffer`; effects remain non-destructive.

The processing order is:

`Source → Time/Pitch → Simple/Advanced EQ → Filters → Vocal processing → Stereo width/Pan → Distortion → Echo/Reverb → Gain → Compressor/Limiter → Meter → Monitor output`

Player volume is monitor-only and is intentionally excluded from exports. Processing Gain is included.

## Dependencies

| Dependency | Version | License | Purpose |
| --- | --- | --- | --- |
| Tone.js | 14.8.49 | MIT | Web Audio graph, granular time/pitch processing and offline rendering |
| lamejs | 1.2.1 | LGPL-3.0 | Client-side MP3 encoding |
| @wasm-audio-decoders/flac | 0.2.10 | MIT | Reliable FLAC import where native browser decoding is unavailable |
| Mediabunny | 1.53.0 | MPL-2.0 | FLAC and MP4 container output |
| @mediabunny/flac-encoder | 1.53.0 | MPL-2.0 | Real libFLAC WebAssembly encoding |
| @mediabunny/aac-encoder | 1.53.0 | MPL-2.0 | AAC-LC WebAssembly encoding for M4A output, including Safari fallback |

Mediabunny and its codec extensions are version-pinned under `vendor/mediabunny-1.53.0/` so FLAC and M4A/AAC export does not depend on a runtime package CDN. The bundled MPL-2.0 license is included beside those files.

Tone.js granular synthesis was selected because the existing project already depends on Tone.js and its `GrainPlayer` independently controls `playbackRate` and `detune`. Dedicated WebAssembly encoders were added only where browser APIs do not provide portable static-site encoding.

## Development and tests

No compilation is required.

```sh
npm test
npm run check
python3 -m http.server 4173
```

The Node test suite covers selection and waveform coordinate conversions, buffer editing, sample-rate/channel-aware paste, fades, reverse, normalization, silence removal, bounded history, filenames, presets, dB conversions and export settings.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Space | Play / Pause |
| J / L | Back / Forward 10 seconds |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y | Redo |
| Ctrl/Cmd + C / X / V | Copy / Cut / Paste using the editor clipboard |
| Delete / Backspace | Delete selection |

Shortcuts are not intercepted while typing in an input, textarea or select.

## Browser notes

The app centralizes audio startup around the first user gesture, resumes the shared context when necessary and does not create a new `AudioContext` for every operation. FLAC decoding has WebAssembly and native fallback paths. Pointer Events power waveform selection on mouse and touch devices.

All processing stays on the user's device. Large files and long, high-quality exports require browser memory proportional to decoded and rendered audio duration.
