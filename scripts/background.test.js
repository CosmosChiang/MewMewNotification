const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createInstrumenter } = require('istanbul-lib-instrument');
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
      },
      onButtonClicked: {
        addListener: jest.fn()
      },
      onClosed: {
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
    },
    tabs: {
      create: jest.fn().mockResolvedValue(undefined)
    }
  };
}

function loadBackgroundModule(chromeMock) {
  global.chrome = chromeMock;

  const filePath = path.join(__dirname, '..', 'background.js');
  const source = createInstrumenter({ compact: false }).instrumentSync(fs.readFileSync(filePath, 'utf8'), filePath);
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require,
    console,
    URL,
    URLSearchParams,
    Date,
    Promise,
    Map,
    Set,
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: global.fetch && global.fetch._isMockFunction
      ? global.fetch
      : jest.fn().mockResolvedValue({
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
    },
    __coverage__: global.__coverage__ = global.__coverage__ || {}
  };

  vm.runInNewContext(
    `${source}\nmodule.exports = { NotificationManager, RedmineAPI, HOST_PERMISSION_RECOVERY_NOTIFICATION_ID, ensurePeriodicAlarm, notificationManager, ALARM_NAME, RETRY_ALARM_NAME, RETRY_METADATA_KEY };`,
    sandbox,
    { filename: filePath }
  );

  return sandbox.module.exports;
}

function createNotificationCheckLocalGet({
  lastSyncTime,
  issueStates = {},
  notificationHistory = [],
  seenNotifications = []
} = {}) {
  return jest.fn().mockImplementation(async keys => {
    if (Array.isArray(keys) && keys.includes('lastSyncTime')) {
      return lastSyncTime ? { lastSyncTime } : {};
    }

    if (Array.isArray(keys) && keys.includes('issueStates')) {
      return { issueStates };
    }

    if (Array.isArray(keys) && keys.includes('notificationHistory')) {
      return { notificationHistory };
    }

    if (Array.isArray(keys) && keys.includes('seenNotifications')) {
      return { seenNotifications };
    }

    return {};
  });
}

