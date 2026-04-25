const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
    alert: global.alert
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
    global.confirm = jest.fn(() => true);
    global.alert = jest.fn();
    global.fetch = jest.fn();
    global.chrome = {
      storage: {
        sync: {
          get: jest.fn(),
          set: jest.fn()
        },
        onChanged: {
          addListener: jest.fn()
        }
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
    expect(manager.validateUrl('https://redmine.example.com')).toEqual({ valid: true });
    expect(manager.validateUrl('')).toEqual({
      valid: false,
      message: 'urlRequired'
    });
    expect(manager.validateUrl('ftp://redmine.example.com')).toEqual({
      valid: false,
      message: 'urlMustBeHttpOrHttps'
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
