const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const packageRoot = path.dirname(path.dirname(require.resolve('@fission-ai/openspec')));
const cli = path.join(packageRoot, 'bin', 'openspec.js');
const changesRoot = path.join(root, 'openspec', 'changes');
const REQUIRED_ARCHIVED_CAPABILITIES = Object.freeze([
  'desktop-notification-actions'
]);

function findArchivedCapabilitySources(archiveRoot, capability) {
  if (!fs.existsSync(archiveRoot)) return [];
  return fs.readdirSync(archiveRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(archiveRoot, entry.name, 'specs', capability, 'spec.md'))
    .filter(candidate => fs.existsSync(candidate));
}

function findMissingCanonicalCapabilities({ archiveRoot, specsRoot, capabilities }) {
  return capabilities.flatMap(capability => {
    const archiveSources = findArchivedCapabilitySources(archiveRoot, capability);
    if (archiveSources.length === 0 || fs.existsSync(path.join(specsRoot, capability, 'spec.md'))) return [];
    return [{ capability, archiveSources }];
  });
}

function main() {
  const changes = fs.readdirSync(changesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'archive').map(entry => entry.name);
  for (const change of changes) {
    const result = spawnSync(process.execPath, [cli, 'validate', change, '--type', 'change', '--strict'], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) return result.status || 1;
  }

  const missingCapabilities = findMissingCanonicalCapabilities({
    archiveRoot: path.join(changesRoot, 'archive'),
    specsRoot: path.join(root, 'openspec', 'specs'),
    capabilities: REQUIRED_ARCHIVED_CAPABILITIES
  });
  if (missingCapabilities.length > 0) {
    for (const missing of missingCapabilities) {
      process.stderr.write(`Missing canonical OpenSpec capability '${missing.capability}' archived at ${missing.archiveSources.join(', ')}\n`);
    }
    return 1;
  }

  const allResult = spawnSync(process.execPath, [cli, 'validate', '--all', '--strict'], { cwd: root, stdio: 'inherit' });
  if (allResult.status !== 0) return allResult.status || 1;
  process.stdout.write(`Validated ${changes.length} active changes and all OpenSpec artifacts\n`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { findArchivedCapabilitySources, findMissingCanonicalCapabilities, main };