function createNotificationManagerSettings(overrides = {}) {
  return {
    redmineUrl: 'https://redmine.example.com',
    apiKey: 'valid-api-key-123',
    checkInterval: 15,
    enableNotifications: true,
    enableSound: true,
    maxNotifications: 50,
    readNotifications: [],
    onlyMyProjects: true,
    includeWatchedIssues: false,
    notificationProjectRules: {
      mode: 'all',
      includeProjectIds: [],
      excludeProjectIds: []
    },
    notificationChangeFilters: {
      status: true,
      assignee: true,
      priority: true,
      comment: true,
      generic: true
    },
    notificationQuietHours: {
      enabled: false,
      start: '22:00',
      end: '08:00'
    },
    notificationBundling: {
      enabled: false,
      windowMinutes: 5
    },
    ...overrides
  };
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
          includeWatchedIssues: false
        };
        return manager.settings;
      });

    await expect(manager.checkNotifications()).resolves.toEqual(expect.objectContaining({
      status: 'failure', errorCode: 'missingRequiredSettings'
    }));
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
        includeWatchedIssues: false,
        notificationProjectRules: expect.objectContaining({
          mode: 'all'
        }),
        notificationChangeFilters: expect.objectContaining({
          status: true
        }),
        notificationQuietHours: expect.objectContaining({
          enabled: false
        }),
        notificationBundling: expect.objectContaining({
          enabled: false,
          windowMinutes: 5
        })
      }));
      await expect(manager.checkNotifications()).resolves.toEqual(expect.objectContaining({
        status: 'failure', errorCode: 'missingRequiredSettings'
      }));
    });

  test('loads and caches notification project metadata for options consumers', async () => {
    const chromeMock = createChromeMock();
    chromeMock.storage.sync.get.mockResolvedValue({
      redmineUrl: 'https://redmine.example.com'
    });
    chromeMock.storage.local.get.mockImplementation(async keys => {
      if (Array.isArray(keys) && keys.includes('apiKey')) {
        return { apiKey: 'valid-api-key-123' };
      }

      return {};
    });
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    await manager.loadSettings();
    manager.settingsLoaded = true;
    manager.createApiClient = jest.fn().mockResolvedValue({
      getProjects: jest.fn().mockResolvedValue({
        projects: [
          { id: 2, name: 'Web', identifier: 'web' },
          { id: 1, name: 'API', identifier: 'api' }
        ]
      })
    });

    const result = await manager.getNotificationProjects();

    expect(result).toEqual({
      cached: false,
      projects: [
        { id: 1, name: 'API', identifier: 'api' },
        { id: 2, name: 'Web', identifier: 'web' }
      ]
    });
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      notificationProjectMetadataCache: expect.objectContaining({
        redmineUrl: 'https://redmine.example.com',
        projects: [
          { id: 1, name: 'API', identifier: 'api' },
          { id: 2, name: 'Web', identifier: 'web' }
        ]
      })
    }));
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
    expect(chromeMock.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({
      issueStates: expect.any(Object)
    }));
  });

  test('rejects a stale profile action before creating a Redmine client', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.activeProfile = { profileId: 'profile-b' };
    manager.profileState = {
      assertActiveProfile: jest.fn(async profileId => {
        if (profileId !== 'profile-b') {
          const error = new Error('profileMismatch');
          error.code = 'profileMismatch';
          throw error;
        }
      })
    };
    manager.createApiClient = jest.fn();

    await expect(manager.applyIssueChanges(1, { statusId: 2 }, 'profile-a')).resolves.toEqual(
      expect.objectContaining({ success: false, error: 'profileMismatch', status: 'failure' })
    );
    expect(manager.createApiClient).not.toHaveBeenCalled();
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

  test('bounds Redmine API cache size by evicting the earliest expiry', () => {
    const chromeMock = createChromeMock();
    const { RedmineAPI } = loadBackgroundModule(chromeMock);
    const api = new RedmineAPI('https://redmine.example.com', 'valid-api-key-123');
    api.maxCacheSize = 2;

    api.setCache('oldest', { value: 1 }, 1000);
    api.setCache('newer', { value: 2 }, 2000);
    api.setCache('newest', { value: 3 }, 3000);

    expect(api.getFromCache('oldest')).toBeNull();
    expect(api.getFromCache('newer')).toEqual({ value: 2 });
    expect(api.getFromCache('newest')).toEqual({ value: 3 });
    expect(api.cache.size).toBe(2);
  });

  test('stops retrying 429 responses after the retry limit is reached', async () => {
    const chromeMock = createChromeMock();
    global.fetch = jest.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: {
        get: jest.fn(() => '60')
      }
    });
    const { RedmineAPI } = loadBackgroundModule(chromeMock);
    const api = new RedmineAPI('https://redmine.example.com', 'valid-api-key-123');

    await expect(api.makeRequest('/issues.json', {}, 3)).rejects.toThrow('rateLimitRetryExceeded');
    const redmineCalls = global.fetch.mock.calls.filter(([url]) => (
      typeof url === 'string' && url === 'https://redmine.example.com/issues.json'
    ));
    expect(redmineCalls).toHaveLength(1);
    delete global.fetch;
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

    expect(result).toEqual(expect.objectContaining({
      success: false, error: 'permissionDenied', status: 'failure'
    }));
  });

  test('retains only the newest notification history records when saving', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.notificationHistoryLimit = 2;

    const retainedHistory = await manager.saveNotificationHistory([
      { id: 'issue_1', updatedOn: '2026-04-28T08:00:00.000Z' },
      { id: 'issue_2', updatedOn: '2026-04-29T08:00:00.000Z' },
      { id: 'issue_3', updatedOn: '2026-04-27T08:00:00.000Z' }
    ]);

    expect(retainedHistory.map(record => record.id)).toEqual(['issue_2', 'issue_1']);
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      notificationHistory: [
        expect.objectContaining({ id: 'issue_2', updatedOn: '2026-04-29T08:00:00.000Z' }),
        expect.objectContaining({ id: 'issue_1', updatedOn: '2026-04-28T08:00:00.000Z' })
      ]
    });
  });

  test('merges notification history with existing read state and legacy read ids', async () => {
    const chromeMock = createChromeMock();
    chromeMock.storage.local.get.mockResolvedValue({
      notificationHistory: [
        { id: 'issue_1', title: 'Existing issue', read: true, updatedOn: '2026-04-28T08:00:00.000Z' }
      ]
    });
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();

    const history = await manager.mergeNotificationHistory([
      { id: 'issue_1', title: 'Existing issue updated', read: false, updatedOn: '2026-04-29T08:00:00.000Z' },
      { id: 'issue_2', title: 'Legacy read issue', read: false, updatedOn: '2026-04-29T07:00:00.000Z' }
    ], {
      readNotificationIds: ['issue_2']
    });

    expect(history).toEqual([
      expect.objectContaining({ id: 'issue_1', read: true, title: 'Existing issue updated' }),
      expect.objectContaining({ id: 'issue_2', read: true })
    ]);
  });

  test('marks bundled notification records as read by their retained record id', async () => {
    const chromeMock = createChromeMock();
    chromeMock.storage.sync.get.mockResolvedValue({ readNotifications: [] });
    chromeMock.storage.local.get.mockImplementation(async keys => {
      if (Array.isArray(keys) && keys.includes('notificationHistory')) {
        return {
          notificationHistory: [
            {
              id: 'issue_21_1745913600000',
              issueId: 21,
              read: false,
              updatedOn: '2026-04-29T08:00:00.000Z'
            },
            {
              id: 'issue_21_1745914200000',
              issueId: 21,
              read: false,
              updatedOn: '2026-04-29T08:10:00.000Z'
            }
          ]
        };
      }

      return {};
    });
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.updateBadge = jest.fn();
    manager.notifications.set('issue_21_1745913600000', {
      id: 'issue_21_1745913600000',
      issueId: 21,
      read: false,
      updatedOn: new Date('2026-04-29T08:00:00.000Z')
    });
    manager.notifications.set('issue_21_1745914200000', {
      id: 'issue_21_1745914200000',
      issueId: 21,
      read: false,
      updatedOn: new Date('2026-04-29T08:10:00.000Z')
    });

    await manager.markAsRead('issue_21_1745914200000');

    expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({
      readNotifications: ['issue_21_1745914200000']
    });
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      notificationHistory: [
        expect.objectContaining({ id: 'issue_21_1745914200000', read: true, updatedOn: '2026-04-29T08:10:00.000Z' }),
        expect.objectContaining({ id: 'issue_21_1745913600000', read: false, updatedOn: '2026-04-29T08:00:00.000Z' })
      ]
    });
    expect(manager.updateBadge).toHaveBeenCalledWith(1);
  });

  test('trims read notifications to the newest 1000 entries when marking read', async () => {
    const chromeMock = createChromeMock();
    const existingReadIds = Array.from({ length: 1000 }, (_, index) => `issue_${index}`);
    const expectedReadIds = [
      ...existingReadIds.slice(1),
      'issue_new'
    ];
    chromeMock.storage.sync.get.mockResolvedValue({ readNotifications: existingReadIds });
    chromeMock.storage.local.get.mockResolvedValue({ notificationHistory: [] });
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.updateBadge = jest.fn();

    await manager.markAsRead('issue_new');

    expect(chromeMock.storage.sync.set).toHaveBeenCalledWith({
      readNotifications: expectedReadIds
    });
  });

  test('builds issue change summaries from comparable issue snapshots', () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();

    const changes = manager.buildIssueChangeSummary(
      {
        subject: 'Old subject',
        status: 'New',
        priority: 'Normal',
        assigneeId: 1,
        assigneeName: 'Alice',
        updatedOn: 1
      },
      {
        subject: 'New subject',
        status: 'In Progress',
        priority: 'High',
        assigneeId: 2,
        assigneeName: 'Bob',
        updatedOn: 2
      }
    );

    expect(changes).toEqual([
      { field: 'subject', from: 'Old subject', to: 'New subject' },
      { field: 'status', from: 'New', to: 'In Progress' },
      { field: 'priority', from: 'Normal', to: 'High' },
      { field: 'assignee', from: 'Alice', to: 'Bob' }
    ]);
  });

  test('classifies explicit journal note activity as comment and falls back to generic for unknown updates', () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    const previousState = {
      subject: 'Investigate alert fatigue',
      status: 'Open',
      priority: 'Normal',
      assigneeId: 1,
      assigneeName: 'Alice',
      updatedOn: 1
    };
    const currentState = {
      ...previousState,
      updatedOn: 2
    };

    expect(manager.classifyIssueUpdate(previousState, currentState, {
      journals: [{ notes: 'Added details for triage' }]
    })).toEqual(['comment']);
    expect(manager.classifyIssueUpdate(previousState, currentState, {})).toEqual(['generic']);
  });

  test('evaluates both daytime and overnight quiet hours correctly', () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();

    manager.settings = createNotificationManagerSettings({
      notificationQuietHours: {
        enabled: true,
        start: '09:00',
        end: '17:00'
      }
    });
    expect(manager.isWithinQuietHours(new Date(2026, 3, 29, 12, 0))).toBe(true);
    expect(manager.isWithinQuietHours(new Date(2026, 3, 29, 18, 0))).toBe(false);

    manager.settings = createNotificationManagerSettings({
      notificationQuietHours: {
        enabled: true,
        start: '22:00',
        end: '08:00'
      }
    });
    expect(manager.isWithinQuietHours(new Date(2026, 3, 29, 23, 30))).toBe(true);
    expect(manager.isWithinQuietHours(new Date(2026, 3, 29, 7, 30))).toBe(true);
    expect(manager.isWithinQuietHours(new Date(2026, 3, 29, 12, 0))).toBe(false);
  });

  test('suppresses new issues from projects outside the configured include list', async () => {
    const chromeMock = createChromeMock();
    chromeMock.storage.local.get = createNotificationCheckLocalGet();
    const { NotificationManager, RedmineAPI } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    await new Promise(resolve => setImmediate(resolve));
    manager.settingsLoaded = true;
    manager.settings = createNotificationManagerSettings({
      notificationProjectRules: {
        mode: 'include',
        includeProjectIds: [2],
        excludeProjectIds: []
      }
    });
    manager.ensureConfiguredHostAccess = jest.fn().mockResolvedValue(undefined);
    manager.showDesktopNotification = jest.fn();
    manager.updateBadge = jest.fn();
    const getIssuesSpy = jest.spyOn(RedmineAPI.prototype, 'getIssuesLossless').mockResolvedValue({
      issues: [
        {
          id: 7,
          subject: 'Muted project issue',
          project: { id: 1, name: 'API' },
          author: { name: 'Alice' },
          status: { name: 'New' },
          priority: { name: 'Normal' },
          updated_on: '2026-04-29T08:00:00.000Z'
        }
      ],
      total_count: 1,
      limit: 50
    });

    await manager.checkNotifications();

    expect(manager.showDesktopNotification).not.toHaveBeenCalled();
    expect(manager.notifications.size).toBe(0);
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      issueStates: expect.objectContaining({
        7: expect.objectContaining({
          subject: 'Muted project issue'
        })
      })
    }));
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      notificationHistory: []
    });

    getIssuesSpy.mockRestore();
  });

  test('retains quiet-hour notifications in history while skipping desktop delivery', async () => {
    const chromeMock = createChromeMock();
    chromeMock.storage.local.get = createNotificationCheckLocalGet();
    const { NotificationManager, RedmineAPI } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    await new Promise(resolve => setImmediate(resolve));
    manager.settingsLoaded = true;
    manager.settings = createNotificationManagerSettings({
      notificationQuietHours: {
        enabled: true,
        start: '22:00',
        end: '08:00'
      }
    });
    manager.ensureConfiguredHostAccess = jest.fn().mockResolvedValue(undefined);
    manager.showDesktopNotification = jest.fn();
    manager.updateBadge = jest.fn();
    jest.spyOn(manager, 'isWithinQuietHours').mockReturnValue(true);
    const getIssuesSpy = jest.spyOn(RedmineAPI.prototype, 'getIssuesLossless').mockResolvedValue({
      issues: [
        {
          id: 8,
          subject: 'Quiet-hours issue',
          project: { id: 2, name: 'Web' },
          author: { name: 'Bob' },
          status: { name: 'Open' },
          priority: { name: 'High' },
          updated_on: '2026-04-29T08:15:00.000Z'
        }
      ],
      total_count: 1,
      limit: 50
    });

    await manager.checkNotifications();

    expect(manager.showDesktopNotification).not.toHaveBeenCalled();
    expect(manager.notifications.get('issue_8')).toEqual(expect.objectContaining({
      id: 'issue_8',
      title: '#8: Quiet-hours issue'
    }));
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      notificationHistory: [
        expect.objectContaining({
          id: 'issue_8',
          title: '#8: Quiet-hours issue'
        })
      ]
    });
    expect(manager.updateBadge).toHaveBeenCalledWith(1);

    getIssuesSpy.mockRestore();
  });

  test('suppresses updated issues when every detected change category is disabled', async () => {
    const chromeMock = createChromeMock();
    chromeMock.storage.local.get = createNotificationCheckLocalGet({
      issueStates: {
        9: {
          subject: 'Status-only update',
          status: 'New',
          priority: 'Normal',
          assigneeId: 1,
          assigneeName: 'Alice',
          updatedOn: Date.parse('2026-04-29T08:00:00.000Z')
        }
      }
    });
    const { NotificationManager, RedmineAPI } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    await new Promise(resolve => setImmediate(resolve));
    manager.settingsLoaded = true;
    manager.settings = createNotificationManagerSettings({
      notificationChangeFilters: {
        status: false,
        assignee: true,
        priority: true,
        comment: true,
        generic: false
      }
    });
    manager.ensureConfiguredHostAccess = jest.fn().mockResolvedValue(undefined);
    manager.showDesktopNotification = jest.fn();
    manager.updateBadge = jest.fn();
    const getIssuesSpy = jest.spyOn(RedmineAPI.prototype, 'getIssuesLossless').mockResolvedValue({
      issues: [
        {
          id: 9,
          subject: 'Status-only update',
          project: { id: 2, name: 'Web' },
          author: { name: 'Alice' },
          status: { name: 'Resolved' },
          priority: { name: 'Normal' },
          assigned_to: { id: 1, name: 'Alice' },
          updated_on: '2026-04-29T09:00:00.000Z'
        }
      ],
      total_count: 1,
      limit: 50
    });

    await manager.checkNotifications();

    expect(manager.showDesktopNotification).not.toHaveBeenCalled();
    expect(manager.notifications.size).toBe(0);
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      issueStates: expect.objectContaining({
        9: expect.objectContaining({
          status: 'Resolved'
        })
      })
    }));

    getIssuesSpy.mockRestore();
  });

  test('bundles repeated issue updates within the configured window', async () => {
    const chromeMock = createChromeMock();
    const bundledRecordId = `issue_12_${Date.parse('2026-04-29T08:05:00.000Z')}`;
    chromeMock.storage.local.get = createNotificationCheckLocalGet({
      issueStates: {
        12: {
          subject: 'Bundled issue',
          status: 'In Progress',
          priority: 'Normal',
          assigneeId: 1,
          assigneeName: 'Alice',
          updatedOn: Date.parse('2026-04-29T08:05:00.000Z')
        }
      },
      notificationHistory: [
        {
          id: bundledRecordId,
          issueId: 12,
          title: '#12: Bundled issue',
          project: 'Web',
          author: 'Alice',
          status: 'In Progress',
          priority: 'Normal',
          projectId: 2,
          updatedOn: '2026-04-29T08:05:00.000Z',
          read: false,
          isUpdated: true,
          bundleCount: 1,
          changeSummary: [
            { field: 'status', from: 'New', to: 'In Progress' }
          ],
          lastSeenState: {
            subject: 'Bundled issue',
            status: 'In Progress',
            priority: 'Normal',
            assigneeId: 1,
            assigneeName: 'Alice',
            updatedOn: Date.parse('2026-04-29T08:05:00.000Z')
          }
        }
      ]
    });
    const { NotificationManager, RedmineAPI } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    await new Promise(resolve => setImmediate(resolve));
    manager.settingsLoaded = true;
    manager.settings = createNotificationManagerSettings({
      notificationBundling: {
        enabled: true,
        windowMinutes: 10
      }
    });
    manager.ensureConfiguredHostAccess = jest.fn().mockResolvedValue(undefined);
    manager.showDesktopNotification = jest.fn();
    manager.updateBadge = jest.fn();
    const getIssuesSpy = jest.spyOn(RedmineAPI.prototype, 'getIssuesLossless').mockResolvedValue({
      issues: [
        {
          id: 12,
          subject: 'Bundled issue',
          project: { id: 2, name: 'Web' },
          author: { name: 'Alice' },
          status: { name: 'In Progress' },
          priority: { name: 'High' },
          assigned_to: { id: 1, name: 'Alice' },
          updated_on: '2026-04-29T08:08:00.000Z'
        }
      ],
      total_count: 1,
      limit: 50
    });

    await manager.checkNotifications();

    expect(manager.showDesktopNotification).toHaveBeenCalledWith([
      expect.objectContaining({
        id: bundledRecordId,
        bundleCount: 2,
        updatedOn: new Date('2026-04-29T08:08:00.000Z'),
        changeSummary: expect.arrayContaining([
          expect.objectContaining({ field: 'status', from: 'New', to: 'In Progress' }),
          expect.objectContaining({ field: 'priority', from: 'Normal', to: 'High' })
        ])
      })
    ], 'updated');
    expect(manager.notifications.size).toBe(1);
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      notificationHistory: [
        expect.objectContaining({
          id: bundledRecordId,
          bundleCount: 2,
          updatedOn: '2026-04-29T08:08:00.000Z'
        })
      ]
    });

    getIssuesSpy.mockRestore();
  });

  test('keeps updates outside the bundling window as separate retained records', async () => {
    const chromeMock = createChromeMock();
    const firstRecordId = `issue_13_${Date.parse('2026-04-29T08:00:00.000Z')}`;
    const secondRecordId = `issue_13_${Date.parse('2026-04-29T08:12:00.000Z')}`;
    chromeMock.storage.local.get = createNotificationCheckLocalGet({
      issueStates: {
        13: {
          subject: 'Separate bundled issue',
          status: 'In Progress',
          priority: 'Normal',
          assigneeId: 2,
          assigneeName: 'Bob',
          updatedOn: Date.parse('2026-04-29T08:00:00.000Z')
        }
      },
      notificationHistory: [
        {
          id: firstRecordId,
          issueId: 13,
          title: '#13: Separate bundled issue',
          project: 'API',
          author: 'Bob',
          status: 'In Progress',
          priority: 'Normal',
          projectId: 3,
          updatedOn: '2026-04-29T08:00:00.000Z',
          read: false,
          isUpdated: true,
          bundleCount: 1,
          changeSummary: [
            { field: 'status', from: 'New', to: 'In Progress' }
          ],
          lastSeenState: {
            subject: 'Separate bundled issue',
            status: 'In Progress',
            priority: 'Normal',
            assigneeId: 2,
            assigneeName: 'Bob',
            updatedOn: Date.parse('2026-04-29T08:00:00.000Z')
          }
        }
      ]
    });
    const { NotificationManager, RedmineAPI } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    await new Promise(resolve => setImmediate(resolve));
    manager.settingsLoaded = true;
    manager.settings = createNotificationManagerSettings({
      notificationBundling: {
        enabled: true,
        windowMinutes: 5
      }
    });
    manager.ensureConfiguredHostAccess = jest.fn().mockResolvedValue(undefined);
    manager.showDesktopNotification = jest.fn();
    manager.updateBadge = jest.fn();
    const getIssuesSpy = jest.spyOn(RedmineAPI.prototype, 'getIssuesLossless').mockResolvedValue({
      issues: [
        {
          id: 13,
          subject: 'Separate bundled issue',
          project: { id: 3, name: 'API' },
          author: { name: 'Bob' },
          status: { name: 'Resolved' },
          priority: { name: 'Normal' },
          assigned_to: { id: 2, name: 'Bob' },
          updated_on: '2026-04-29T08:12:00.000Z'
        }
      ],
      total_count: 1,
      limit: 50
    });

    await manager.checkNotifications();

    expect(manager.showDesktopNotification).toHaveBeenCalledWith([
      expect.objectContaining({
        id: secondRecordId,
        bundleCount: 1,
        changeSummary: [
          { field: 'status', from: 'In Progress', to: 'Resolved' }
        ]
      })
    ], 'updated');
    expect(Array.from(manager.notifications.keys())).toEqual(
      expect.arrayContaining([firstRecordId, secondRecordId])
    );
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({
      notificationHistory: [
        expect.objectContaining({ id: secondRecordId, updatedOn: '2026-04-29T08:12:00.000Z' }),
        expect.objectContaining({ id: firstRecordId, updatedOn: '2026-04-29T08:00:00.000Z' })
      ]
    });

    getIssuesSpy.mockRestore();
  });

  test('message handler returns a useful error for non-Error throws', async () => {
    const chromeMock = createChromeMock();
    loadBackgroundModule(chromeMock);
    await new Promise(resolve => setImmediate(resolve));
    chromeMock.storage.sync.get.mockRejectedValue('storage unavailable');
    const handler = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    const keepsChannelOpen = handler({ action: 'markAllAsRead' }, {}, sendResponse);
    await new Promise(resolve => setImmediate(resolve));

    expect(keepsChannelOpen).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'storage unavailable'
    });
  });
});

