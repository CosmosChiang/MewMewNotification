const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createMockElement(overrides = {}) {
  return {
    textContent: '',
    innerHTML: '',
    className: '',
    disabled: false,
    title: '',
    style: { display: 'none', transform: '', transition: '' },
    dataset: {},
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    appendChild: jest.fn(),
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
    addEventListener: jest.fn(),
    createElement: jest.fn(() => createMockElement()),
    createTextNode: jest.fn((value) => ({ textContent: value })),
    createDocumentFragment: jest.fn(() => ({ appendChild: jest.fn() }))
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
    Date,
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

describe('PopupManager', () => {
  let PopupManager;
  let elements;
  let manager;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.resetModules();

    elements = {
      loadingIndicator: createMockElement(),
      notificationsList: createMockElement(),
      emptyState: createMockElement(),
      errorState: createMockElement(),
      errorText: createMockElement(),
      refreshBtn: createMockElement(),
      markAllReadBtn: createMockElement(),
      settingsBtn: createMockElement(),
      retryBtn: createMockElement(),
      clearAllBtn: createMockElement()
    };

    global.window = { close: jest.fn() };
    global.confirm = jest.fn(() => true);
    global.alert = jest.fn();
    global.fetch = jest.fn();
    global.chrome = {
      storage: {
        sync: {
          get: jest.fn()
        },
        onChanged: {
          addListener: jest.fn()
        }
      },
      runtime: {
        sendMessage: jest.fn()
      },
      tabs: {
        create: jest.fn()
      }
    };
    global.document = createDocument(elements);

    PopupManager = loadBrowserClass('popup.js', 'PopupManager');
    PopupManager.prototype.init = jest.fn();

    manager = new PopupManager();
    manager.translate = jest.fn((key) => key);
    manager.notifications = [];
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('sanitizes URLs and attributes before using them', () => {
    expect(manager.sanitizeUrl('https://redmine.example.com/issues/1')).toBe(
      'https://redmine.example.com/issues/1'
    );
    expect(manager.sanitizeUrl('javascript:alert(1)')).toBe('#');
    expect(manager.sanitizeAttribute('issue-1"><script>')).toBe('issue-1script');
    expect(manager.sanitizeAttribute(15)).toBe('15');
  });

  test('loads notifications, keeps unread items, and triggers rendering', async () => {
    manager.throttledRender = jest.fn();
    global.chrome.runtime.sendMessage.mockResolvedValue({
      success: true,
      notifications: [
        { id: 1, read: false },
        { id: 2, read: true },
        { id: 3, read: false }
      ]
    });

    await manager.loadNotifications();

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'refreshNotifications'
    });
    expect(manager.notifications).toEqual([
      { id: 1, read: false },
      { id: 3, read: false }
    ]);
    expect(manager.throttledRender).toHaveBeenCalled();
    expect(elements.loadingIndicator.style.display).toBe('flex');
  });

  test('updates the error state when notification loading fails', () => {
    manager.showError('load failed');

    expect(elements.loadingIndicator.style.display).toBe('none');
    expect(elements.notificationsList.style.display).toBe('none');
    expect(elements.errorState.style.display).toBe('block');
    expect(elements.errorText.textContent).toBe('load failed');
  });

  test('marks a notification as read and re-renders the list', async () => {
    manager.notifications = [
      { id: 1, read: false },
      { id: 2, read: false }
    ];
    manager.renderNotifications = jest.fn();
    global.chrome.runtime.sendMessage.mockResolvedValue({ success: true });

    await manager.markAsRead(1);

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'markAsRead',
      notificationId: 1
    });
    expect(manager.notifications).toEqual([{ id: 2, read: false }]);
    expect(manager.renderNotifications).toHaveBeenCalled();
  });

  test('falls back to a regular refresh when force refresh fails', async () => {
    manager.loadNotifications = jest.fn();
    global.chrome.runtime.sendMessage.mockResolvedValue({
      success: false,
      notifications: []
    });

    await manager.refreshNotifications();

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'forceRefreshNotifications'
    });
    expect(manager.loadNotifications).toHaveBeenCalled();
    expect(elements.refreshBtn.disabled).toBe(true);
  });

  test('does not open tabs for unsafe notification URLs', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await manager.openNotification({
      url: 'javascript:alert(1)'
    });

    expect(global.chrome.tabs.create).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
