const nodeCrypto = require('node:crypto').webcrypto;
const {
  DiagnosticSnapshotBuilder,
  DiagnosticSafetyError,
  normalizeSafeErrorCode,
  validateDiagnosticSnapshot
} = require('./diagnostic-snapshot.js');

function safeEvent(timestamp = '2026-07-17T12:00:00.000Z') {
  return {
    schemaVersion: 1,
    timestamp,
    level: 'error',
    code: 'sync_failed',
    metadata: { errorCode: 'syncFailed', retryScheduled: false }
  };
}

function createDependencies(overrides = {}) {
  const alarms = {
    periodic: { name: 'periodic', periodInMinutes: 15, scheduledTime: 1 },
    retry: { name: 'retry', scheduledTime: Date.parse('2026-07-17T12:30:00.000Z') }
  };
  return {
    chrome: {
      runtime: {
        getManifest: jest.fn(() => ({
          version: '1.5.0',
          manifest_version: 3,
          permissions: ['storage', 'background', 'notifications', 'alarms']
        }))
      },
      alarms: {
        get: jest.fn((name, callback) => callback(alarms[name] || null))
      }
    },
    notificationService: {
      settings: {
        redmineUrl: 'https://redmine.private.example/root',
        apiKey: 'seeded-api-key-value'
      },
      getDiagnosticConfiguration: jest.fn().mockResolvedValue({
        redmineConfigured: true,
        apiKeyConfigured: true,
        transportScheme: 'https'
      }),
      getConfiguredHostAccessGranted: jest.fn().mockResolvedValue(true)
    },
    profileRepository: {
      getDiagnosticSummary: jest.fn().mockResolvedValue({
        schemaVersion: 1,
        active: true,
        profileId: 'profile-secret-value',
        bindingId: 'binding-generation-one',
        serverScope: 'https://redmine.private.example/root',
        issueId: 987,
        issueTitle: 'Secret issue title',
        projectName: 'Secret project',
        userName: 'Secret user',
        responseBody: 'private response body',
        requestHeaders: { Authorization: 'seeded-api-key-value' },
        rawError: new Error('raw server failure'),
        syncHealth: {
          lastSuccessAt: Date.parse('2026-07-17T11:00:00.000Z'),
          stale: true,
          lastErrorCode: 'rawSecretError',
          retry: { nextAttemptAt: Date.parse('2026-07-17T12:20:00.000Z') }
        },
        counts: {
          history: 3,
          unread: 2,
          issueStates: 4,
          desktopMappings: 1
        }
      })
    },
    eventStore: {
      isEnabled: jest.fn(() => true),
      getEvents: jest.fn().mockResolvedValue([safeEvent()])
    },
    periodicAlarmName: 'periodic',
    retryAlarmName: 'retry',
    now: () => Date.parse('2026-07-17T12:00:00.000Z'),
    cryptoApi: nodeCrypto,
    ...overrides
  };
}