describe('notification synchronization lifecycle', () => {
  afterEach(() => {
    delete global.chrome;
    jest.useRealTimers();
  });

  test('coalesces alarm popup and force triggers into one synchronization result', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    let finish;
    const result = { status: 'success', success: true };
    manager.checkNotifications = jest.fn(() => new Promise(resolve => { finish = resolve; }));

    const alarm = manager.requestSync('alarm');
    const popup = manager.requestSync('popup');
    const force = manager.requestSync('manual', { force: true });
    expect(alarm).toBe(popup);
    expect(popup).toBe(force);
    expect(manager.checkNotifications).toHaveBeenCalledTimes(1);
    finish(result);
    await expect(Promise.all([alarm, popup, force])).resolves.toEqual([result, result, result]);
    expect(manager.checkPromise).toBeNull();
  });

  test('clears single-flight state after rejection so a later run can start', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.checkNotifications = jest.fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce({ status: 'success' });
    await expect(manager.requestSync('first')).rejects.toThrow('failed');
    await expect(manager.requestSync('second')).resolves.toEqual({ status: 'success' });
    expect(manager.checkNotifications).toHaveBeenCalledTimes(2);
  });

  test('keeps an unchanged periodic alarm and replaces a changed one', async () => {
    const chromeMock = createChromeMock();
    const { ensurePeriodicAlarm, notificationManager } = loadBackgroundModule(chromeMock);
    notificationManager.loadSettings = jest.fn().mockResolvedValue();
    notificationManager.settings.checkInterval = 15;
    chromeMock.alarms.get.mockImplementation((_name, callback) => callback({ periodInMinutes: 15 }));
    await expect(ensurePeriodicAlarm()).resolves.toEqual(expect.objectContaining({ changed: false }));
    expect(chromeMock.alarms.create).not.toHaveBeenCalled();

    chromeMock.alarms.get.mockImplementation((_name, callback) => callback({ periodInMinutes: 10 }));
    await expect(ensurePeriodicAlarm()).resolves.toEqual(expect.objectContaining({ changed: true, periodInMinutes: 15 }));
    expect(chromeMock.alarms.clear).toHaveBeenCalled();
    expect(chromeMock.alarms.create).toHaveBeenCalledWith('redmine-notification-check', { periodInMinutes: 15 });

    chromeMock.alarms.create.mockClear();
    chromeMock.alarms.get.mockImplementation((_name, callback) => callback(undefined));
    await expect(ensurePeriodicAlarm()).resolves.toEqual(expect.objectContaining({ changed: true }));
    expect(chromeMock.alarms.create).toHaveBeenCalledWith('redmine-notification-check', { periodInMinutes: 15 });
  });

  test('aborts timed-out fetch and marks mutation outcome unknown without an open timer', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const chromeMock = createChromeMock();
    const { RedmineAPI } = loadBackgroundModule(chromeMock);
    const api = new RedmineAPI('https://redmine.example.com', 'valid-key');
    const request = api.makeRequest('/issues/1.json', { method: 'PUT', body: '{}' });
    const rejection = expect(request).rejects.toMatchObject({ message: 'connectionTimeout', code: 'outcomeUnknown' });
    jest.advanceTimersByTime(30000);
    await rejection;
    expect(jest.getTimerCount()).toBe(0);
  });

  test('schedules long rate-limit retry with capped persistent metadata', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.activeProfile = { profileId: 'profile-a' };
    const metadata = await manager.scheduleRetry({ retryCount: 2, retryAfterSeconds: 999 });
    expect(metadata).toEqual(expect.objectContaining({ retryCount: 2, profileId: 'profile-a' }));
    expect(metadata.nextAttemptAt).toBeLessThanOrEqual(Date.now() + 300000);
    expect(chromeMock.alarms.create).toHaveBeenCalledWith('redmine-notification-retry', { when: metadata.nextAttemptAt });
  });

  test('maps the sound preference to every desktop notification silent option', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.settings.enableSound = false;
    await manager.showDesktopNotification([{ id: 'one', title: 'One', project: 'Core' }]);
    expect(chromeMock.notifications.create.mock.calls.at(-1)[1]).toEqual(expect.objectContaining({ silent: true }));
    manager.settings.enableSound = true;
    await manager.showDesktopNotification([{ id: 'one', title: 'One', project: 'Core' }, { id: 'two', title: 'Two', project: 'Core' }]);
    expect(chromeMock.notifications.create.mock.calls.at(-1)[1]).toEqual(expect.objectContaining({ silent: false }));
  });
});

