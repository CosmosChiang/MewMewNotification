(function initializeRuntimeRouter(root, factory) {
  const exports = factory();

  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    Object.assign(root, exports);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntimeRouterExports() {
  const RUNTIME_ACTIONS = Object.freeze({
    GET_NOTIFICATIONS: 'getNotifications',
    GET_CACHED_NOTIFICATIONS: 'getCachedNotifications',
    MARK_AS_READ: 'markAsRead',
    MARK_ALL_AS_READ: 'markAllAsRead',
    TEST_CONNECTION: 'testConnection',
    REFRESH_NOTIFICATIONS: 'refreshNotifications',
    FORCE_REFRESH_NOTIFICATIONS: 'forceRefreshNotifications',
    CLEAR_NOTIFICATION_HISTORY: 'clearNotificationHistory',
    GET_ISSUE_ACTION_CONTEXT: 'getIssueActionContext',
    APPLY_ISSUE_CHANGES: 'applyIssueChanges',
    GET_SETTINGS: 'getSettings',
    GET_NOTIFICATION_PROJECTS: 'getNotificationProjects',
    GET_DIAGNOSTICS: 'getDiagnostics'
  });

  function safeErrorCode(error, fallback = 'runtimeActionFailed') {
    const candidate = error?.code || error?.message;
    return typeof candidate === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(candidate)
      ? candidate
      : fallback;
  }

  class RuntimeRouter {
    constructor({
      notificationService,
      RedmineAPIClass,
      chrome,
      alarmName,
      logger,
      diagnosticSnapshotBuilder,
      apiDependencies = {}
    }) {
      this.notificationService = notificationService;
      this.RedmineAPIClass = RedmineAPIClass;
      this.chrome = chrome;
      this.alarmName = alarmName;
      this.logger = logger;
      this.diagnosticSnapshotBuilder = diagnosticSnapshotBuilder;
      this.apiDependencies = apiDependencies;
    }

    validateRequest(request) {
      if (!request || typeof request !== 'object' || typeof request.action !== 'string') {
        return { valid: false, error: 'invalidRequest' };
      }
      if (!Object.values(RUNTIME_ACTIONS).includes(request.action)) {
        return { valid: false, error: `Unknown action: ${request.action}` };
      }
      return { valid: true };
    }

    async dispatch(request, sender) {
      const validation = this.validateRequest(request);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const manager = this.notificationService;
      switch (request.action) {
        case RUNTIME_ACTIONS.GET_NOTIFICATIONS:
          return { notifications: await manager.getNotifications() };
        case RUNTIME_ACTIONS.GET_CACHED_NOTIFICATIONS:
          return manager.getCachedNotifications();
        case RUNTIME_ACTIONS.MARK_AS_READ:
          await manager.markAsRead(request.notificationId, request.profileId);
          return { success: true };
        case RUNTIME_ACTIONS.MARK_ALL_AS_READ:
          await manager.markAllAsRead();
          return { success: true };
        case RUNTIME_ACTIONS.TEST_CONNECTION: {
          if (!request.redmineUrl || !request.apiKey) {
            return { success: false, error: manager.translate('missingRequiredSettings') };
          }
          const api = new this.RedmineAPIClass(
            request.redmineUrl,
            request.apiKey,
            this.apiDependencies
          );
          return api.testConnection();
        }
        case RUNTIME_ACTIONS.REFRESH_NOTIFICATIONS: {
          const syncResult = await manager.requestSync('popup');
          return { ...syncResult, notifications: await manager.getNotifications() };
        }
        case RUNTIME_ACTIONS.FORCE_REFRESH_NOTIFICATIONS: {
          const syncResult = await manager.forceRefreshNotifications();
          return { ...syncResult, notifications: await manager.getNotifications() };
        }
        case RUNTIME_ACTIONS.CLEAR_NOTIFICATION_HISTORY:
          await manager.clearNotificationHistory();
          return { success: true };
        case RUNTIME_ACTIONS.GET_ISSUE_ACTION_CONTEXT:
          return manager.getIssueActionContext(
            request.issueId,
            request.profileId,
            request.notificationId
          );
        case RUNTIME_ACTIONS.APPLY_ISSUE_CHANGES:
          return manager.applyIssueChanges(
            request.issueId,
            request.changes,
            request.profileId,
            request.notificationId
          );
        case RUNTIME_ACTIONS.GET_SETTINGS: {
          await manager.loadSettings();
          const alarm = await new Promise(resolve => {
            this.chrome.alarms.get(this.alarmName, resolve);
          });
          return {
            success: true,
            settings: {
              ...manager.settings,
              apiKey: manager.settings.apiKey ? '[CONFIGURED]' : '[NOT_CONFIGURED]'
            },
            alarmActive: Boolean(alarm),
            alarmInfo: alarm || null
          };
        }
        case RUNTIME_ACTIONS.GET_NOTIFICATION_PROJECTS: {
          const result = await manager.getNotificationProjects({
            forceRefresh: request.forceRefresh === true
          });
          return { success: true, ...result };
        }
        case RUNTIME_ACTIONS.GET_DIAGNOSTICS: {
          if (sender?.id !== this.chrome.runtime.id) {
            return { success: false, error: 'unauthorizedDiagnostics' };
          }
          if (Object.keys(request).some(key => key !== 'action')) {
            return { success: false, error: 'diagnosticsUnsafe' };
          }
          try {
            const diagnostics = await this.diagnosticSnapshotBuilder.build();
            return { success: true, diagnostics };
          } catch {
            return { success: false, error: 'diagnosticsUnsafe' };
          }
        }
        default:
          return { success: false, error: 'unknownAction' };
      }
    }

    handleMessage(request, sender, sendResponse) {
      const validation = this.validateRequest(request);
      if (!validation.valid) {
        sendResponse({ success: false, error: validation.error });
        return false;
      }

      this.dispatch(request, sender)
        .then(sendResponse)
        .catch(error => {
          const issueAction = [
            RUNTIME_ACTIONS.GET_ISSUE_ACTION_CONTEXT,
            RUNTIME_ACTIONS.APPLY_ISSUE_CHANGES
          ].includes(request.action);
          const errorCode = issueAction
            ? this.notificationService.resolveIssueActionError(error)
            : safeErrorCode(error);
          this.logger?.error('runtime_action_failed', {
            action: request.action,
            errorCode
          });
          sendResponse({ success: false, error: errorCode });
        });
      return true;
    }
  }

  return {
    RUNTIME_ACTIONS,
    RuntimeRouter,
    safeErrorCode
  };
});
