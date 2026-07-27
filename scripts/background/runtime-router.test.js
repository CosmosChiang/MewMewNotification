const { RUNTIME_ACTIONS, RuntimeRouter, safeErrorCode } = require('./runtime-router.js');

function createService() {
  return {
    settings: { redmineUrl: 'https://example.test', apiKey: 'key' },
    translate: jest.fn(key => key),
    getNotifications: jest.fn().mockResolvedValue([{ id: 'n' }]),
    getCachedNotifications: jest.fn().mockResolvedValue({ notifications: [] }),
    markAsRead: jest.fn().mockResolvedValue(undefined),
    markAllAsRead: jest.fn().mockResolvedValue(undefined),
    requestSync: jest.fn().mockResolvedValue({ success: true, status: 'success' }),
    forceRefreshNotifications: jest.fn().mockResolvedValue({ success: true, status: 'success' }),
    clearNotificationHistory: jest.fn().mockResolvedValue(undefined),
    getIssueActionContext: jest.fn().mockResolvedValue({ success: true }),
    applyIssueChanges: jest.fn().mockResolvedValue({ success: true }),
    loadSettings: jest.fn().mockResolvedValue(undefined),
    getNotificationProjects: jest.fn().mockResolvedValue({ cached: false, projects: [] }),
    resolveIssueActionError: jest.fn(() => 'permissionDenied')
  };
}

