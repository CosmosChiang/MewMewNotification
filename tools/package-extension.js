const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

const root = path.resolve(__dirname, '..');
const allowlist = require('./package-allowlist.json');
const normalized = value => value.split(path.sep).join('/');
const iconContract = new Map([
  ['icons/icon16.png', 16],
  ['icons/icon32.png', 32],
  ['icons/icon48.png', 48],
  ['icons/icon128.png', 128]
]);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const lfsPointerPrefix = 'version https://git-lfs.github.com/spec/v1';

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function expectedEntries() {
  const files = allowlist.files.map(file => path.resolve(root, file));
  for (const directory of allowlist.directories) files.push(...walk(path.resolve(root, directory)));
  return files.map(file => ({ absolute: file, entry: normalized(path.relative(root, file)) }))
    .sort((left, right) => left.entry.localeCompare(right.entry));
}

function validateEntries(entries) {
  const expected = expectedEntries().map(item => item.entry);
  const actual = [...entries].sort();
  const unexpected = actual.filter(entry => !expected.includes(entry));
  const missing = expected.filter(entry => !actual.includes(entry));
  if (unexpected.length || missing.length || actual.length !== expected.length) {
    throw new Error(`Package allowlist mismatch. Unexpected=${unexpected.join(',')} Missing=${missing.join(',')}`);
  }
  const forbidden = actual.filter(entry => /(^|\/)(node_modules|docs|tests?|\.git|\.github|openspec|test-info\.txt)(\/|$)/i.test(entry));
  if (forbidden.length) throw new Error(`Forbidden package entries: ${forbidden.join(',')}`);
}

function validateIconBuffer(entry, content, expectedSize = iconContract.get(entry)) {
  if (!Buffer.isBuffer(content)) throw new TypeError(`Invalid package icon ${entry}: expected a Buffer`);
  if (content.subarray(0, lfsPointerPrefix.length).toString('utf8') === lfsPointerPrefix) {
    throw new Error(`Invalid package icon ${entry}: Git LFS pointer found; commit the actual PNG bytes`);
  }
  if (content.length < 24 || !content.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`Invalid package icon ${entry}: PNG signature not found`);
  }
  if (content.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`Invalid package icon ${entry}: IHDR chunk not found`);
  }

  const width = content.readUInt32BE(16);
  const height = content.readUInt32BE(20);
  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(`Invalid package icon ${entry}: expected ${expectedSize}x${expectedSize}, got ${width}x${height}`);
  }
}

function validateArchiveIcons(archive) {
  for (const [entry, expectedSize] of iconContract) {
    const archiveEntry = archive.getEntry(entry);
    if (!archiveEntry || archiveEntry.isDirectory) throw new Error(`Invalid package icon ${entry}: missing from package`);
    validateIconBuffer(entry, archiveEntry.getData(), expectedSize);
  }
}

function main() {
  const outputArg = process.argv.find(arg => arg.startsWith('--output='));
  const output = path.resolve(root, outputArg ? outputArg.slice(9) : 'dist/mewmew-notification-extension.zip');
  const validateOnly = process.argv.includes('--validate-only');

  if (!validateOnly) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const zip = new AdmZip();
    for (const item of expectedEntries()) {
      const content = fs.readFileSync(item.absolute);
      if (iconContract.has(item.entry)) validateIconBuffer(item.entry, content);
      zip.addFile(item.entry, content, '', 0o100644 << 16);
      zip.getEntry(item.entry).header.time = new Date('1980-01-01T00:00:00.000Z');
    }
    zip.writeZip(output);
  }

  if (!fs.existsSync(output)) throw new Error(`Package not found: ${output}`);
  const archive = new AdmZip(output);
  validateEntries(archive.getEntries().filter(entry => !entry.isDirectory).map(entry => entry.entryName));
  validateArchiveIcons(archive);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output, entries: expectedEntries().length, sha256: digest })}\n`);
}

if (require.main === module) main();

module.exports = {
  validateArchiveIcons,
  validateIconBuffer
};
