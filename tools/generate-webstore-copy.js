const fs = require('node:fs');
const path = require('node:path');
const data = require('../docs/webstore-screenshots/source/listing-data.js');

const sections = [`# Chrome Web Store Listing ${data.version}`, '', '> Generated from `source/listing-data.js`. Edit the source and regenerate this file.', ''];
for (const [locale, entry] of Object.entries(data.locales)) {
  sections.push(`## ${entry.name} (${locale})`, '', '### Short description', '', entry.shortDescription, '', '### Detailed description', '', entry.detailedDescription.join('\n'), '', '### Release notes', '', entry.releaseNotes, '', '### Screenshot captions', '');
  entry.scenes.forEach((scene, index) => sections.push(`${index + 1}. ${scene.caption}`));
  sections.push('');
}
fs.writeFileSync(path.resolve(__dirname, '..', 'docs', 'webstore-listing.md'), `${sections.join('\n').trimEnd()}\n`);
console.log('Generated docs/webstore-listing.md');