describe('DiagnosticSnapshotBuilder', () => {
  test('builds a closed snapshot without exporting sensitive source fields', async () => {
    const dependencies = createDependencies();
    const builder = new DiagnosticSnapshotBuilder(dependencies);
    const snapshot = await builder.build();
    const serialized = JSON.stringify(snapshot);

    expect(validateDiagnosticSnapshot(snapshot)).toBe(true);
    expect(snapshot.sync.lastErrorCode).toBe('unknown');
    expect(snapshot.profile.serverFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(snapshot.counts).toEqual({
      history: 3,
      unread: 2,
      issueStates: 4,
      desktopMappings: 1,
      retainedEvents: 1
    });
    [
      'binding-generation-one',
      'redmine.private.example',
      '/root',
      'seeded-api-key-value',
      'profileId',
      'profile-secret-value',
      'issueId',
      'Secret issue title',
      'Secret project',
      'Secret user',
      'private response body',
      'response body',
      'Authorization'
    ].forEach(secret => expect(serialized).not.toContain(secret));
  });

  test('fingerprint is stable and changes with credential rotation', async () => {
    const builder = new DiagnosticSnapshotBuilder(createDependencies());
    const first = await builder.createServerFingerprint('binding-one', 'https://server.example');
    const repeated = await builder.createServerFingerprint('binding-one', 'https://server.example');
    const rotated = await builder.createServerFingerprint('binding-two', 'https://server.example');

    expect(first).toBe(repeated);
    expect(rotated).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{16}$/);
  });

  test('returns current health without retained events when disabled', async () => {
    const dependencies = createDependencies({
      eventStore: {
        isEnabled: jest.fn(() => false),
        getEvents: jest.fn().mockResolvedValue([safeEvent()])
      }
    });
    const snapshot = await new DiagnosticSnapshotBuilder(dependencies).build();

    expect(snapshot.diagnostics.enabled).toBe(false);
    expect(snapshot.events).toEqual([]);
    expect(snapshot.counts.retainedEvents).toBe(0);
    expect(snapshot.counts.history).toBe(3);
  });

  test('uses null fingerprint and normalized missing state without a profile', async () => {
    const dependencies = createDependencies();
    dependencies.profileRepository.getDiagnosticSummary.mockResolvedValue({
      schemaVersion: 1,
      active: false,
      bindingId: null,
      serverScope: null,
      syncHealth: null,
      counts: { history: 0, unread: 0, issueStates: 0, desktopMappings: 0 }
    });
    dependencies.chrome.alarms.get.mockImplementation((_name, callback) => callback(null));
    const snapshot = await new DiagnosticSnapshotBuilder(dependencies).build();

    expect(snapshot.profile).toEqual({ active: false, serverFingerprint: null });
    expect(snapshot.alarms.periodic).toEqual({ exists: false, periodMinutes: null });
    expect(snapshot.sync).toEqual({
      lastSuccessAt: null,
      stale: false,
      lastErrorCode: null,
      retryScheduled: false,
      nextRetryAt: null
    });
  });

  test('rejects prohibited keys, values, event overflow and malformed counts', async () => {
    const snapshot = await new DiagnosticSnapshotBuilder(createDependencies()).build();

    expect(() => validateDiagnosticSnapshot({
      ...snapshot,
      apiKey: 'seeded-api-key'
    })).toThrow(DiagnosticSafetyError);
    expect(() => validateDiagnosticSnapshot({
      ...snapshot,
      events: [safeEvent()].map(event => ({
        ...event,
        metadata: { status: 'https://redmine.private.example/issues/9' }
      }))
    })).toThrow('diagnosticsUnsafe');
    expect(() => validateDiagnosticSnapshot({
      ...snapshot,
      events: [safeEvent()].map(event => ({
        ...event,
        metadata: { status: 'Secret issue title' }
      }))
    })).toThrow('diagnosticsUnsafe');
    expect(() => validateDiagnosticSnapshot({
      ...snapshot,
      counts: { ...snapshot.counts, history: -1 }
    })).toThrow('diagnosticsUnsafe');
    expect(() => validateDiagnosticSnapshot({
      ...snapshot,
      events: Array.from({ length: 101 }, () => safeEvent())
    })).toThrow('diagnosticsUnsafe');
  });

  test('fails closed when fingerprint crypto is unavailable', async () => {
    const builder = new DiagnosticSnapshotBuilder(createDependencies({ cryptoApi: null }));
    await expect(builder.build()).rejects.toMatchObject({
      code: 'diagnosticsUnsafe'
    });
  });

  test('normalizes safe error codes without preserving raw errors', () => {
    expect(normalizeSafeErrorCode('syncFailed')).toBe('syncFailed');
    expect(normalizeSafeErrorCode('Error: fetch https://secret.example')).toBe('unknown');
    expect(normalizeSafeErrorCode(null)).toBeNull();
  });
});
