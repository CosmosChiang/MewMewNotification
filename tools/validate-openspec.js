const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const packageRoot = path.dirname(path.dirname(require.resolve('@fission-ai/openspec')));
const cli = path.join(packageRoot, 'bin', 'openspec.js');
const changesRoot = path.join(root, 'openspec', 'changes');
const changes = fs.readdirSync(changesRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name !== 'archive').map(entry => entry.name);
for (const change of changes) {
  const result = spawnSync(process.execPath, [cli, 'validate', change, '--type', 'change', '--strict'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const allResult = spawnSync(process.execPath, [cli, 'validate', '--all', '--strict'], { cwd: root, stdio: 'inherit' });
if (allResult.status !== 0) process.exit(allResult.status || 1);
process.stdout.write(`Validated ${changes.length} active changes and all OpenSpec artifacts\n`);