describe('lossless notification synchronization', () => {
  afterEach(() => delete global.chrome);

  test('processes all 25 paginated updates independently of a display limit of 10', async () => {
    const chromeMock = createChromeMock();
    const { RedmineAPI } = loadBackgroundModule(chromeMock);
    const api = new RedmineAPI('https://redmine.example.com', 'valid-key');
    api.currentUser = { id: 7 };
    const allIssues = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      updated_on: `2026-07-11T00:${String(index).padStart(2, '0')}:00.000Z`
    }));
    api.request = jest.fn(async endpoint => {
      const url = new URL(`https://redmine.example.com${endpoint}`);
      const offset = Number(url.searchParams.get('offset'));
      return { issues: allIssues.slice(offset, offset + 10), total_count: 25, offset, limit: 10 };
    });
    const result = await api.getIssuesLossless({ onlyMyProjects: true, cursor: '2026-07-11T00:10:00.000Z' });
    expect(result.issues).toHaveLength(25);
    expect(api.request).toHaveBeenCalledTimes(3);
    const endpoints = api.request.mock.calls.map(call => call[0]);
    expect(endpoints).toEqual(expect.arrayContaining([
      expect.stringContaining('offset=0'), expect.stringContaining('offset=10'), expect.stringContaining('offset=20')
    ]));
    expect(endpoints[0]).toContain('status_id=*');
    expect(endpoints[0]).toContain('updated_on=%3E%3D');
  });

  test('deduplicates equal timestamp events across assigned and watched pages', async () => {
    const chromeMock = createChromeMock();
    const { RedmineAPI } = loadBackgroundModule(chromeMock);
    const api = new RedmineAPI('https://redmine.example.com', 'valid-key');
    api.currentUser = { id: 7 };
    api.request = jest.fn().mockResolvedValue({
      issues: [{ id: 1, updated_on: '2026-07-11T01:00:00.000Z' }], total_count: 1, limit: 100
    });
    const result = await api.getIssuesLossless({ onlyMyProjects: true, includeWatchedIssues: true });
    expect(result.issues).toHaveLength(1);
    expect(api.request).toHaveBeenCalledTimes(2);
  });

  test('classifies reconciled 404 and 403 as stable unavailable tombstones', async () => {
    const chromeMock = createChromeMock();
    const { RedmineAPI } = loadBackgroundModule(chromeMock);
    const api = new RedmineAPI('https://redmine.example.com', 'valid-key');
    api.request = jest.fn()
      .mockRejectedValueOnce(new Error('Resource not found 404'))
      .mockRejectedValueOnce(new Error('Access forbidden 403'))
      .mockResolvedValueOnce({ issue: { id: 3, updated_on: '2026-07-11T02:00:00.000Z', assigned_to: { id: 99 } } });
    await expect(api.reconcileIssueIds([1, 2, 3])).resolves.toEqual([
      expect.objectContaining({ id: 1, unavailable: true, errorCode: 'unavailable' }),
      expect.objectContaining({ id: 2, unavailable: true, errorCode: 'unavailable' }),
      expect.objectContaining({ id: 3, sourceType: 'reconciled' })
    ]);
  });

  test('does not advance cursor when an earlier durable state write fails', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager, RedmineAPI } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.settingsLoaded = true;
    manager.settings = createNotificationManagerSettings({ maxNotifications: 10 });
    manager.activeProfile = { profileId: 'profile-a' };
    manager.resolveActiveProfile = jest.fn().mockResolvedValue(manager.activeProfile);
    manager.ensureConfiguredHostAccess = jest.fn().mockResolvedValue();
    const writes = [];
    manager.profileState = {
      read: jest.fn(async (_profile, domain, fallback) => domain === 'cursor'
        ? { watermark: '2026-07-11T00:00:00.000Z', eventIds: [], reconciliationQueue: [], lastFullReconciliationAt: new Date().toISOString() }
        : fallback),
      write: jest.fn(async (_profile, domain) => {
        writes.push(domain);
        if (domain === 'history') throw new Error('history storage failed');
      })
    };
    jest.spyOn(RedmineAPI.prototype, 'getIssuesLossless').mockResolvedValue({ issues: [], total_count: 0, limit: 100 });
    const result = await manager.checkNotifications();
    expect(result).toEqual(expect.objectContaining({ success: false, errorCode: 'syncFailed' }));
    expect(writes).not.toContain('cursor');
  });

  test('replays overlap idempotently and tolerates clock skew without duplicate delivery', async () => {
    const chromeMock = createChromeMock();
    const localState = { lastSyncTime: '2026-07-11T00:10:00.000Z', issueStates: {}, notificationHistory: [], seenNotifications: [] };
    chromeMock.storage.local.get.mockImplementation(async keys => {
      const result = {};
      (Array.isArray(keys) ? keys : []).forEach(key => { if (localState[key] !== undefined) result[key] = localState[key]; });
      return result;
    });
    chromeMock.storage.local.set.mockImplementation(async values => Object.assign(localState, values));
    chromeMock.storage.local.remove.mockImplementation(async keys => (Array.isArray(keys) ? keys : [keys]).forEach(key => delete localState[key]));
    const { NotificationManager, RedmineAPI } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.settingsLoaded = true;
    manager.settings = createNotificationManagerSettings();
    manager.showDesktopNotification = jest.fn();
    const issue = {
      id: 42, subject: 'Clock skew update', project: { id: 1, name: 'Core' }, author: { name: 'Alice' },
      status: { name: 'New' }, priority: { name: 'Normal' }, assigned_to: { id: 7, name: 'Alice' },
      updated_on: '2026-07-11T00:09:30.000Z', sourceType: 'assigned'
    };
    jest.spyOn(RedmineAPI.prototype, 'getIssuesLossless').mockResolvedValue({ issues: [issue], total_count: 1, limit: 100 });
    jest.spyOn(RedmineAPI.prototype, 'reconcileIssueIds').mockResolvedValue([]);

    await manager.checkNotifications();
    await manager.checkNotifications();
    expect(manager.showDesktopNotification).toHaveBeenCalledTimes(1);
    expect(localState.issueStates[42]).toEqual(expect.objectContaining({ subject: 'Clock skew update' }));
  });

  test('classifies closed and reassigned reconciliation once while applying focus rules', async () => {
    const chromeMock = createChromeMock();
    const priorTime = new Date('2026-07-11T00:00:00.000Z').getTime();
    const localState = {
      lastSyncTime: '2026-07-11T00:05:00.000Z',
      issueStates: {
        1: { subject: 'Close me', status: 'Open', priority: 'Normal', assigneeId: 7, assigneeName: 'Alice', updatedOn: priorTime },
        2: { subject: 'Move me', status: 'Open', priority: 'Normal', assigneeId: 7, assigneeName: 'Alice', updatedOn: priorTime }
      }, notificationHistory: [], seenNotifications: []
    };
    chromeMock.storage.local.get.mockImplementation(async keys => {
      const result = {};
      (Array.isArray(keys) ? keys : []).forEach(key => { if (localState[key] !== undefined) result[key] = localState[key]; });
      return result;
    });
    chromeMock.storage.local.set.mockImplementation(async values => Object.assign(localState, values));
    chromeMock.storage.local.remove.mockResolvedValue();
    const { NotificationManager, RedmineAPI } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    manager.settingsLoaded = true;
    manager.settings = createNotificationManagerSettings({
      notificationProjectRules: { mode: 'exclude', includeProjectIds: [], excludeProjectIds: [9] }
    });
    manager.showDesktopNotification = jest.fn();
    jest.spyOn(RedmineAPI.prototype, 'getIssuesLossless').mockResolvedValue({ issues: [], total_count: 0, limit: 100 });
    jest.spyOn(RedmineAPI.prototype, 'reconcileIssueIds').mockResolvedValue([
      { id: 1, subject: 'Close me', project: { id: 1, name: 'Core' }, author: { name: 'Alice' }, status: { name: 'Closed' }, priority: { name: 'Normal' }, assigned_to: { id: 7, name: 'Alice' }, updated_on: '2026-07-11T00:06:00.000Z', sourceType: 'reconciled' },
      { id: 2, subject: 'Move me', project: { id: 9, name: 'Excluded' }, author: { name: 'Alice' }, status: { name: 'Open' }, priority: { name: 'Normal' }, assigned_to: { id: 99, name: 'Bob' }, updated_on: '2026-07-11T00:06:00.000Z', sourceType: 'reconciled' }
    ]);

    await manager.checkNotifications();
    expect(manager.showDesktopNotification).toHaveBeenCalledWith([
      expect.objectContaining({ issueId: 1, status: 'Closed', sourceType: 'reconciled' })
    ], 'updated');
    expect(localState.issueStates[2]).toEqual(expect.objectContaining({ assigneeId: 99 }));
  });
});

