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
    `${source}\nmodule.exports = { NotificationManager, RedmineAPI, HOST_PERMISSION_RECOVERY_NOTIFICATION_ID };`,
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

  test('returns updated notification payload after applying combined issue changes', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.settings = {
      redmineUrl: 'https://redmine.example.com',
      apiKey: 'valid-api-key-123',
      readNotifications: []
    };
    manager.notifications.set('issue_7', {
      id: 'issue_7',
      read: false,
      sourceType: 'assigned'
    });
    manager.createApiClient = jest.fn().mockResolvedValue({
      applyIssueChanges: jest.fn().mockResolvedValue({}),
      getIssueActionContext: jest.fn().mockResolvedValue({
        issue: {
          id: 7,
          subject: 'Review popup actions',
          project: { id: 2, name: 'Web' },
          author: { name: 'Alice' },
          status: { id: 3, name: 'Resolved' },
          priority: { name: 'Normal' },
          assigned_to: { id: 9, name: 'Bob' },
          updated_on: '2026-04-28T08:00:00.000Z'
        },
        permissions: {
          canReply: true,
          canChangeStatus: true,
          canChangeAssignee: true
        },
        current: {
          statusId: 3,
          assigneeId: 9
        },
        statusOptions: [{ id: 3, name: 'Resolved' }],
        assigneeOptions: [{ id: 9, name: 'Bob' }]
      })
    });
    chromeMock.storage.local.get.mockResolvedValue({ issueStates: {} });

    const result = await manager.applyIssueChanges(7, {
      reply: 'Looks good',
      statusId: 3
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      notification: expect.objectContaining({
        id: 'issue_7',
        status: 'Resolved',
        url: 'https://redmine.example.com/issues/7',
        sourceType: 'assigned'
      }),
      context: expect.objectContaining({
        current: expect.objectContaining({ statusId: 3 })
      })
    }));
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      issueStates: expect.objectContaining({
        7: expect.objectContaining({
          status: 'Resolved',
          subject: 'Review popup actions'
        })
      })
    }));
  });

  test('builds combined issue updates from only changed fields', () => {
    const chromeMock = createChromeMock();
    const { RedmineAPI } = loadBackgroundModule(chromeMock);
    const api = new RedmineAPI('https://redmine.example.com', 'valid-api-key-123');

    expect(api.buildIssueUpdateData({
      reply: '  Looks good  ',
      statusId: 3,
      assigneeId: undefined
    })).toEqual({
      notes: 'Looks good',
      status_id: 3
    });
  });

  test('rejects partially numeric identifiers when parsing positive integers', () => {
    const chromeMock = createChromeMock();
    const { RedmineAPI } = loadBackgroundModule(chromeMock);
    const api = new RedmineAPI('https://redmine.example.com', 'valid-api-key-123');

    expect(api.parsePositiveInteger(7, 'issue id')).toBe(7);
    expect(api.parsePositiveInteger('07', 'issue id')).toBe(7);
    expect(() => api.parsePositiveInteger('7abc', 'issue id')).toThrow('Invalid issue id');
    expect(() => api.parsePositiveInteger('1.5', 'status id')).toThrow('Invalid status id');
  });

  test('maps forbidden issue actions to a permission error', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.createApiClient = jest.fn().mockResolvedValue({
      applyIssueChanges: jest.fn().mockRejectedValue(new Error('Access forbidden - insufficient permissions'))
    });
    manager.translate = jest.fn((key) => key);

    const result = await manager.applyIssueChanges(7, { statusId: 3 });

    expect(result).toEqual({
      success: false,
      error: 'permissionDenied'
    });
  });
});
