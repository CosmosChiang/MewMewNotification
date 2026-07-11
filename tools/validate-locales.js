const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '_locales');
const locales = fs.readdirSync(root).filter(name => fs.statSync(path.join(root, name)).isDirectory());
const reference = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'en', 'messages.json'), 'utf8'))).sort();
for (const locale of locales) {
  const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(root, locale, 'messages.json'), 'utf8'))).sort();
  if (JSON.stringify(keys) !== JSON.stringify(reference)) throw new Error(`Locale key mismatch: ${locale}`);
}
process.stdout.write(`Locale parity OK: ${locales.join(', ')} (${reference.length} keys)\n`);
