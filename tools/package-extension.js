const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

const root = path.resolve(__dirname, '..');
const allowlist = require('./package-allowlist.json');
const outputArg = process.argv.find(arg => arg.startsWith('--output='));
const output = path.resolve(root, outputArg ? outputArg.slice(9) : 'dist/mewmew-notification-extension.zip');
const validateOnly = process.argv.includes('--validate-only');
const normalized = value => value.split(path.sep).join('/');
const expectedRequiredPermissions = ['alarms', 'background', 'notifications', 'storage'];
const expectedOptionalHostPermissions = ['http://*/*', 'http://[::1]/*', 'https://*/*'];

function validateManifestPermissions() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const actual = [...(manifest.permissions || [])].sort();
  const unexpected = actual.filter(permission => !expectedRequiredPermissions.includes(permission));
  const missing = expectedRequiredPermissions.filter(permission => !actual.includes(permission));
  if (unexpected.length || missing.length) {
    throw new Error(`Manifest required permissions mismatch. Unexpected=${unexpected.join(',')} Missing=${missing.join(',')}`);
  }
  const actualOptionalHosts = [...(manifest.optional_host_permissions || [])].sort();
  const unexpectedHosts = actualOptionalHosts.filter(permission => !expectedOptionalHostPermissions.includes(permission));
  const missingHosts = expectedOptionalHostPermissions.filter(permission => !actualOptionalHosts.includes(permission));
  if (unexpectedHosts.length || missingHosts.length) {
    throw new Error(`Manifest optional host permissions mismatch. Unexpected=${unexpectedHosts.join(',')} Missing=${missingHosts.join(',')}`);
  }
}

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

validateManifestPermissions();

if (!validateOnly) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const zip = new AdmZip();
  for (const item of expectedEntries()) {
    const content = fs.readFileSync(item.absolute);
    zip.addFile(item.entry, content, '', 0o100644 << 16);
    zip.getEntry(item.entry).header.time = new Date('1980-01-01T00:00:00.000Z');
  }
  zip.writeZip(output);
}

if (!fs.existsSync(output)) throw new Error(`Package not found: ${output}`);
const archive = new AdmZip(output);
validateEntries(archive.getEntries().filter(entry => !entry.isDirectory).map(entry => entry.entryName));
const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ output, entries: expectedEntries().length, sha256: digest })}\n`);