describe('desktop notification actions', () => {
  afterEach(() => delete global.chrome);

  function configureDesktopManager(manager, profileId = 'profile-a') {
    const state = {
      desktopMappings: [],
      history: [{
        id: 'record-1', profileId, issueId: 1, title: 'Issue 1', project: 'Core',
        updatedOn: '2026-07-11T00:00:00.000Z', url: 'https://redmine.example.com/issues/1', read: false
      }],
      readIds: [],
      syncHealth: {}
    };
    manager.settings = createNotificationManagerSettings();
    manager.activeProfile = { profileId };
    manager.profileState = {
      createBindingId: jest.fn(() => 'opaque-token'),
      assertActiveProfile: jest.fn(async requested => {
        if (requested !== manager.activeProfile.profileId) throw new Error('profileMismatch');
      }),
      read: jest.fn(async (_profile, domain, fallback) => state[domain] ?? fallback),
      write: jest.fn(async (_profile, domain, value) => { state[domain] = value; return value; })
    };
    return state;
  }

  test('creates durable single mapping with two buttons and opens it after worker restart', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const first = new NotificationManager();
    const state = configureDesktopManager(first);
    await first.showDesktopNotification([state.history[0]], 'new');
    expect(state.desktopMappings).toEqual([expect.objectContaining({
      desktopId: 'issue:opaquetoken', profileId: 'profile-a', recordId: 'record-1', type: 'single'
    })]);
    expect(chromeMock.notifications.create).toHaveBeenCalledWith(
      'issue:opaquetoken',
      expect.objectContaining({ buttons: [{ title: 'openIssue' }, { title: 'markAsRead' }] }),
      expect.any(Function)
    );

    const restarted = new NotificationManager();
    configureDesktopManager(restarted);
    restarted.profileState.read.mockImplementation(async (_profile, domain, fallback) => state[domain] ?? fallback);
    await expect(restarted.handleDesktopClick('issue:opaquetoken')).resolves.toBe(true);
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: 'https://redmine.example.com/issues/1' });
  });

  test('batch click opens inbox while unknown, expired, invalid and cross-profile mappings open no URL', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    const state = configureDesktopManager(manager);
    state.desktopMappings = [
      { desktopId: 'batch:one', profileId: 'profile-a', type: 'batch', expiresAt: Date.now() + 10000 },
      { desktopId: 'issue:expired', profileId: 'profile-a', recordId: 'record-1', issueUrl: state.history[0].url, type: 'single', expiresAt: Date.now() - 1 },
      { desktopId: 'issue:invalid', profileId: 'profile-a', recordId: 'record-1', issueUrl: 'https://evil.example/issues/1', type: 'single', expiresAt: Date.now() + 10000 }
    ];
    await expect(manager.handleDesktopClick('batch:one')).resolves.toBe(true);
    await expect(manager.handleDesktopClick('issue:expired')).resolves.toBe(false);
    await expect(manager.handleDesktopClick('issue:invalid')).resolves.toBe(false);
    await expect(manager.handleDesktopClick('legacy-id')).resolves.toBe(false);
    expect(chromeMock.action.openPopup).toHaveBeenCalled();
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();

    state.desktopMappings = [{ desktopId: 'issue:cross', profileId: 'profile-b', recordId: 'record-1', issueUrl: state.history[0].url, type: 'single', expiresAt: Date.now() + 10000 }];
    await expect(manager.handleDesktopClick('issue:cross')).resolves.toBe(false);
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
  });

  test('mark-read button is idempotent, clears mapping on success and preserves it on failure', async () => {
    const chromeMock = createChromeMock();
    const { NotificationManager } = loadBackgroundModule(chromeMock);
    const manager = new NotificationManager();
    const state = configureDesktopManager(manager);
    const mapping = await manager.createDesktopMapping(state.history[0], 'single');
    manager.markAsRead = jest.fn().mockResolvedValue();
    await expect(manager.handleDesktopButton(mapping.desktopId, 0)).resolves.toBe(true);
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: state.history[0].url });
    await expect(manager.handleDesktopButton(mapping.desktopId, 1)).resolves.toBe(true);
    expect(manager.markAsRead).toHaveBeenCalledWith('record-1', 'profile-a');
    expect(state.desktopMappings).toEqual([]);
    await expect(manager.handleDesktopButton(mapping.desktopId, 1)).resolves.toBe(false);
    expect(manager.markAsRead).toHaveBeenCalledTimes(1);

    const failed = await manager.createDesktopMapping(state.history[0], 'single');
    manager.markAsRead.mockRejectedValueOnce(new Error('storage failed'));
    await expect(manager.handleDesktopButton(failed.desktopId, 1)).resolves.toBe(false);
    expect(state.desktopMappings).toHaveLength(1);
    expect(state.syncHealth.lastErrorCode).toBe('desktopMarkReadFailed');
    await manager.removeDesktopMapping(failed.desktopId);
    expect(state.desktopMappings).toEqual([]);
  });
});
