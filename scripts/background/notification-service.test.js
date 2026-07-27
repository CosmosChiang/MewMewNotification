const { ConfigManager } = require('../shared/config-manager.js');
const policy = require('./notification-policy.js');
const { NotificationService } = require('./notification-service.js');

function createChrome() {
  return {
    storage: {
      sync: { get: jest.fn().mockResolvedValue({}), set: jest.fn(), remove: jest.fn() },
      local: { get: jest.fn().mockResolvedValue({}), set: jest.fn(), remove: jest.fn() }
    },
    permissions: { contains: jest.fn().mockResolvedValue(true) },
    action: {
      setBadgeText: jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
      setTitle: jest.fn()
    },
    notifications: { create: jest.fn(), clear: jest.fn(), getAll: jest.fn() },
    alarms: { create: jest.fn(), clear: jest.fn() },
    tabs: { create: jest.fn() }
  };
}

function createService(overrides = {}) {
  return new NotificationService({
    chrome: createChrome(),
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    i18n: {
      loadLanguage: jest.fn().mockResolvedValue({ hello: { message: 'Hello' } }),
      getCurrentLanguage: jest.fn(() => 'en'),
      translate: jest.fn(key => key)
    },
    profileState: null,
    RedmineAPIClass: jest.fn(),
    policy,
    ConfigManagerClass: ConfigManager,
    ...overrides
  });
}

describe('NotificationService', () => {
  test('construction is side-effect free and initialization is explicit', async () => {
    const service = createService();
    service.loadSettings = jest.fn().mockResolvedValue(undefined);
    service.loadLanguage = jest.fn().mockResolvedValue({});

    expect(service.loadSettings).not.toHaveBeenCalled();
    expect(service.loadLanguage).not.toHaveBeenCalled();
    await service.initialize();
    expect(service.loadSettings).toHaveBeenCalledWith({ notifyPermissionRecovery: true });
    expect(service.loadLanguage).toHaveBeenCalled();
  });

  test('coalesces overlapping synchronization requests and clears in-flight state', async () => {
    const service = createService();
    let resolveCheck;
    service.checkNotifications = jest.fn(() => new Promise(resolve => {
      resolveCheck = resolve;
    }));

    const first = service.requestSync('alarm');
    const second = service.requestSync('popup');
    expect(first).toBe(second);
    expect(service.checkNotifications).toHaveBeenCalledTimes(1);
    resolveCheck({ success: true, status: 'success' });
    await expect(first).resolves.toEqual({ success: true, status: 'success' });
    expect(service.checkPromise).toBeNull();
  });

  test('delegates policy calculations while preserving service contracts', () => {
    const service = createService();
    service.settings.notificationProjectRules = {
      mode: 'include',
      includeProjectIds: [7],
      excludeProjectIds: []
    };
    service.settings.notificationQuietHours = {
      enabled: true,
      start: '22:00',
      end: '08:00'
    };

    expect(service.isProjectNotificationEligible(7)).toBe(true);
    expect(service.isProjectNotificationEligible(8)).toBe(false);
    expect(service.isWithinQuietHours(new Date(2026, 0, 1, 23, 0))).toBe(true);
    expect(service.buildIssueChangeSummary(
      { status: 'New' },
      { status: 'Closed' }
    )).toEqual([{ field: 'status', from: 'New', to: 'Closed' }]);
  });

  test('creates stable synchronization result envelopes', () => {
    const service = createService();
    expect(service.createSyncResult('failure', {
      stale: true,
      errorCode: 'networkError',
      trigger: 'popup'
    })).toEqual(expect.objectContaining({
      success: false,
      status: 'failure',
      stale: true,
      errorCode: 'networkError',
      trigger: 'popup'
    }));
  });

  test('reports only safe configuration and host-permission booleans', async () => {
    const service = createService();
    service.settingsLoaded = true;
    service.settings = {
      redmineUrl: 'https://redmine.private.example/root',
      apiKey: 'seeded-api-key-value'
    };
    service.chrome.permissions.contains.mockImplementation((_request, callback) => {
      callback(true);
      return Promise.resolve(false);
    });

    await expect(service.getDiagnosticConfiguration()).resolves.toEqual({
      redmineConfigured: true,
      apiKeyConfigured: true,
      transportScheme: 'https'
    });
    await expect(service.getConfiguredHostAccessGranted()).resolves.toBe(true);
  });

  test('fails closed for unconfigured, invalid, and rejected permission checks', async () => {
    const service = createService();
    service.settingsLoaded = true;
    service.settings = { redmineUrl: '', apiKey: '' };
    await expect(service.getConfiguredHostAccessGranted()).resolves.toBe(false);

    service.settings = { redmineUrl: 'not a URL', apiKey: 'seeded-api-key-value' };
    await expect(service.getDiagnosticConfiguration()).resolves.toEqual({
      redmineConfigured: true,
      apiKeyConfigured: true,
      transportScheme: null
    });
    await expect(service.getConfiguredHostAccessGranted()).resolves.toBe(false);

    service.settings = {
      redmineUrl: 'http://redmine.private.example',
      apiKey: 'seeded-api-key-value'
    };
    service.chrome.permissions.contains.mockRejectedValue(new Error('permission failed'));
    await expect(service.getDiagnosticConfiguration()).resolves.toEqual({
      redmineConfigured: true,
      apiKeyConfigured: true,
      transportScheme: 'http'
    });
    await expect(service.getConfiguredHostAccessGranted()).resolves.toBe(false);
  });
});
