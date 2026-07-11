const manifest = require('../manifest.json');
const pkg = require('../package.json');
const tag = process.env.RELEASE_TAG || process.argv.find(arg => arg.startsWith('--tag='))?.slice(6);
if (manifest.version !== pkg.version) throw new Error(`Version mismatch: manifest=${manifest.version} package=${pkg.version}`);
if (tag && tag !== `v${manifest.version}`) throw new Error(`Tag mismatch: tag=${tag} expected=v${manifest.version}`);
process.stdout.write(`Version OK: ${manifest.version}${tag ? ` (${tag})` : ''}\n`);
