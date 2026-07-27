const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createInstrumenter } = require('istanbul-lib-instrument');

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
    replaceChildren: jest.fn(),
    setAttribute: jest.fn(),
    focus: jest.fn(),
    classList: { add: jest.fn(), remove: jest.fn(), toggle: jest.fn() },
    ...overrides
  };
}

function createDocument(elements) {
  return {
    documentElement: { lang: 'en' },
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
  const source = createInstrumenter({ compact: false }).instrumentSync(fs.readFileSync(filePath, 'utf8'), filePath);
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
    alert: global.alert,
    __coverage__: global.__coverage__ = global.__coverage__ || {}
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
      clearHistoryBtn: createMockElement()
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
    manager.logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
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

  test('loads notifications, keeps retained items, and triggers rendering', async () => {
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

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'refreshNotifications' },
      expect.any(Function)
    );
    expect(manager.notifications).toEqual([
      expect.objectContaining({ id: 1, read: false }),
      expect.objectContaining({ id: 2, read: true }),
      expect.objectContaining({ id: 3, read: false })
    ]);
    expect(manager.notifications[0].updatedOn).toBeInstanceOf(Date);
    expect(manager.notifications[1].updatedOn).toBeInstanceOf(Date);
    expect(manager.notifications[2].updatedOn).toBeInstanceOf(Date);
    expect(manager.getVisibleNotifications()).toEqual([
      expect.objectContaining({ id: 1, read: false }),
      expect.objectContaining({ id: 3, read: false })
    ]);
    expect(manager.throttledRender).toHaveBeenCalled();
    expect(elements.loadingIndicator.style.display).toBe('flex');
  });

  test('loads retained notifications before revalidation and exposes stale health', async () => {
    manager.renderNotifications = jest.fn();
    global.chrome.runtime.sendMessage.mockResolvedValue({
      notifications: [{ id: 'cached-1', read: false }],
      syncHealth: { lastErrorCode: 'syncFailed', lastSuccessAt: 1 }
    });
    await manager.loadCachedNotifications();
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'getCachedNotifications' }, expect.any(Function)
    );
    expect(manager.notifications).toEqual([expect.objectContaining({ id: 'cached-1' })]);
    expect(manager.renderNotifications).toHaveBeenCalled();
    expect(global.document.getElementById('syncHealthStatus').textContent).toBe('syncStatusStale');
  });

  test('renders 100 variable-height records without virtual scroll handlers', () => {
    const container = createMockElement();
    const appended = [];
    global.document.createDocumentFragment.mockReturnValue({ appendChild: element => appended.push(element) });
    manager.visibleNotifications = Array.from({ length: 100 }, (_, index) => ({ id: `n-${index}` }));
    manager.createNotificationElement = jest.fn(notification => ({ notification }));
    manager.renderAllNotifications(container);
    expect(appended).toHaveLength(100);
    expect(container.addEventListener).not.toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  test('supports Arrow, Home and End navigation for inbox tabs', () => {
    const tabs = ['unread', 'read', 'all'].map(view => createMockElement({ dataset: { view } }));
    global.document.querySelectorAll = jest.fn(() => tabs);
    manager.setInboxView = jest.fn();
    const event = { currentTarget: tabs[0], key: 'End', preventDefault: jest.fn() };
    manager.handleTabKeydown(event);
    expect(tabs[2].focus).toHaveBeenCalled();
    expect(manager.setInboxView).toHaveBeenCalledWith('all');
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

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: 'markAsRead',
        notificationId: 1
      },
      expect.any(Function)
    );
    expect(manager.notifications).toEqual([
      { id: 1, read: true },
      { id: 2, read: false }
    ]);
    expect(manager.getVisibleNotifications()).toEqual([{ id: 2, read: false }]);
    expect(manager.renderNotifications).toHaveBeenCalled();
  });

  test('delegates notification clicks from element and text-node targets', () => {
    manager.notifications = [
      { id: 'issue_10', read: false, url: 'https://redmine.example.com/issues/10' }
    ];
    manager.openNotification = jest.fn();
    manager.markAsRead = jest.fn();
    manager.toggleAdvancedActions = jest.fn();

    const notificationElement = {
      dataset: { notificationId: 'issue_10' }
    };
    const openActionElement = {
      dataset: { action: 'open-notification' },
      closest: jest.fn(selector => (
        selector === '[data-notification-id]' ? notificationElement : undefined
      ))
    };
    const openTarget = {
      closest: jest.fn(selector => (
        selector === '[data-action]' ? openActionElement : undefined
      ))
    };
    const textNodeTarget = {
      parentElement: openTarget
    };
    const openEvent = {
      target: textNodeTarget,
      stopPropagation: jest.fn()
    };

    manager.handleNotificationClick(openEvent);

    expect(openTarget.closest).toHaveBeenCalledWith('[data-action]');
    expect(openActionElement.closest).toHaveBeenCalledWith('[data-notification-id]');
    expect(openEvent.stopPropagation).toHaveBeenCalled();
    expect(manager.openNotification).toHaveBeenCalledWith(manager.notifications[0]);

    const markReadActionElement = {
      dataset: { action: 'mark-read' },
      closest: jest.fn(selector => (
        selector === '[data-notification-id]' ? notificationElement : undefined
      ))
    };
    const markReadTarget = {
      closest: jest.fn(selector => (
        selector === '[data-action]' ? markReadActionElement : undefined
      ))
    };
    const markReadEvent = {
      target: markReadTarget,
      stopPropagation: jest.fn()
    };

    manager.handleNotificationClick(markReadEvent);

    expect(markReadEvent.stopPropagation).toHaveBeenCalled();
    expect(manager.markAsRead).toHaveBeenCalledWith('issue_10');
  });

  test('ignores delegated notification clicks when the target cannot be resolved', () => {
    manager.openNotification = jest.fn();
    manager.markAsRead = jest.fn();
    const event = {
      target: { nodeType: 3 },
      stopPropagation: jest.fn()
    };

    expect(() => manager.handleNotificationClick(event)).not.toThrow();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(manager.openNotification).not.toHaveBeenCalled();
    expect(manager.markAsRead).not.toHaveBeenCalled();
  });

  test('filters retained notifications by inbox view and search query', () => {
    manager.notifications = [
      {
        id: 'issue_10',
        issueId: 10,
        title: '#10: Login bug',
        project: 'Portal',
        assigneeName: 'Alice',
        read: false,
        updatedOn: new Date('2026-04-29T08:00:00.000Z')
      },
      {
        id: 'issue_11',
        issueId: 11,
        title: '#11: Billing export',
        project: 'Finance',
        assigneeName: 'Bob',
        read: true,
        updatedOn: new Date('2026-04-28T08:00:00.000Z')
      }
    ];

    expect(manager.getVisibleNotifications()).toEqual([
      expect.objectContaining({ id: 'issue_10' })
    ]);

    manager.activeInboxView = 'read';
    expect(manager.getVisibleNotifications()).toEqual([
      expect.objectContaining({ id: 'issue_11' })
    ]);

    manager.activeInboxView = 'all';
    manager.searchQuery = 'finance';
    expect(manager.getVisibleNotifications()).toEqual([
      expect.objectContaining({ id: 'issue_11' })
    ]);

    manager.searchQuery = '10';
    expect(manager.getVisibleNotifications()).toEqual([
      expect.objectContaining({ id: 'issue_10' })
    ]);
  });

  test('uses view-specific empty state messages', () => {
    manager.searchQuery = 'missing';
    expect(manager.getEmptyStateMessage()).toBe('noMatchingNotifications');

    manager.searchQuery = '';
    manager.activeInboxView = 'read';
    expect(manager.getEmptyStateMessage()).toBe('noReadNotifications');

    manager.activeInboxView = 'all';
    expect(manager.getEmptyStateMessage()).toBe('noNotificationHistory');

    manager.activeInboxView = 'unread';
    expect(manager.getEmptyStateMessage()).toBe('noNotifications');
  });

  test('renders change digest rows for notification updates', () => {
    const appendedRows = [];
    const container = createMockElement({
      appendChild: jest.fn(row => appendedRows.push(row))
    });
    const createdElements = [];
    global.document.createElement.mockImplementation(() => {
      const element = createMockElement({
        appendChild: jest.fn(child => {
          element.children.push(child);
        }),
        children: []
      });
      createdElements.push(element);
      return element;
    });

    manager.translate = jest.fn((key, substitutions = []) => (
      substitutions.length > 0 ? `${substitutions[0]} -> ${substitutions[1]}` : key
    ));

    manager.renderChangeSummary({
      changeSummary: [
        { field: 'status', from: 'New', to: 'In Progress' }
      ]
    }, container);

    expect(appendedRows).toHaveLength(1);
    expect(appendedRows[0].className).toBe('change-summary-row');
    expect(createdElements.some(element => element.textContent === 'changeField_status')).toBe(true);
    expect(createdElements.some(element => element.textContent === 'New -> In Progress')).toBe(true);
  });

  test('renders a bundled updates summary before field-level changes', () => {
    const appendedRows = [];
    const container = createMockElement({
      appendChild: jest.fn(row => appendedRows.push(row))
    });
    global.document.createElement.mockImplementation(() => createMockElement());
    manager.translate = jest.fn((key, substitutions = []) => (
      key === 'bundledUpdatesCount' ? `${substitutions[0]} updates bundled` : key
    ));

    manager.renderChangeSummary({
      bundleCount: 3,
      isUpdated: true,
      changeSummary: [
        { field: 'priority', from: 'Normal', to: 'High' }
      ]
    }, container);

    expect(appendedRows).toHaveLength(2);
    expect(appendedRows[0].className).toBe('change-summary-row generic bundled');
    expect(appendedRows[0].textContent).toBe('3 updates bundled');
    expect(appendedRows[1].className).toBe('change-summary-row');
  });

  test('preserves cached state without starting a second refresh when force refresh fails', async () => {
    manager.loadNotifications = jest.fn();
    global.chrome.runtime.sendMessage.mockResolvedValue({
      success: false,
      notifications: []
    });

    await manager.refreshNotifications();

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: 'forceRefreshNotifications'
      },
      expect.any(Function)
    );
    expect(manager.loadNotifications).not.toHaveBeenCalled();
    expect(elements.refreshBtn.disabled).toBe(false);
  });

  test('does not open tabs for unsafe notification URLs', async () => {
    await manager.openNotification({
      url: 'javascript:alert(1)'
    });

    expect(global.chrome.tabs.create).not.toHaveBeenCalled();
    expect(manager.logger.error).toHaveBeenCalledWith('popup_unsafe_url_blocked', {
      errorCode: 'unsafeUrl'
    });
  });

  test('loads issue action context when expanding advanced actions', async () => {
    manager.renderNotifications = jest.fn();
    manager.notifications = [
      { id: 'issue_1', issueId: 1, read: false }
    ];
    global.chrome.runtime.sendMessage.mockResolvedValue({
      success: true,
      context: {
        permissions: {
          canReply: true,
          canChangeStatus: true,
          canChangeAssignee: false
        },
        current: {
          statusId: 2,
          assigneeId: 5
        },
        statusOptions: [
          { id: 2, name: 'In Progress' }
        ],
        assigneeOptions: []
      }
    });

    await manager.toggleAdvancedActions('issue_1');

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: 'getIssueActionContext',
        issueId: 1,
        notificationId: 'issue_1',
        profileId: undefined
      },
      expect.any(Function)
    );
    expect(manager.expandedNotificationId).toBe('issue_1');
    expect(manager.getIssueActionState('issue_1')).toEqual(expect.objectContaining({
      context: expect.objectContaining({
        current: expect.objectContaining({ statusId: 2 })
      }),
      statusId: '2',
      assigneeId: '5'
    }));
  });

  test('associates advanced action labels with their controls', () => {
    const notification = { id: 'issue_11' };
    const state = {
      isSubmitting: false,
      replyText: 'Draft',
      statusId: '2',
      assigneeId: '9',
      context: {
        permissions: {
          canReply: true,
          canChangeStatus: true,
          canChangeAssignee: true
        },
        current: {
          statusId: 2,
          assigneeId: 9
        },
        statusOptions: [
          { id: 2, name: 'In Progress' }
        ],
        assigneeOptions: [
          { id: 9, name: 'Alice' }
        ]
      }
    };

    const replySection = manager.createReplySection(notification, state);
    const replyChildren = replySection.appendChild.mock.calls.map(([child]) => child);
    expect(replyChildren[1].htmlFor).toBe('advanced-actions-issue_11-reply');
    expect(replyChildren[2].id).toBe('advanced-actions-issue_11-reply');

    const statusSection = manager.createStatusSection(notification, state);
    const statusChildren = statusSection.appendChild.mock.calls.map(([child]) => child);
    expect(statusChildren[1].htmlFor).toBe('advanced-actions-issue_11-status');
    expect(statusChildren[2].id).toBe('advanced-actions-issue_11-status');

    const assigneeSection = manager.createAssigneeSection(notification, state);
    const assigneeChildren = assigneeSection.appendChild.mock.calls.map(([child]) => child);
    expect(assigneeChildren[1].htmlFor).toBe('advanced-actions-issue_11-assignee');
    expect(assigneeChildren[2].id).toBe('advanced-actions-issue_11-assignee');
  });

  test('submits only changed fields with the combined submit action', async () => {
    manager.renderNotifications = jest.fn();
    manager.notifications = [
      {
        id: 'issue_7',
        issueId: 7,
        read: false,
        status: 'Open',
        updatedOn: new Date('2026-04-27T10:00:00.000Z')
      }
    ];
    const actionState = manager.getIssueActionState('issue_7');
    actionState.replyText = 'Need **review**';
    actionState.context = {
      permissions: {
        canReply: true,
        canChangeStatus: true,
        canChangeAssignee: true
      },
      current: {
        statusId: 2,
        assigneeId: 9
      },
      statusOptions: [
        { id: 2, name: 'Open' },
        { id: 3, name: 'Resolved' }
      ],
      assigneeOptions: [
        { id: 9, name: 'Alice' }
      ]
    };
    actionState.statusId = '3';
    actionState.assigneeId = '9';
    global.chrome.runtime.sendMessage.mockResolvedValue({
      success: true,
      notification: {
        id: 'issue_7',
        issueId: 7,
        read: false,
        status: 'Resolved',
        updatedOn: '2026-04-28T08:00:00.000Z'
      },
      context: {
        permissions: {
          canReply: true,
          canChangeStatus: true,
          canChangeAssignee: true
        },
        current: {
          statusId: 3,
          assigneeId: 9
        },
        statusOptions: [
          { id: 3, name: 'Resolved' }
        ],
        assigneeOptions: [
          { id: 9, name: 'Alice' }
        ]
      }
    });

    await manager.submitIssueChanges('issue_7');

    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: 'applyIssueChanges',
        issueId: 7,
        notificationId: 'issue_7',
        profileId: undefined,
        changes: {
          reply: 'Need **review**',
          statusId: 3
        }
      },
      expect.any(Function)
    );
    expect(manager.notifications[0]).toEqual(expect.objectContaining({
      id: 'issue_7',
      status: 'Resolved'
    }));
    expect(manager.notifications[0].updatedOn).toBeInstanceOf(Date);
    expect(actionState.replyText).toBe('');
    expect(actionState.success).toBe('issueChangesSuccess');
    expect(actionState.statusId).toBe('3');
  });

  test('builds pending changes from only filled or modified fields', () => {
    const state = manager.getIssueActionState('issue_3');
    state.replyText = '  ';
    state.statusId = '2';
    state.assigneeId = '12';
    state.context = {
      permissions: {
        canReply: true,
        canChangeStatus: true,
        canChangeAssignee: true
      },
      current: {
        statusId: 2,
        assigneeId: 9
      }
    };

    expect(manager.getPendingIssueChanges(state)).toEqual({
      assigneeId: 12
    });
  });

  test('shows a validation message when no combined changes are pending', async () => {
    manager.renderNotifications = jest.fn();
    manager.notifications = [
      { id: 'issue_5', issueId: 5, read: false }
    ];
    const state = manager.getIssueActionState('issue_5');
    state.context = {
      permissions: {
        canReply: true,
        canChangeStatus: true,
        canChangeAssignee: true
      },
      current: {
        statusId: 2,
        assigneeId: 9
      }
    };
    state.statusId = '2';
    state.assigneeId = '9';

    await manager.submitIssueChanges('issue_5');

    expect(state.error).toBe('noChangesToSubmit');
  });

  test('renders lightweight Markdown preview content', () => {
    manager.escapeHtml = jest.fn((value) => value);

    const rendered = manager.renderMarkdown('**Bold**\n- Item');

    expect(rendered).toContain('<strong>Bold</strong>');
    expect(rendered).toContain('<ul>');
    expect(rendered).toContain('<li>Item</li>');
  });

  test('surfaces a background no-response error for advanced actions', async () => {
    manager.renderNotifications = jest.fn();
    manager.notifications = [
      { id: 'issue_9', issueId: 9, read: false }
    ];
    global.chrome.runtime.sendMessage.mockImplementation((_message, callback) => {
      callback(undefined);
      return undefined;
    });

    await manager.toggleAdvancedActions('issue_9');

    expect(manager.getIssueActionState('issue_9').error).toBe('backgroundNoResponse');
  });

  test('updates the complete popup presentation and supports the no-i18n fallback', async () => {
    manager.updateUI();

    expect(elements.markAllReadBtn.title).toBe('markAllRead');
    expect(elements.settingsBtn.title).toBe('settings');
    expect(elements.refreshBtn.title).toBe('refreshNotifications');
    expect(elements.clearHistoryBtn.textContent).toBe('clearNotificationHistory');
    expect(elements.notificationSearch.placeholder).toBe('searchNotifications');

    manager.i18n = null;
    manager.updateUI = jest.fn();
    await expect(manager.loadLanguage('ja')).resolves.toEqual({});
    expect(manager.translate('plainKey')).toBe('plainKey');
    expect(manager.updateUI).toHaveBeenCalled();

    const defaultLoggerManager = new PopupManager();
    defaultLoggerManager.logger.debug();
    defaultLoggerManager.logger.info();
    defaultLoggerManager.logger.warn();
    defaultLoggerManager.logger.error();
  });

  test('maps every sync result to a safe health status', () => {
    elements.syncHealthStatus = createMockElement();
    manager.currentLanguage = 'en';

    manager.applySyncResult({ status: 'success', lastSuccessAt: '2026-07-17T00:00:00.000Z' });
    expect(elements.syncHealthStatus.textContent).toContain('syncStatusLastSuccess');

    manager.applySyncResult({ status: 'retryScheduled' });
    expect(elements.syncHealthStatus.textContent).toBe('syncStatusRetry');

    manager.applySyncResult({ status: 'stale', errorCode: 'timeout_1' });
    expect(elements.syncHealthStatus.textContent).toBe('syncStatusStale (timeout_1)');
    expect(elements.syncHealthStatus.setAttribute).toHaveBeenLastCalledWith('aria-live', 'assertive');

    manager.applySyncResult({ status: 'failure', stale: true });
    expect(elements.syncHealthStatus.textContent).toBe('syncStatusStale');

    manager.applySyncResult({ status: 'failure', errorCode: 'unsafe error body' });
    expect(elements.syncHealthStatus.textContent).toBe('syncStatusError');

    global.document.getElementById.mockReturnValueOnce(null);
    expect(() => manager.setHealthStatus('ignored')).not.toThrow();
  });

  test('handles runtime callback, promise, last-error and thrown transports', async () => {
    global.chrome.runtime.sendMessage.mockImplementation((_message, callback) => {
      callback({ success: true });
      return Promise.resolve({ success: false });
    });
    await expect(manager.sendRuntimeMessage({ action: 'callback' })).resolves.toEqual({ success: true });

    global.chrome.runtime.sendMessage.mockReturnValue(Promise.resolve({ success: true }));
    await expect(manager.sendRuntimeMessage({ action: 'promise' })).resolves.toEqual({ success: true });

    global.chrome.runtime.lastError = { message: 'worker unavailable' };
    global.chrome.runtime.sendMessage.mockImplementation((_message, callback) => {
      callback({ success: true });
    });
    await expect(manager.sendRuntimeMessage({ action: 'last-error' })).rejects.toThrow('worker unavailable');
    delete global.chrome.runtime.lastError;

    global.chrome.runtime.sendMessage.mockImplementation(() => {
      throw new Error('transport failed');
    });
    await expect(manager.sendRuntimeMessage({ action: 'throw' })).rejects.toThrow('transport failed');

    expect(manager.resolveRuntimeError(new Error('backgroundNoResponse'))).toBe('backgroundNoResponse');
    expect(manager.resolveRuntimeError('plain failure')).toBe('plain failure');
    expect(manager.resolveRuntimeError('')).toBe('actionsUnavailable');
  });

  test('normalizes inbox state, prunes orphan actions and formats every age band', () => {
    manager.renderNotifications = jest.fn();
    manager.updateInboxControls = jest.fn();
    manager.expandedNotificationId = 'orphan';
    manager.issueActionStates.set('orphan', {});
    manager.issueActionStates.set('kept', {});
    manager.notifications = [
      manager.normalizeNotification({ id: 'kept', read: false, bundleCount: 0 }),
      manager.normalizeNotification({ id: 'read', read: true, bundleCount: 3, updatedOn: '2026-07-17T00:00:00Z' })
    ];

    manager.setInboxView('invalid');
    expect(manager.activeInboxView).toBe('unread');
    manager.setInboxView('all');
    expect(manager.activeInboxView).toBe('all');
    manager.pruneIssueActionState();
    expect(manager.issueActionStates.has('orphan')).toBe(false);
    expect(manager.expandedNotificationId).toBeUndefined();

    expect(manager.notificationMatchesInboxView(manager.notifications[0])).toBe(true);
    manager.activeInboxView = 'read';
    expect(manager.notificationMatchesInboxView(manager.notifications[1])).toBe(true);
    manager.activeInboxView = 'unread';
    expect(manager.notificationMatchesInboxView(manager.notifications[1])).toBe(false);

    expect(manager.formatDate(new Date())).toBe('justNow');
    expect(manager.formatDate(new Date(Date.now() - 5 * 60 * 1000))).toBe('minutesAgo');
    expect(manager.formatDate(new Date(Date.now() - 2 * 60 * 60 * 1000))).toBe('hoursAgo');
    expect(manager.formatDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000))).toBe('daysAgo');
    expect(manager.escapeHtml(null)).toBe('');
    expect(manager.sanitizeAttribute(0)).toBe('');
    expect(manager.sanitizeUrl(null)).toBe('#');
  });

  test('covers bulk read, refresh and history success and failure outcomes', async () => {
    manager.renderNotifications = jest.fn();
    manager.applySyncResult = jest.fn();
    manager.announceActionFailure = jest.fn();
    manager.notifications = [{ id: 'one', read: false }];
    manager.issueActionStates.set('one', {});
    manager.expandedNotificationId = 'one';

    manager.sendRuntimeMessage = jest.fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })
      .mockRejectedValueOnce(new Error('read failed'));
    await manager.markAllAsRead();
    expect(manager.notifications[0].read).toBe(true);
    await manager.markAllAsRead();
    await manager.markAllAsRead();
    expect(manager.announceActionFailure).toHaveBeenCalledTimes(2);

    manager.sendRuntimeMessage = jest.fn()
      .mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({
        status: 'success',
        notifications: [{ id: 'two', bundleCount: 1 }]
      })
      .mockRejectedValueOnce(new Error('refresh failed'));
    await manager.refreshNotifications();
    await manager.refreshNotifications();
    await manager.refreshNotifications();
    expect(elements.refreshBtn.disabled).toBe(false);
    expect(elements.refreshBtn.classList.remove).toHaveBeenCalledWith('syncing');

    global.confirm.mockReturnValueOnce(false);
    await manager.clearNotificationHistory();

    global.confirm.mockReturnValue(true);
    manager.sendRuntimeMessage = jest.fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false })
      .mockRejectedValueOnce(new Error('clear failed'));
    await manager.clearNotificationHistory();
    await manager.clearNotificationHistory();
    await manager.clearNotificationHistory();
    expect(global.alert).toHaveBeenCalledTimes(2);
  });

  test('renders updated, watched, expanded, read and unread notification variants', () => {
    const makeClone = () => {
      const parts = {
        '.notification-content': createMockElement(),
        '.notification-title': createMockElement(),
        '.notification-meta': createMockElement(),
        '.change-summary': createMockElement(),
        '.notification-actions': createMockElement(),
        '.advanced-actions-panel': createMockElement()
      };
      return createMockElement({
        querySelector: jest.fn(selector => parts[selector]),
        parts
      });
    };
    const clones = [];
    manager._notificationTemplate = {
      cloneNode: jest.fn(() => {
        const clone = makeClone();
        clones.push(clone);
        return clone;
      })
    };
    manager.renderChangeSummary = jest.fn();
    manager.renderAdvancedActionsPanel = jest.fn();
    manager.openNotification = jest.fn();
    manager.expandedNotificationId = 'updated';

    const updatedElement = manager.createNotificationElement({
      id: 'updated',
      title: 'Updated issue',
      read: false,
      isUpdated: true,
      sourceType: 'assigned',
      project: 'Project',
      status: 'Open',
      assigneeName: 'Mew',
      updatedOn: new Date()
    });
    expect(updatedElement.classList.add).toHaveBeenCalledWith('expanded');
    expect(manager.renderAdvancedActionsPanel).toHaveBeenCalled();

    const keyHandler = clones[0].parts['.notification-content'].addEventListener.mock.calls[0][1];
    const enterEvent = { key: 'Enter', preventDefault: jest.fn() };
    keyHandler(enterEvent);
    keyHandler({ key: 'Escape', preventDefault: jest.fn() });
    expect(enterEvent.preventDefault).toHaveBeenCalled();
    expect(manager.openNotification).toHaveBeenCalled();

    manager.expandedNotificationId = undefined;
    const watchedElement = manager.createNotificationElement({
      id: 'watched',
      title: '',
      read: true,
      isUpdated: false,
      sourceType: 'watched',
      updatedOn: new Date()
    });
    expect(watchedElement.className).toContain('read');
    expect(manager.renderAdvancedActionsPanel).toHaveBeenCalledTimes(1);
  });

  test('renders both empty and populated inbox states and coalesces rendering', () => {
    global.document.querySelectorAll = jest.fn(() => []);
    elements.emptyText = createMockElement();
    manager.notifications = [];
    manager.renderNotifications();
    expect(elements.emptyState.style.display).toBe('block');

    manager.notifications = [{ id: 'one', read: false, updatedOn: new Date() }];
    manager.renderAllNotifications = jest.fn();
    manager.renderNotifications();
    expect(elements.notificationsList.style.display).toBe('block');
    expect(elements.markAllReadBtn.style.display).toBe('flex');

    manager.notifications = [{ id: 'two', read: true, updatedOn: new Date() }];
    manager.activeInboxView = 'all';
    manager.renderNotifications();
    expect(elements.markAllReadBtn.style.display).toBe('none');

    manager.renderNotifications = jest.fn();
    manager.throttledRender();
    manager.throttledRender();
    jest.advanceTimersByTime(16);
    expect(manager.renderNotifications).toHaveBeenCalledTimes(1);
  });
});
