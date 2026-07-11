const { webcrypto } = require('node:crypto');
const {
  ProfileStateManager,
  PROFILE_DOMAINS,
  ACTIVE_PROFILE_KEY,
  CREDENTIAL_BINDING_KEY,
  PROFILE_MIGRATION_KEY,
  PROFILE_INDEX_KEY
} = require('./profile-state-manager.js');

function createStorage(localSeed = {}, syncSeed = {}) {
  const areas = { local: { ...localSeed }, sync: { ...syncSeed } };
  const makeArea = name => ({
    get: jest.fn(async keys => {
      const selected = {};
      (Array.isArray(keys) ? keys : Object.keys(areas[name])).forEach(key => {
        if (areas[name][key] !== undefined) selected[key] = areas[name][key];
      });
      return selected;
    }),
    set: jest.fn(async values => Object.assign(areas[name], values)),
    remove: jest.fn(async keys => (Array.isArray(keys) ? keys : [keys]).forEach(key => delete areas[name][key]))
  });
  return { storage: { local: makeArea('local'), sync: makeArea('sync') }, areas };
}

describe('ProfileStateManager', () => {
  test('normalizes server scope and rejects unsupported protocols', () => {
    expect(ProfileStateManager.normalizeServerScope('HTTPS://Example.COM/redmine///')).toBe('https://example.com/redmine');
    expect(ProfileStateManager.normalizeServerScope('http://localhost:10083/')).toBe('http://localhost:10083');
    expect(() => ProfileStateManager.normalizeServerScope('ftp://example.com')).toThrow('invalidRedmineUrl');
  });

  test('builds deterministic non-secret identity and rotates it with the API key', async () => {
    const { storage, areas } = createStorage();
    const manager = new ProfileStateManager(storage, webcrypto);
    const first = await manager.createProfileIdentity('https://example.com/redmine/', 7, 'secret-one');
    const repeated = await manager.createProfileIdentity('https://example.com/redmine', '7', 'secret-one');
    await manager.rotateCredentialBinding('secret-two');
    const rotated = await manager.createProfileIdentity('https://example.com/redmine', 7, 'secret-two');
    expect(first.profileId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.profileId).toBe(repeated.profileId);
    expect(rotated.profileId).not.toBe(first.profileId);
    expect(JSON.stringify(areas.local)).not.toContain('secret-one');
    expect(areas.local[CREDENTIAL_BINDING_KEY].bindingId).toBeTruthy();
    await expect(manager.createProfileIdentity('https://example.com', 0, 'key')).rejects.toThrow('invalidCurrentUser');
  });

  test('initializes all domains, migrates attributable legacy state, and activates last', async () => {
    const { storage, areas } = createStorage({
      notificationHistory: [{ id: 'issue-1' }], issueStates: { 1: { updatedOn: 1 } },
      seenNotifications: ['issue-1'], lastSyncTime: '2026-01-01T00:00:00.000Z',
      notificationProjectMetadataCache: { projects: [] }
    }, { readNotifications: ['issue-1'] });
    const manager = new ProfileStateManager(storage, webcrypto);
    const identity = await manager.createProfileIdentity('https://a.example/redmine', 1, 'key-a');
    await manager.initializeAndActivate(identity);
    expect(areas.local[ACTIVE_PROFILE_KEY].profileId).toBe(identity.profileId);
    await expect(manager.restoreActiveProfile('https://a.example/redmine/')).resolves.toEqual(
      expect.objectContaining({ profileId: identity.profileId })
    );
    await expect(manager.restoreActiveProfile('https://other.example')).resolves.toBeNull();
    expect(areas.local[PROFILE_MIGRATION_KEY]).toEqual(expect.objectContaining({ status: 'complete', outcome: 'migrated' }));
    for (const domain of PROFILE_DOMAINS) {
      expect(areas.local[ProfileStateManager.storageKey(identity.profileId, domain)]).toBeDefined();
    }
    expect(areas.local.notificationHistory).toBeUndefined();
    expect(areas.sync.readNotifications).toBeUndefined();
  });

  test('isolates identical IDs and rejects stale profile reads and writes', async () => {
    const { storage } = createStorage({ [PROFILE_MIGRATION_KEY]: { status: 'complete' } });
    const manager = new ProfileStateManager(storage, webcrypto);
    const a = await manager.createProfileIdentity('https://a.example', 1, 'a-key');
    await manager.initializeAndActivate(a);
    await manager.write(a.profileId, 'history', [{ id: 'issue-1', profileId: a.profileId }]);
    const b = await manager.createProfileIdentity('https://b.example', 1, 'b-key');
    await manager.initializeAndActivate(b);
    await manager.write(b.profileId, 'history', [{ id: 'issue-1', profileId: b.profileId }]);
    expect(await manager.read(b.profileId, 'history', [])).toEqual([{ id: 'issue-1', profileId: b.profileId }]);
    await expect(manager.read(a.profileId, 'history', [])).rejects.toThrow('profileMismatch');
    await expect(manager.write(a.profileId, 'readIds', ['issue-1'])).rejects.toMatchObject({ code: 'profileMismatch' });
  });

  test('bounds read IDs by entry count and serialized bytes', () => {
    expect(ProfileStateManager.trimReadIds(['a', 'a', 'b'], 10, 100)).toEqual(['a', 'b']);
    expect(ProfileStateManager.trimReadIds(['a', 'b', 'c'], 2, 100)).toEqual(['b', 'c']);
    expect(ProfileStateManager.trimReadIds(['x'.repeat(100), 'ok'], 10, 12)).toEqual(['ok']);
    expect(ProfileStateManager.trimReadIds(null)).toEqual([]);
  });

  test('clears malformed legacy read state and records retry on interrupted migration', async () => {
    const malformed = createStorage({}, { readNotifications: { invalid: true } });
    const manager = new ProfileStateManager(malformed.storage, webcrypto);
    const identity = await manager.createProfileIdentity('https://example.com', 2, 'key');
    await manager.initializeAndActivate(identity);
    expect(malformed.areas.local[PROFILE_MIGRATION_KEY].outcome).toBe('clearedMalformed');
    expect(await manager.read(identity.profileId, 'readIds', [])).toEqual([]);

    const interrupted = createStorage();
    const failingManager = new ProfileStateManager(interrupted.storage, webcrypto);
    const failingIdentity = await failingManager.createProfileIdentity('https://failed.example', 3, 'key');
    interrupted.storage.local.set
      .mockImplementationOnce(async values => Object.assign(interrupted.areas.local, values))
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockImplementationOnce(async values => Object.assign(interrupted.areas.local, values));
    await expect(failingManager.initializeAndActivate(failingIdentity)).rejects.toThrow('storage unavailable');
    expect(interrupted.areas.local[PROFILE_MIGRATION_KEY]).toEqual(expect.objectContaining({ status: 'retryRequired' }));
    expect(interrupted.areas.local[ACTIVE_PROFILE_KEY]).toBeUndefined();
  });

  test('removes only old orphan namespaces and validates keys', async () => {
    const { storage, areas } = createStorage({ [PROFILE_MIGRATION_KEY]: { status: 'complete' } });
    const manager = new ProfileStateManager(storage, webcrypto);
    const identities = [];
    for (let index = 1; index <= 7; index += 1) {
      const identity = await manager.createProfileIdentity(`https://${index}.example`, index, `key-${index}`);
      identities.push(identity);
      await manager.initializeAndActivate(identity);
    }
    expect(areas.local[PROFILE_INDEX_KEY]).toHaveLength(5);
    expect(areas.local[PROFILE_INDEX_KEY][0].profileId).toBe(identities[6].profileId);
    expect(() => ProfileStateManager.storageKey('bad', 'history')).toThrow('invalidProfileId');
    expect(() => ProfileStateManager.storageKey(identities[0].profileId, 'unknown')).toThrow('invalidProfileDomain');
  });
});
