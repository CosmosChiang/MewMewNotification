const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ConfigManager } = require('./shared/config-manager.js');

function createChromeMock() {
  return {
    storage: {
      sync: {
        get: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined)
      },
      local: {
        get: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined)
      },
      onChanged: {
        addListener: jest.fn()
      }
    },
    permissions: {
      contains: jest.fn().mockResolvedValue(true)
    },
    action: {
      setBadgeText: jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
      setTitle: jest.fn(),
      openPopup: jest.fn()
    },
    notifications: {
      create: jest.fn((notificationId, _options, callback) => {
        if (callback) {
          callback(notificationId);
        }
      }),
      clear: jest.fn((_notificationId, callback) => {
        if (callback) {
          callback(true);
        }
      }),
      getAll: jest.fn(),
      onClicked: {
        addListener: jest.fn()
      }
    },
    alarms: {
      create: jest.fn(),
      clear: jest.fn((_name, callback) => {
        if (callback) {
          callback(true);
        }
      }),
      get: jest.fn((_name, callback) => {
        if (callback) {
          callback(undefined);
        }
      }),
      onAlarm: {
        addListener: jest.fn()
      }
    },
    runtime: {
      lastError: undefined,
      onInstalled: {
        addListener: jest.fn()
      },
      onStartup: {
        addListener: jest.fn()
      },
      onMessage: {
        addListener: jest.fn()
      },
      openOptionsPage: jest.fn()
    }
  };
}

function loadBackgroundModule(chromeMock) {
  global.chrome = chromeMock;

  const filePath = path.join(__dirname, '..', 'background.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require,
    console,
    URL,
    Date,
    Promise,
    Map,
    Set,
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout,
    fetch: jest.fn().mockResolvedValue({
      json: () => Promise.resolve({
        extName: { message: 'MewMewNotification' },
        hostPermissionRequired: {
          message: 'Grant host access for the configured Redmine server before syncing'
        }
      })
    }),
    importScripts: jest.fn(),
    chrome: chromeMock,
    ConfigManager,
    globalThis: {
      ConfigManager
    }
  };

  vm.runInNewContext(
    `${source}\nmodule.exports = { NotificationManager, HOST_PERMISSION_RECOVERY_NOTIFICATION_ID };`,
    sandbox,
    { filename: filePath }
  );

  return sandbox.module.exports;
}

describe('NotificationManager host permission recovery', () => {
  afterEach(() => {
    delete global.chrome;
  });

  test('stores recovery state and shows a one-time notification when host access is missing', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager, HOST_PERMISSION_RECOVERY_NOTIFICATION_ID } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.settings = {
      redmineUrl: 'https://redmine.example.com:8443',
      apiKey: 'valid-api-key-123',
      readNotifications: []
    };

    chromeMock.permissions.contains.mockResolvedValue(false);
    chromeMock.storage.local.get.mockResolvedValue({});

    await manager.syncHostPermissionRecoveryState({ notify: true });

    expect(chromeMock.permissions.contains).toHaveBeenLastCalledWith({
      origins: ['https://redmine.example.com/*']
    });
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      hostPermissionRecoveryRequired: true,
      hostPermissionRecoveryUrl: 'https://redmine.example.com:8443',
      hostPermissionRecoveryOrigin: 'https://redmine.example.com/*',
      lastErrorCode: 'hostPermissionRequired'
    }));
    expect(chromeMock.notifications.create).toHaveBeenCalledWith(
      HOST_PERMISSION_RECOVERY_NOTIFICATION_ID,
      expect.objectContaining({
        title: 'MewMewNotification',
        message: 'Grant host access for the configured Redmine server before syncing',
        contextMessage: 'https://redmine.example.com:8443'
      }),
      expect.any(Function)
    );
  });

  test('opens options when the recovery notification is clicked', () => {
    const chromeMock = createChromeMock();
    const { HOST_PERMISSION_RECOVERY_NOTIFICATION_ID } = loadBackgroundModule(chromeMock);
    const handler = chromeMock.notifications.onClicked.addListener.mock.calls[0][0];

    handler(HOST_PERMISSION_RECOVERY_NOTIFICATION_ID);

    expect(chromeMock.runtime.openOptionsPage).toHaveBeenCalled();
    expect(chromeMock.action.openPopup).not.toHaveBeenCalled();
  });

  test('loads settings before checking notifications when settings are still null', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.settingsLoaded = false;
    manager.loadSettings = jest.fn().mockImplementation(async () => {
      manager.settings = {
        redmineUrl: '',
        apiKey: '',
        checkInterval: 15,
        enableNotifications: true,
        enableSound: true,
        maxNotifications: 50,
        readNotifications: [],
        onlyMyProjects: true,
        includeWatchedIssues: true
      };
      return manager.settings;
    });

    await expect(manager.checkNotifications()).resolves.toBeUndefined();
    expect(manager.loadSettings).toHaveBeenCalled();
  });

  test('normalizes null storage results to default settings', async () => {
    const chromeMock = createChromeMock();
    chromeMock.storage.sync.get.mockResolvedValue(null);
    chromeMock.storage.local.get.mockResolvedValue(null);

    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();

    await expect(manager.loadSettings()).resolves.toBeUndefined();
    expect(manager.settings).toEqual(expect.objectContaining({
      redmineUrl: '',
      apiKey: '',
      checkInterval: 15,
      enableNotifications: true,
      enableSound: true,
      maxNotifications: 50,
      readNotifications: [],
      onlyMyProjects: true,
      includeWatchedIssues: true
    }));
    await expect(manager.checkNotifications()).resolves.toBeUndefined();
  });
});
