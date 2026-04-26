const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ConfigManager } = require('./shared/config-manager.js');

function createMockElement(overrides = {}) {
  return {
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    className: '',
    disabled: false,
    style: { display: 'none' },
    dataset: {},
    options: [],
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    appendChild: jest.fn(),
    insertBefore: jest.fn(),
    ...overrides
  };
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
      language: 'en'
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
      valid: false,
      message: 'httpsRequiredForRemoteUrls'
    });
    expect(manager.validateUrl('ftp://redmine.example.com')).toEqual({
      valid: false,
      message: 'urlMustBeHttpOrHttps'
    });
    expect(manager.validateUrl('http://localhost:3000')).toEqual({
      valid: true,
      normalizedUrl: 'http://localhost:3000',
      warningMessage: 'insecureDevelopmentUrlWarning',
      originPattern: 'http://localhost:3000/*'
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
      maxNotifications: 100
    });
    expect(manager.settings).toMatchObject({
      checkInterval: 30,
      enableNotifications: true,
      enableSound: false,
      onlyMyProjects: true,
      includeWatchedIssues: false,
      maxNotifications: 100
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

  test('shows validation errors before saving invalid notification settings', async () => {
    elements.checkInterval.value = '0';

    await manager.saveNotificationSettings();

    expect(global.chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(elements.notificationsStatus.className).toBe('status-message error');
    expect(elements.notificationsStatus.textContent).toBe('numberOutOfRange');
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