describe('RuntimeRouter', () => {
  let service;
  let logger;
  let chrome;
  let Api;
  let router;

  beforeEach(() => {
    service = createService();
    logger = { error: jest.fn() };
    chrome = {
      runtime: {
        id: 'extension-id'
      },
      alarms: {
        get: jest.fn((_name, callback) => callback({ periodInMinutes: 15 }))
      }
    };
    Api = jest.fn().mockImplementation(() => ({
      testConnection: jest.fn().mockResolvedValue({ success: true })
    }));
    router = new RuntimeRouter({
      notificationService: service,
      RedmineAPIClass: Api,
      chrome,
      alarmName: 'check',
      logger,
      diagnosticSnapshotBuilder: {
        build: jest.fn().mockResolvedValue({ schemaVersion: 1 })
      },
      apiDependencies: { fetch: jest.fn() }
    });
  });

  test('rejects malformed and unknown actions synchronously', () => {
    expect(router.validateRequest(null)).toEqual({ valid: false, error: 'invalidRequest' });
    expect(router.validateRequest({ action: 42 })).toEqual({ valid: false, error: 'invalidRequest' });
    const sendResponse = jest.fn();
    expect(router.handleMessage({ action: 'unknown' }, {}, sendResponse)).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Unknown action: unknown'
    });
  });

  test.each([
    [RUNTIME_ACTIONS.GET_NOTIFICATIONS, {}, 'getNotifications'],
    [RUNTIME_ACTIONS.GET_CACHED_NOTIFICATIONS, {}, 'getCachedNotifications'],
    [RUNTIME_ACTIONS.MARK_AS_READ, { notificationId: 'n', profileId: 'p' }, 'markAsRead'],
    [RUNTIME_ACTIONS.MARK_ALL_AS_READ, {}, 'markAllAsRead'],
    [RUNTIME_ACTIONS.REFRESH_NOTIFICATIONS, {}, 'requestSync'],
    [RUNTIME_ACTIONS.FORCE_REFRESH_NOTIFICATIONS, {}, 'forceRefreshNotifications'],
    [RUNTIME_ACTIONS.CLEAR_NOTIFICATION_HISTORY, {}, 'clearNotificationHistory'],
    [RUNTIME_ACTIONS.GET_ISSUE_ACTION_CONTEXT, { issueId: 1 }, 'getIssueActionContext'],
    [RUNTIME_ACTIONS.APPLY_ISSUE_CHANGES, { issueId: 1, changes: {} }, 'applyIssueChanges'],
    [RUNTIME_ACTIONS.GET_NOTIFICATION_PROJECTS, { forceRefresh: true }, 'getNotificationProjects']
  ])('dispatches %s to the compatible service method', async (action, payload, method) => {
    const response = await router.dispatch({ action, ...payload });
    expect(service[method]).toHaveBeenCalled();
    expect(response).toEqual(expect.any(Object));
  });

  test('constructs transport for connection tests and validates required fields', async () => {
    await expect(router.dispatch({ action: RUNTIME_ACTIONS.TEST_CONNECTION })).resolves.toEqual({
      success: false,
      error: 'missingRequiredSettings'
    });
    await expect(router.dispatch({
      action: RUNTIME_ACTIONS.TEST_CONNECTION,
      redmineUrl: 'https://example.test',
      apiKey: 'key'
    })).resolves.toEqual({ success: true });
    expect(Api).toHaveBeenCalledWith(
      'https://example.test',
      'key',
      expect.objectContaining({ fetch: expect.any(Function) })
    );
  });

  test('returns safe settings and alarm state', async () => {
    await expect(router.dispatch({ action: RUNTIME_ACTIONS.GET_SETTINGS })).resolves.toEqual({
      success: true,
      settings: {
        redmineUrl: 'https://example.test',
        apiKey: '[CONFIGURED]'
      },
      alarmActive: true,
      alarmInfo: { periodInMinutes: 15 }
    });
  });

  test('returns an empty alarm state and unconfigured credential marker', async () => {
    service.settings.apiKey = '';
    chrome.alarms.get.mockImplementationOnce((_name, callback) => callback(undefined));
    await expect(router.dispatch({ action: RUNTIME_ACTIONS.GET_SETTINGS })).resolves.toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({ apiKey: '[NOT_CONFIGURED]' }),
        alarmActive: false,
        alarmInfo: null
      })
    );
    await router.dispatch({ action: RUNTIME_ACTIONS.GET_NOTIFICATION_PROJECTS });
    expect(service.getNotificationProjects).toHaveBeenCalledWith({ forceRefresh: false });
  });

  test('maps rejected actions to safe response envelopes', async () => {
    service.getNotifications.mockRejectedValue('raw private failure');
    const sendResponse = jest.fn();
    expect(router.handleMessage({
      action: RUNTIME_ACTIONS.GET_NOTIFICATIONS
    }, {}, sendResponse)).toBe(true);
    await new Promise(resolve => setImmediate(resolve));
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'runtimeActionFailed'
    });
    expect(logger.error).toHaveBeenCalledWith('runtime_action_failed', {
      action: RUNTIME_ACTIONS.GET_NOTIFICATIONS,
      errorCode: 'runtimeActionFailed'
    });
    expect(safeErrorCode({ code: 'knownCode' })).toBe('knownCode');
    expect(safeErrorCode(new Error('unsafe message with spaces'))).toBe('runtimeActionFailed');
  });

  test('uses issue-action error mapping for rejected issue requests', async () => {
    service.applyIssueChanges.mockRejectedValue(Object.assign(new Error('forbidden'), {
      code: 'permissionDenied'
    }));
    const sendResponse = jest.fn();
    router.handleMessage({
      action: RUNTIME_ACTIONS.APPLY_ISSUE_CHANGES,
      issueId: 1,
      changes: {}
    }, {}, sendResponse);
    await new Promise(resolve => setImmediate(resolve));
    expect(service.resolveIssueActionError).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'permissionDenied'
    });
  });

  test('restricts diagnostics to fixed same-extension requests', async () => {
    const request = { action: RUNTIME_ACTIONS.GET_DIAGNOSTICS };

    await expect(router.dispatch(request, { id: 'other-extension' })).resolves.toEqual({
      success: false,
      error: 'unauthorizedDiagnostics'
    });
    expect(router.diagnosticSnapshotBuilder.build).not.toHaveBeenCalled();

    await expect(router.dispatch({
      ...request,
      storageKey: 'apiKey'
    }, { id: 'extension-id' })).resolves.toEqual({
      success: false,
      error: 'diagnosticsUnsafe'
    });
    expect(router.diagnosticSnapshotBuilder.build).not.toHaveBeenCalled();

    await expect(router.dispatch(request, { id: 'extension-id' })).resolves.toEqual({
      success: true,
      diagnostics: { schemaVersion: 1 }
    });
  });

  test('maps unsafe diagnostic construction without logging rejected values', async () => {
    router.diagnosticSnapshotBuilder.build.mockRejectedValue(new Error(
      'https://private.example response body api-key-secret'
    ));

    await expect(router.dispatch({
      action: RUNTIME_ACTIONS.GET_DIAGNOSTICS
    }, { id: 'extension-id' })).resolves.toEqual({
      success: false,
      error: 'diagnosticsUnsafe'
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
