const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ConfigManager } = require('./shared/config-manager.js');

function createMockElement(overrides = {}) {
  const element = {
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    className: '',
    disabled: false,
    style: { display: 'none' },
    dataset: {},
    options: [],
    children: [],
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    appendChild: jest.fn((child) => {
      element.children.push(child);
      if (
        child
        && (
          child.type === 'checkbox'
          || (typeof child.className === 'string' && child.className.includes('project-checkbox-input'))
        )
      ) {
        element.projectCheckboxInput = child;
      }
      if (Array.isArray(element.options)) {
        element.options.push(child);
      }
      return child;
    }),
    insertBefore: jest.fn((child, before) => {
      element.children.push(child);
      if (Array.isArray(element.options)) {
        const targetIndex = element.options.indexOf(before);
        if (targetIndex === -1) {
          element.options.push(child);
        } else {
          element.options.splice(targetIndex, 0, child);
        }
      }
      return child;
    }),
    querySelectorAll: jest.fn(() => []),
    classList: {
      add: jest.fn(),
      remove: jest.fn()
    },
    setAttribute: jest.fn((name, value) => {
      element[name] = value;
    }),
    ...overrides
  };

  return element;
}

function createProjectSelectionElement() {
  const element = createMockElement({
    children: []
  });

  element.querySelectorAll = jest.fn((selector) => {
    if (selector === '.project-checkbox-input') {
      return element.children
        .map(child => child.projectCheckboxInput)
        .filter(Boolean);
    }

    return [];
  });

  element.appendChild = jest.fn((child) => {
    element.children.push(child);
    return child;
  });

  return element;
}

function createDocument(elements) {
  return {
    getElementById: jest.fn((id) => {
      if (!elements[id]) {
        elements[id] = createMockElement();
      }

      return elements[id];
    }),
    querySelectorAll: jest.fn(() => []),
    querySelector: jest.fn(() => null),
    addEventListener: jest.fn(),
    createElement: jest.fn(() => createMockElement())
  };
}

function loadBrowserClass(relativePath, exportName) {
  const filePath = path.join(__dirname, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require,
    console,
    URL,
    setTimeout,
    clearTimeout,
    document: global.document,
    window: global.window,
    chrome: global.chrome,
    fetch: global.fetch,
    confirm: global.confirm,
    alert: global.alert,
    ConfigManager: global.ConfigManager
  };

  vm.runInNewContext(`${source}\nmodule.exports = ${exportName};`, sandbox, {
    filename: filePath
  });

  return sandbox.module.exports;
}

