const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findMissingCanonicalCapabilities } = require('../tools/validate-openspec.js');

describe('OpenSpec canonical capability validation', () => {
  let fixtureRoot;
  let archiveRoot;
  let specsRoot;

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mewmew-openspec-'));
    archiveRoot = path.join(fixtureRoot, 'changes', 'archive');
    specsRoot = path.join(fixtureRoot, 'specs');
    fs.mkdirSync(path.join(archiveRoot, '2026-07-11-example', 'specs', 'desktop-actions'), { recursive: true });
    fs.writeFileSync(path.join(archiveRoot, '2026-07-11-example', 'specs', 'desktop-actions', 'spec.md'), '# archived');
  });

  afterEach(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  test('reports an archived required capability missing from canonical specs', () => {
    expect(findMissingCanonicalCapabilities({
      archiveRoot, specsRoot, capabilities: ['desktop-actions']
    })).toEqual([expect.objectContaining({
      capability: 'desktop-actions',
      archiveSources: [expect.stringContaining(path.join('specs', 'desktop-actions', 'spec.md'))]
    })]);
  });

  test('accepts an archived required capability when its canonical spec exists', () => {
    fs.mkdirSync(path.join(specsRoot, 'desktop-actions'), { recursive: true });
    fs.writeFileSync(path.join(specsRoot, 'desktop-actions', 'spec.md'), '# canonical');

    expect(findMissingCanonicalCapabilities({
      archiveRoot, specsRoot, capabilities: ['desktop-actions']
    })).toEqual([]);
  });

  test('ignores a required capability that has never appeared in an archive', () => {
    expect(findMissingCanonicalCapabilities({
      archiveRoot, specsRoot, capabilities: ['unreleased-capability']
    })).toEqual([]);
  });
});
