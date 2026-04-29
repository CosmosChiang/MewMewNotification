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

  test('falls back to a regular refresh when force refresh fails', async () => {
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
        issueId: 1
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
});
