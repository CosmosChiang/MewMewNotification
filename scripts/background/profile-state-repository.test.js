const { ProfileStateRepository } = require('./profile-state-repository.js');

describe('ProfileStateRepository', () => {
  test('requires an injected profile state manager', () => {
    expect(() => new ProfileStateRepository()).toThrow('profileStateManagerRequired');
  });

  test('delegates profile lifecycle and typed domain access', async () => {
    const manager = {
      createBindingId: jest.fn(() => 'binding'),
      rotateCredentialBinding: jest.fn().mockResolvedValue('rotated'),
      createProfileIdentity: jest.fn().mockResolvedValue({ profileId: 'p' }),
      restoreActiveProfile: jest.fn().mockResolvedValue({ profileId: 'p' }),
      initializeAndActivate: jest.fn().mockResolvedValue({ profileId: 'p' }),
      getActiveProfile: jest.fn().mockResolvedValue({ profileId: 'p' }),
      assertActiveProfile: jest.fn().mockResolvedValue({ profileId: 'p' }),
      read: jest.fn().mockResolvedValue([]),
      write: jest.fn().mockImplementation(async (_profileId, _domain, value) => value)
    };
    const repository = new ProfileStateRepository({ manager });

    expect(repository.createBindingId()).toBe('binding');
    await expect(repository.rotateCredentialBinding('key')).resolves.toBe('rotated');
    await repository.createProfileIdentity('https://example.test', 1, 'key');
    await repository.restoreActiveProfile('https://example.test');
    await repository.initializeAndActivate({ profileId: 'p' });
    await repository.getActiveProfile();
    await repository.assertActiveProfile('p');
    await repository.readHistory('p');
    await repository.writeHistory('p', [{ id: 'n' }]);
    await repository.readSyncHealth('p');
    await repository.writeSyncHealth('p', { lastSuccessAt: 1 });

    expect(manager.read).toHaveBeenCalledWith('p', 'history', []);
    expect(manager.write).toHaveBeenCalledWith('p', 'history', [{ id: 'n' }]);
    expect(manager.read).toHaveBeenCalledWith('p', 'syncHealth', null);
  });

  test('returns aggregate diagnostic state without profile or issue content', async () => {
    const sensitiveProfile = {
      profileId: 'a'.repeat(64),
      bindingId: 'local-binding-secret',
      serverScope: 'https://redmine.secret.example/private'
    };
    const domains = {
      history: [
        { id: 'issue_123', title: 'Secret issue', read: false },
        { id: 'issue_456', title: 'Another issue', read: true }
      ],
      issueStates: { 123: { subject: 'Secret issue' } },
      syncHealth: { lastSuccessAt: 1, lastErrorCode: 'syncFailed' },
      desktopMappings: [{ desktopId: 'secret' }]
    };
    const manager = {
      getActiveProfile: jest.fn().mockResolvedValue(sensitiveProfile),
      read: jest.fn(async (_profileId, domain) => domains[domain])
    };
    const repository = new ProfileStateRepository({ manager });

    await expect(repository.getDiagnosticSummary()).resolves.toEqual({
      schemaVersion: 1,
      active: true,
      bindingId: sensitiveProfile.bindingId,
      serverScope: sensitiveProfile.serverScope,
      syncHealth: domains.syncHealth,
      counts: {
        history: 2,
        unread: 1,
        issueStates: 1,
        desktopMappings: 1
      }
    });
  });

  test('returns a zero summary without an active profile', async () => {
    const repository = new ProfileStateRepository({
      manager: {
        getActiveProfile: jest.fn().mockResolvedValue(null)
      }
    });

    await expect(repository.getDiagnosticSummary()).resolves.toEqual({
      schemaVersion: 1,
      active: false,
      bindingId: null,
      serverScope: null,
      syncHealth: null,
      counts: {
        history: 0,
        unread: 0,
        issueStates: 0,
        desktopMappings: 0
      }
    });
  });

  test('bounds malformed profile diagnostic domains to empty safe values', async () => {
    const repository = new ProfileStateRepository({
      manager: {
        getActiveProfile: jest.fn().mockResolvedValue({ profileId: 'p' }),
        read: jest.fn()
          .mockResolvedValueOnce({ title: 'not history' })
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce('raw error')
          .mockResolvedValueOnce({ desktopId: 'not an array' })
      }
    });

    await expect(repository.getDiagnosticSummary()).resolves.toEqual({
      schemaVersion: 1,
      active: true,
      bindingId: null,
      serverScope: null,
      syncHealth: null,
      counts: {
        history: 0,
        unread: 0,
        issueStates: 0,
        desktopMappings: 0
      }
    });
  });
});