describe('OptionsManager', () => {
  let OptionsManager;
  let elements;
  let manager;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.resetModules();

    elements = {
      connectionStatus: createMockElement(),
      redmineStatus: createMockElement(),
      notificationsStatus: createMockElement(),
      saveNotificationsBtn: createMockElement(),
      testConnectionBtn: createMockElement(),
      redmineUrl: createMockElement({ value: 'https://redmine.example.com' }),
      apiKey: createMockElement({ value: 'valid-api-key-123' }),
      checkInterval: createMockElement({ value: '30' }),
      maxNotifications: createMockElement({ value: '100' }),
      enableNotifications: createMockElement({ checked: true }),
      enableSound: createMockElement({ checked: false }),
      onlyMyProjects: createMockElement({ checked: true }),
      includeWatchedIssues: createMockElement({ checked: false }),
      notificationProjectRuleModeAll: createMockElement({ checked: true }),
      notificationProjectRuleModeInclude: createMockElement({ checked: false }),
      notificationProjectRuleModeExclude: createMockElement({ checked: false }),
      refreshNotificationProjectsBtn: createMockElement(),
      notificationProjectSelection: createProjectSelectionElement(),
      notificationProjectStatus: createMockElement(),
      notificationChangeFilterStatus: createMockElement({ checked: true }),
      notificationChangeFilterAssignee: createMockElement({ checked: true }),
      notificationChangeFilterPriority: createMockElement({ checked: true }),
      notificationChangeFilterComment: createMockElement({ checked: false }),
      notificationChangeFilterGeneric: createMockElement({ checked: true }),
      notificationQuietHoursEnabled: createMockElement({ checked: true }),
      notificationQuietHoursStart: createMockElement({ value: '22:00' }),
      notificationQuietHoursEnd: createMockElement({ value: '08:00' }),
      notificationBundlingEnabled: createMockElement({ checked: true }),
      notificationBundlingWindow: createMockElement({
        value: '15',
        options: [
          { value: '5', text: '5 minutes' },
          { value: '10', text: '10 minutes' },
          { value: '15', text: '15 minutes' },
          { value: '30', text: '30 minutes' }
        ]
      }),
      languageSelect: createMockElement({ value: 'en', options: [] })
    };

    global.window = { close: jest.fn() };
    global.ConfigManager = ConfigManager;
    global.confirm = jest.fn(() => true);
    global.alert = jest.fn();
    global.fetch = jest.fn();
    global.chrome = {
      storage: {
        sync: {
          get: jest.fn(),
          set: jest.fn(),
          remove: jest.fn()
        },
        local: {
          get: jest.fn(),
          set: jest.fn(),
          remove: jest.fn()
        },
        onChanged: {
          addListener: jest.fn()
        }
      },
      permissions: {
        contains: jest.fn(),
        request: jest.fn(),
        remove: jest.fn()
      },
      runtime: {
        sendMessage: jest.fn(),
        openOptionsPage: jest.fn()
      }
    };
    global.document = createDocument(elements);

    OptionsManager = loadBrowserClass('options.js', 'OptionsManager');
    OptionsManager.prototype.init = jest.fn();

    manager = new OptionsManager();
    manager.translate = jest.fn((key) => key);
    manager.settings = {
      redmineUrl: '',
      apiKey: '',
      checkInterval: 15,
      enableNotifications: true,
      enableSound: true,
      onlyMyProjects: true,
      includeWatchedIssues: false,
      maxNotifications: 50,
      language: 'en',
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
      }
    };
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('validates URLs and rejects unsupported protocols', () => {
    expect(manager.validateUrl('https://redmine.example.com')).toEqual({
      valid: true,
      normalizedUrl: 'https://redmine.example.com',
      warningMessage: undefined,
      originPattern: 'https://redmine.example.com/*'
    });
    expect(manager.validateUrl('')).toEqual({
      valid: false,
      message: 'urlRequired'
    });
    expect(manager.validateUrl('http://redmine.example.com')).toEqual({
      valid: true,
      normalizedUrl: 'http://redmine.example.com',
      warningMessage: 'insecureDevelopmentUrlWarning',
      originPattern: 'http://redmine.example.com/*'
    });
    expect(manager.validateUrl('ftp://redmine.example.com')).toEqual({
      valid: false,
      message: 'urlMustBeHttpOrHttps'
    });
    expect(manager.validateUrl('http://localhost:3000')).toEqual({
      valid: true,
      normalizedUrl: 'http://localhost:3000',
      warningMessage: 'insecureDevelopmentUrlWarning',
      originPattern: 'http://localhost/*'
    });
  });

  test('validates API keys and blocks malformed values', () => {
    expect(manager.validateApiKey('valid-api-key-123')).toEqual({ valid: true });
    expect(manager.validateApiKey('short')).toEqual({
      valid: false,
      message: 'apiKeyTooShort'
    });
    expect(manager.validateApiKey('invalid key')).toEqual({
      valid: false,
      message: 'apiKeyInvalidFormat'
    });
  });

  test('saves notification settings with sanitized numeric values', async () => {
    global.chrome.storage.sync.set.mockResolvedValue(undefined);

    await manager.saveNotificationSettings();

    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({
      checkInterval: 30,
      enableNotifications: true,
      enableSound: false,
      onlyMyProjects: true,
      includeWatchedIssues: false,
      maxNotifications: 100,
      notificationProjectRules: {
        mode: 'all',
        includeProjectIds: [],
        excludeProjectIds: []
      },
      notificationChangeFilters: {
        status: true,
        assignee: true,
        priority: true,
        comment: false,
        generic: true
      },
      notificationQuietHours: {
        enabled: true,
        start: '22:00',
        end: '08:00'
      },
      notificationBundling: {
        enabled: true,
        windowMinutes: 15
      }
    });
    expect(manager.settings).toMatchObject({
      checkInterval: 30,
      enableNotifications: true,
      enableSound: false,
      onlyMyProjects: true,
      includeWatchedIssues: false,
      maxNotifications: 100,
      notificationBundling: {
        enabled: true,
        windowMinutes: 15
      }
    });
    expect(elements.notificationsStatus.className).toBe('status-message success');
    expect(elements.notificationsStatus.textContent).toBe('notificationSettingsSaved');
    expect(elements.saveNotificationsBtn.disabled).toBe(false);
    expect(elements.saveNotificationsBtn.textContent).toBe('saveNotificationSettings');
  });

  test('saves Redmine settings to sync/local storage and requests origin permission', async () => {
    global.chrome.permissions.contains.mockResolvedValue(false);
    global.chrome.permissions.request.mockResolvedValue(true);
    global.chrome.storage.sync.set.mockResolvedValue(undefined);
    global.chrome.storage.local.set.mockResolvedValue(undefined);

    await manager.saveRedmineSettings();

    expect(global.chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['https://redmine.example.com/*']
    });
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({
      redmineUrl: 'https://redmine.example.com'
    });
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({
      apiKey: 'valid-api-key-123'
    });
    expect(elements.redmineStatus.className).toBe('status-message success');
    expect(elements.redmineStatus.textContent).toBe('redmineSettingsSaved');
  });

  test('shows a red warning state when saving an HTTP Redmine URL', async () => {
    elements.redmineUrl.value = 'http://redmine.example.com';
    global.chrome.permissions.contains.mockResolvedValue(false);
    global.chrome.permissions.request.mockResolvedValue(true);
    global.chrome.storage.sync.set.mockResolvedValue(undefined);
    global.chrome.storage.local.set.mockResolvedValue(undefined);

    await manager.saveRedmineSettings();

    expect(elements.redmineStatus.className).toBe('status-message warning');
    expect(elements.redmineStatus.textContent).toBe(
      'redmineSettingsSaved insecureDevelopmentUrlWarning'
    );
  });

  test('requests host permission without including an explicit port', async () => {
    elements.redmineUrl.value = 'https://redmine.example.com:8443';
    global.chrome.permissions.contains.mockResolvedValue(false);
    global.chrome.permissions.request.mockResolvedValue(true);
    global.chrome.storage.sync.set.mockResolvedValue(undefined);
    global.chrome.storage.local.set.mockResolvedValue(undefined);

    await manager.saveRedmineSettings();

    expect(global.chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['https://redmine.example.com/*']
    });
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({
      redmineUrl: 'https://redmine.example.com:8443'
    });
  });

  test('removes previously granted host access when Redmine origin changes', async () => {
    elements.redmineUrl.value = 'https://next.example.com';
    manager.settings.redmineUrl = 'https://redmine.example.com';
    global.chrome.permissions.contains
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    global.chrome.permissions.request.mockResolvedValue(true);
    global.chrome.permissions.remove.mockResolvedValue(true);
    global.chrome.storage.sync.set.mockResolvedValue(undefined);
    global.chrome.storage.local.set.mockResolvedValue(undefined);

    await manager.saveRedmineSettings();

    expect(global.chrome.permissions.remove).toHaveBeenCalledWith({
      origins: ['https://redmine.example.com/*']
    });
  });

  test('does not remove host access when only the Redmine path changes on the same origin', async () => {
    elements.redmineUrl.value = 'https://redmine.example.com/redmine';
    manager.settings.redmineUrl = 'https://redmine.example.com';
    global.chrome.permissions.contains.mockResolvedValue(false);
    global.chrome.permissions.request.mockResolvedValue(true);
    global.chrome.storage.sync.set.mockResolvedValue(undefined);
    global.chrome.storage.local.set.mockResolvedValue(undefined);

    await manager.saveRedmineSettings();

    expect(global.chrome.permissions.remove).not.toHaveBeenCalled();
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({
      redmineUrl: 'https://redmine.example.com/redmine'
    });
  });

  test('shows validation errors before saving invalid notification settings', async () => {
    elements.checkInterval.value = '0';

    await manager.saveNotificationSettings();

    expect(global.chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(elements.notificationsStatus.className).toBe('status-message error');
    expect(elements.notificationsStatus.textContent).toBe('numberOutOfRange');
  });

  test('shows validation errors when quiet hours start and end match', async () => {
    elements.notificationQuietHoursEnabled.checked = true;
    elements.notificationQuietHoursStart.value = '09:00';
    elements.notificationQuietHoursEnd.value = '09:00';

    await manager.saveNotificationSettings();

    expect(global.chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(elements.notificationsStatus.className).toBe('status-message error');
    expect(elements.notificationsStatus.textContent).toBe('quietHoursStartEndSame');
  });

  test('defaults blank quiet hours time inputs to ConfigManager defaults and saves', async () => {
    elements.notificationQuietHoursEnabled.checked = true;
    elements.notificationQuietHoursStart.value = '';
    elements.notificationQuietHoursEnd.value = '';
    global.chrome.storage.sync.set.mockResolvedValue(undefined);
    global.chrome.storage.local.set.mockResolvedValue(undefined);

    await manager.saveNotificationSettings();

    expect(elements.notificationQuietHoursStart.value).toBe('22:00');
    expect(elements.notificationQuietHoursEnd.value).toBe('08:00');
    expect(global.chrome.storage.sync.set).toHaveBeenCalled();
    expect(elements.notificationsStatus.className).toBe('status-message success');
  });

  test('loads notification projects from the background and renders sorted options', async () => {
    manager.settings.redmineUrl = 'https://redmine.example.com';
    manager.settings.apiKey = 'valid-api-key-123';
    global.chrome.runtime.sendMessage.mockResolvedValue({
      success: true,
      projects: [
        { id: 2, name: 'Web', identifier: 'web' },
        { id: 1, name: 'API', identifier: 'api' }
      ]
    });

    await manager.loadNotificationProjects();

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'getNotificationProjects',
      forceRefresh: false
    });
    expect(elements.notificationProjectSelection.children).toHaveLength(2);
    expect(elements.notificationProjectSelection.children[0].projectCheckboxInput).toMatchObject({
      value: '1',
      checked: false
    });
    expect(elements.notificationProjectSelection.children[0].children[1].textContent).toBe('API (api)');
    expect(elements.notificationProjectSelection.children[1].projectCheckboxInput).toMatchObject({
      value: '2',
      checked: false
    });
    expect(elements.notificationProjectSelection.children[1].children[1].textContent).toBe('Web (web)');
  });

  test('saves included project ids from the checkbox list', async () => {
    elements.notificationProjectRuleModeAll.checked = false;
    elements.notificationProjectRuleModeInclude.checked = true;
    manager.availableNotificationProjects = [
      { id: 2, name: 'Web', identifier: 'web' },
      { id: 1, name: 'API', identifier: 'api' }
    ];
    manager.settings.notificationProjectRules = {
      mode: 'include',
      includeProjectIds: [1],
      excludeProjectIds: []
    };
    manager.renderNotificationProjectOptions();
    global.chrome.storage.sync.set.mockResolvedValue(undefined);

    const projectCheckboxes = elements.notificationProjectSelection.querySelectorAll('.project-checkbox-input');
    projectCheckboxes.find(checkbox => checkbox.value === '1').checked = true;
    projectCheckboxes.find(checkbox => checkbox.value === '2').checked = false;

    await manager.saveNotificationSettings();

    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith(expect.objectContaining({
      notificationProjectRules: {
        mode: 'include',
        includeProjectIds: [1],
        excludeProjectIds: []
      }
    }));
  });

  test('stops connection tests when Redmine URL is invalid', async () => {
    elements.redmineUrl.value = 'invalid-url';

    await manager.testConnection();

    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(elements.connectionStatus.className).toBe('status-message error');
    expect(elements.connectionStatus.textContent).toBe('invalidUrlFormat');
    expect(elements.testConnectionBtn.disabled).toBe(false);
    expect(elements.testConnectionBtn.textContent).toBe('');
  });

  test('stops connection tests when host access is denied', async () => {
    global.chrome.permissions.contains.mockResolvedValue(false);
    global.chrome.permissions.request.mockResolvedValue(false);

    await manager.testConnection();

    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(elements.connectionStatus.className).toBe('status-message error');
    expect(elements.connectionStatus.textContent).toBe('hostPermissionDenied');
  });

  test('shows a red warning state when testing an HTTP Redmine URL succeeds', async () => {
    elements.redmineUrl.value = 'http://redmine.example.com';
    global.chrome.permissions.contains.mockResolvedValue(false);
    global.chrome.permissions.request.mockResolvedValue(true);
    global.chrome.runtime.sendMessage.mockResolvedValue({ success: true });

    await manager.testConnection();

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'testConnection',
      redmineUrl: 'http://redmine.example.com',
      apiKey: 'valid-api-key-123'
    });
    expect(elements.connectionStatus.className).toBe('status-message warning');
    expect(elements.connectionStatus.textContent).toBe(
      'connectionSuccess insecureDevelopmentUrlWarning'
    );
  });

  test('migrates legacy API key from sync storage into local settings', async () => {
    global.chrome.storage.sync.get.mockResolvedValue({
      redmineUrl: 'https://redmine.example.com',
      checkInterval: 15,
      enableNotifications: true,
      enableSound: true,
      maxNotifications: 50,
      language: 'en',
      onlyMyProjects: true,
      includeWatchedIssues: false,
      apiKey: 'legacy-api-key'
    });
    global.chrome.storage.local.get.mockResolvedValue({});
    global.chrome.storage.local.set.mockResolvedValue(undefined);
    global.chrome.storage.sync.remove.mockResolvedValue(undefined);

    await manager.loadSettings();

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ apiKey: 'legacy-api-key' });
    expect(global.chrome.storage.sync.remove).toHaveBeenCalledWith(['apiKey']);
  });

  test('shows recovery guidance when configured host access is missing', async () => {
    manager.settings.redmineUrl = 'https://redmine.example.com';
    manager.settings.apiKey = 'valid-api-key-123';
    global.chrome.permissions.contains.mockResolvedValue(false);

    await manager.syncConfiguredPermissionStatus();

    expect(elements.redmineStatus.className).toBe('status-message info');
    expect(elements.redmineStatus.textContent).toBe('hostPermissionRequired');
    expect(elements.redmineStatus.style.display).toBe('block');
  });

  test('sanitizes user input and redacts secrets from error messages', () => {
    expect(manager.sanitizeInput('  api-key\x00test  ')).toBe('api-keytest');
    expect(
      manager.sanitizeErrorMessage(
        'Request to https://redmine.example.com failed for token abcdefghijklmnopqrstuvwxyz'
      )
    ).toContain('[URL]');
    expect(
      manager.sanitizeErrorMessage(
        'Request to https://redmine.example.com failed for token abcdefghijklmnopqrstuvwxyz'
      )
    ).toContain('[KEY]');
  });
});
