const fs = require('node:fs');
const path = require('node:path');
const data = require('../docs/webstore-screenshots/source/listing-data.js');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'webstore-screenshots');
const promoOutput = path.join(root, 'docs', 'webstore-promotional');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const localeDir = path.join(root, '_locales');
const expectedLocales = fs.readdirSync(localeDir).filter(name => fs.statSync(path.join(localeDir, name)).isDirectory()).sort();
const actualLocales = Object.keys(data.locales).sort();
const errors = [];

if (JSON.stringify(expectedLocales) !== JSON.stringify(actualLocales)) errors.push(`Locale mismatch: manifest=${expectedLocales} listing=${actualLocales}`);
if (data.version !== manifest.version) errors.push(`Version mismatch: manifest=${manifest.version} listing=${data.version}`);

for (const locale of expectedLocales) {
  const entry = data.locales[locale];
  if (!entry) continue;
  for (const field of ['shortDescription', 'detailedDescription', 'releaseNotes', 'scenes']) {
    if (!entry[field] || entry[field].length === 0) errors.push(`${locale}: missing ${field}`);
  }
  if (entry.shortDescription.length > 132) errors.push(`${locale}: shortDescription exceeds 132 characters`);
  if (entry.scenes?.length !== 5) errors.push(`${locale}: expected 5 scenes`);
  const text = JSON.stringify(entry).toLowerCase();
  if (/api key.{0,50}sync storage|api key.{0,50}synchronized storage/.test(text)) errors.push(`${locale}: obsolete synchronized API key claim`);
  if (/localhost|127\.0\.0\.1|bemhicbfgnjocjhmlijokdfgdmbfnomh/.test(text)) errors.push(`${locale}: non-public example data detected`);
}

if (process.argv.includes('--media')) {
  const expectedFiles = new Set(expectedLocales.flatMap(locale => Array.from({ length: 5 }, (_, index) => `mewmewnotification-webstore-${locale}-${index + 1}.png`)));
  const actualFiles = fs.readdirSync(output).filter(name => name.endsWith('.png') && name.startsWith('mewmewnotification-webstore-'));
  for (const file of actualFiles) if (!expectedFiles.has(file)) errors.push(`Unexpected legacy media ${file}`);
  for (const locale of expectedLocales) {
    for (let scene = 1; scene <= 5; scene += 1) {
      const file = path.join(output, `mewmewnotification-webstore-${locale}-${scene}.png`);
      if (!fs.existsSync(file)) { errors.push(`Missing ${path.basename(file)}`); continue; }
      const png = fs.readFileSync(file);
      if (png.readUInt32BE(16) !== 1280 || png.readUInt32BE(20) !== 800) errors.push(`${path.basename(file)} is not 1280x800`);
    }
  }
  const promoContract = {
    'mewmewnotification-promo-small.png': [440, 280],
    'mewmewnotification-promo-marquee.png': [1400, 560]
  };
  const actualPromoFiles = fs.readdirSync(promoOutput).filter(name => name.endsWith('.png'));
  for (const file of actualPromoFiles) if (!promoContract[file]) errors.push(`Unexpected promotional media ${file}`);
  for (const [name, [width, height]] of Object.entries(promoContract)) {
    const file = path.join(promoOutput, name);
    if (!fs.existsSync(file)) { errors.push(`Missing ${name}`); continue; }
    const png = fs.readFileSync(file);
    if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) errors.push(`${name} is not ${width}x${height}`);
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Web Store assets valid: ${expectedLocales.length} locales, version ${data.version}${process.argv.includes('--media') ? ', 20 screenshots, 2 promotional PNGs' : ''}`);
