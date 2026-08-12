const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

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
  ['eightDToggle', 'highPassToggle', 'lowPassToggle', 'compressorToggle', 'limiterToggle']
    .forEach((id) => assert.match(html, new RegExp(`id="${id}"[^>]+aria-label="[^"]+"`)));
  assert.match(html, /id="resetEffectBtn"[^>]+disabled>Reset Last Effect/);
});

test('mobile layout clips decorative hero art instead of widening the page', () => {
  const mobileBlock = styles.match(/@media \(max-width: 600px\) \{([\s\S]*?)\n\}/g)?.at(-1);
  assert.ok(mobileBlock, 'mobile editor styles are missing');
  assert.match(mobileBlock, /\.hero \{ overflow: hidden; \}/);
});
