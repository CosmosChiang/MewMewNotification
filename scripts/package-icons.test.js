const fs = require('node:fs');
const path = require('node:path');
const { validateIconBuffer } = require('../tools/package-extension');

const root = path.resolve(__dirname, '..');
const iconContract = [
  ['icons/icon16.png', 16],
  ['icons/icon32.png', 32],
  ['icons/icon48.png', 48],
  ['icons/icon128.png', 128]
];

describe('extension package icons', () => {
  test.each(iconContract)('%s is a real PNG with the declared dimensions', (entry, size) => {
    const content = fs.readFileSync(path.join(root, entry));
    expect(() => validateIconBuffer(entry, content, size)).not.toThrow();
  });

  test('rejects a Git LFS pointer in place of an icon', () => {
    const pointer = Buffer.from([
      'version https://git-lfs.github.com/spec/v1',
      `oid sha256:${'0'.repeat(64)}`,
      'size 3398',
      ''
    ].join('\n'));

    expect(() => validateIconBuffer('icons/icon16.png', pointer, 16))
      .toThrow(/Git LFS pointer/);
  });
});
