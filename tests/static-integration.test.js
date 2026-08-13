const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const audioEngine = fs.readFileSync(path.join(root, 'audio-engine.js'), 'utf8');
const exportEngine = fs.readFileSync(path.join(root, 'export-engine.js'), 'utf8');

test('all DOM ids referenced by the application exist and are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const references = [...script.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
  const missing = [...new Set(references.filter((id) => !ids.includes(id)))];
  assert.deepEqual(missing, []);
});

test('static dependency order loads codecs and engine before the application', () => {
  const requiredOrder = [
    'mediabunny.min.js',
    'mediabunny-aac-encoder.min.js',
    'mediabunny-flac-encoder.min.js',
    'audio-editor-core.js',
    'audio-engine.js',
    'export-engine.js',
    'script.js',
  ];
  let previous = -1;
  requiredOrder.forEach((name) => {
    const position = html.indexOf(name);
    assert.ok(position > previous, `${name} is loaded out of order or missing`);
    previous = position;
  });
});

test('removed promotional labels and Portuguese UI copy are absent', () => {
  ['REAL-TIME AUDIO LAB', 'LIVE ENGINE', 'LOCAL PROCESSING', 'LIVE SPECTRUM', '24 BIT LOSSLESS']
    .forEach((label) => assert.equal(html.includes(label), false));
  assert.equal(/[À-ÿ]/.test(html), false);
});

test('runtime dependencies are pinned and preset rename is inline', () => {
  assert.match(html, /unpkg\.com\/lucide@1\.27\.0\/dist\/umd\/lucide\.js/);
  assert.doesNotMatch(html, /@latest/);
  assert.doesNotMatch(script, /window\.prompt|\bprompt\s*\(/);
  assert.match(script, /my-preset-rename-input/);
});

test('factory presets and accessible effect switches remain available', () => {
  const factoryBlock = script.match(/const FACTORY_PRESETS = \{([\s\S]*?)^  \};/m);
  assert.ok(factoryBlock, 'factory preset collection is missing');
  const presetCount = [...factoryBlock[1].matchAll(/^    (?:'[^']+'|[a-z0-9]+):/gm)].length;
  assert.equal(presetCount, 24);
  ['Normal', 'Nightcore', 'Deep Bass', '8D Orbit', 'Vocal Boost', 'Podcast']
    .forEach((label) => assert.ok(factoryBlock[1].includes(`label: '${label}'`)));
  assert.equal([...factoryBlock[1].matchAll(/factoryPreset\(/g)].length, 24);
  ['fineTune', 'gainDb', 'mid', 'advancedEq', 'vocalBoost', 'stereoWidth', 'distortionDrive', 'highPassEnabled', 'compressorEnabled']
    .forEach((property) => assert.ok(factoryBlock[1].includes(property), `${property} is not used by the factory presets`));
  ['eightDToggle', 'highPassToggle', 'lowPassToggle', 'compressorToggle', 'limiterToggle']
    .forEach((id) => assert.match(html, new RegExp(`id="${id}"[^>]+aria-label="[^"]+"`)));
  assert.match(html, /id="resetEffectBtn"[^>]+disabled>Reset Last Effect/);
});

test('simple mode and automatic clipping protection are wired accessibly', () => {
  assert.match(html, /id="simpleModeBtn"[^>]+aria-pressed="false"/);
  assert.match(html, /id="studioModeBtn"[^>]+aria-pressed="true"/);
  assert.match(html, /id="autoProtectBtn"[^>]+aria-describedby="autoProtectHint"/);
  assert.match(script, /audio-editor-ui-mode-v1/);
  assert.match(script, /function setEditorMode\(/);
  assert.match(script, /function autoProtectFromClipping\(/);
  assert.match(script, /ExportApi\.renderProcessedAudio/);
  assert.match(script, /Core\.protectiveGainDb/);
  assert.match(styles, /\.simple-mode \.studio-only-panel/);
});

test('hero and preset summaries retain unclipped stacked layouts', () => {
  assert.match(html, /section-header section-header-rich/);
  assert.match(html, /class="preset-status" aria-live="polite"><span>ACTIVE PRESET<\/span>/);
  assert.match(styles, /\.hero h1 \{[\s\S]*?line-height: \.96;/);
  assert.match(styles, /\.preset-toolbar \.section-header-rich > div \{[\s\S]*?display: grid;/);
});

test('mobile layout clips decorative hero art instead of widening the page', () => {
  assert.match(styles, /@media \(max-width: 600px\) \{[\s\S]*?\.hero \{ overflow: hidden; \}/);
});

test('polished workspace navigation and tempo shortcuts remain connected', () => {
  ['basicPanel', 'editPanel', 'advancedPanel', 'historyPanel', 'exportPanel']
    .forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
  assert.equal([...html.matchAll(/data-panel-target=/g)].length, 5);
  assert.equal([...html.matchAll(/data-speed-value=/g)].length, 4);
  assert.match(script, /function bindWorkspaceNavigation\(/);
  assert.match(script, /function syncSpeedShortcuts\(/);
  assert.match(styles, /\.workspace-nav \{/);
  assert.match(styles, /@supports selector\(details::details-content\)/);
  assert.match(styles, /\.tempo-shortcuts button\.active/);
});

test('slowed presets use one continuous source without pitch grains or echo', () => {
  ['slowedreverb', 'softslowed', 'deepslowed', 'ultraslowed'].forEach((key) => {
    const preset = script.match(new RegExp(`^    ${key}: (.*)$`, 'm'));
    assert.ok(preset, `${key} preset is missing`);
    assert.doesNotMatch(preset[1], /\bpitch\s*:/);
    assert.doesNotMatch(preset[1], /\bfineTune\s*:/);
    assert.match(preset[1], /\becho:\s*0\b/);
  });
});

test('pitch and export never construct layered grain players', () => {
  assert.doesNotMatch(audioEngine, /GrainPlayer|grainSize|overlap/);
  assert.doesNotMatch(exportEngine, /GrainPlayer|grainSize|overlap/);
  assert.match(audioEngine, /function playbackRateForState\(/);
  assert.match(exportEngine, /playbackRateForState\(state, 'modified'\)/);
});
