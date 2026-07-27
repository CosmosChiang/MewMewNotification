(function initializeNotificationService(root, factory) {
  const exports = factory();
  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else Object.assign(root, exports);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createNotificationServiceExports() {
  const HOST_PERMISSION_RECOVERY_NOTIFICATION_ID = 'host-permission-recovery';
  const NOTIFICATION_HISTORY_STORAGE_KEY = 'notificationHistory';
  const MAX_NOTIFICATION_HISTORY_ITEMS = 100;
  const NOTIFICATION_PROJECT_CACHE_STORAGE_KEY = 'notificationProjectMetadataCache';
  const NOTIFICATION_PROJECT_CACHE_TTL_MS = 5 * 60 * 1000;
  const MAX_REQUEST_RETRIES = 3;
  const MAX_READ_NOTIFICATIONS = 1000;
  const RETRY_ALARM_NAME = 'redmine-notification-retry';
  const RETRY_METADATA_KEY = 'notificationRetryV1';
  const MAX_ISSUE_STATES = 5000;
  const FULL_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const DESKTOP_MAPPING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_DESKTOP_MAPPINGS = 100;
  const DefaultRedmineAPIClass = globalThis.RedmineAPI
    || (typeof require === 'function' ? require('./redmine-api.js').RedmineAPI : undefined);
  const DefaultNotificationPolicy = globalThis.NotificationPolicy
    || (typeof require === 'function' ? require('./notification-policy.js') : undefined);
  const DefaultConfigManagerClass = globalThis.ConfigManager
    || (typeof require === 'function' ? require('../shared/config-manager.js').ConfigManager : undefined);
  const DefaultProfileStateManagerClass = globalThis.ProfileStateManager
    || (typeof require === 'function' ? require('../shared/profile-state-manager.js').ProfileStateManager : undefined);

  class NotificationService {
    constructor({
      chrome: chromeApi = globalThis.chrome,
      logger,
      i18n,
      profileState,
      RedmineAPIClass = DefaultRedmineAPIClass,
      policy = DefaultNotificationPolicy,
      ConfigManagerClass = DefaultConfigManagerClass,
      now = Date.now
    } = {}) {
      this.chrome = chromeApi;
      this.logger = logger || { debug() {}, info() {}, warn() {}, error() {} };
      this.i18n = i18n;
      this.policy = {
        ...DefaultNotificationPolicy,
        ...(policy || {})
      };
      this.ConfigManagerClass = ConfigManagerClass;
      this.RedmineAPIClass = RedmineAPIClass;
      this.now = now;
      this.notifications = new Map();
      this.notificationHistoryStorageKey = NOTIFICATION_HISTORY_STORAGE_KEY;
      this.notificationHistoryLimit = MAX_NOTIFICATION_HISTORY_ITEMS;
      this.settings = this.getDefaultSettings();
      this.settingsLoaded = false;
      this.settingsLoadPromise = undefined;
      this.translations = {};
      this.currentLanguage = 'en';
      if (profileState !== undefined) {
        this.profileState = profileState;
      } else {
        this.profileState = DefaultProfileStateManagerClass && this.chrome
          ? new DefaultProfileStateManagerClass(this.chrome.storage)
          : null;
      }
      this.activeProfile = null;
      this.checkPromise = null;
    }

    async initialize() {
      await Promise.all([
        this.loadSettings({ notifyPermissionRecovery: true }),
        this.loadLanguage()
      ]);
    }

    getDefaultSettings() {
      const configManagerClass = this.ConfigManagerClass;
      if (configManagerClass?.normalizeRuntimeSettings) {
        return configManagerClass.normalizeRuntimeSettings({}, {});
      }

      return {
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
    }

    async loadLanguage(languageOverride) {
      if (!this.i18n) {
        this.currentLanguage = 'en';
        this.translations = {};
        return this.translations;
      }
      this.translations = await this.i18n.loadLanguage(languageOverride);
      this.currentLanguage = this.i18n.getCurrentLanguage();
      return this.translations;
    }

    translate(key, substitutions = []) {
      return this.i18n ? this.i18n.translate(key, substitutions) : key;
    }

    getFallbackTranslation(key, fallbackMessage) {
      return this.translations[key]?.message || fallbackMessage;
    }

    normalizeStorageResult(result) {
      const configManagerClass = this.ConfigManagerClass;
      return configManagerClass?.normalizeStorageResult
        ? configManagerClass.normalizeStorageResult(result)
        : (result && typeof result === 'object' ? result : {});
    }

    normalizeProjectMetadataRecord(project) {
      if (!project || typeof project !== 'object' || !Number.isInteger(project.id)) {
        return undefined;
      }

      const trimmedName = typeof project.name === 'string' ? project.name.trim() : '';
      if (!trimmedName) {
        return undefined;
      }

      return {
        id: project.id,
        name: trimmedName,
        identifier: typeof project.identifier === 'string' ? project.identifier.trim() : ''
      };
    }

    normalizeProjectMetadataRecords(projects) {
      if (!Array.isArray(projects)) {
        return [];
      }

      return projects
        .map(project => this.normalizeProjectMetadataRecord(project))
        .filter(Boolean)
        .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);
    }

    async loadCachedNotificationProjects(redmineUrl) {
      if (this.activeProfile && this.profileState) {
        const cacheEntry = await this.profileState.read(this.activeProfile.profileId, 'projectCache', null);
        if (!cacheEntry || cacheEntry.redmineUrl !== redmineUrl) return undefined;
        const fetchedAt = Number(cacheEntry.fetchedAt);
        if (!Number.isFinite(fetchedAt) || this.now() - fetchedAt > NOTIFICATION_PROJECT_CACHE_TTL_MS) return undefined;
        return { cached: true, projects: this.normalizeProjectMetadataRecords(cacheEntry.projects) };
      }
      const result = this.normalizeStorageResult(
        await this.chrome.storage.local.get([NOTIFICATION_PROJECT_CACHE_STORAGE_KEY])
      );
      const cacheEntry = result[NOTIFICATION_PROJECT_CACHE_STORAGE_KEY];
      if (!cacheEntry || typeof cacheEntry !== 'object' || cacheEntry.redmineUrl !== redmineUrl) {
        return undefined;
      }

      const fetchedAt = Number.isFinite(cacheEntry.fetchedAt)
        ? cacheEntry.fetchedAt
        : Date.parse(cacheEntry.fetchedAt);
      if (!Number.isFinite(fetchedAt) || this.now() - fetchedAt > NOTIFICATION_PROJECT_CACHE_TTL_MS) {
        return undefined;
      }

      return {
        cached: true,
        projects: this.normalizeProjectMetadataRecords(cacheEntry.projects)
      };
    }

    async saveNotificationProjectsCache(redmineUrl, projects) {
      const normalizedProjects = this.normalizeProjectMetadataRecords(projects);
      const cacheEntry = { redmineUrl, fetchedAt: this.now(), projects: normalizedProjects };
      if (this.activeProfile && this.profileState) {
        await this.profileState.write(this.activeProfile.profileId, 'projectCache', cacheEntry);
      } else {
        await this.chrome.storage.local.set({ [NOTIFICATION_PROJECT_CACHE_STORAGE_KEY]: cacheEntry });
      }

      return normalizedProjects;
    }

    parseHistoryDate(value) {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? new Date(0) : date;
    }

    normalizeChangeSummary(changeSummary) {
      return this.policy.normalizeChangeSummary(changeSummary);
    }

    normalizeIssueSnapshot(snapshot) {
      return this.policy.normalizeIssueSnapshot(snapshot);
    }

    normalizeNotificationHistoryRecord(record) {
      if (!record || typeof record !== 'object') {
        return undefined;
      }

      const id = typeof record.id === 'string' ? record.id : '';
      if (!id) {
        return undefined;
      }

      const updatedOn = this.parseHistoryDate(record.updatedOn);

      return {
        id,
        profileId: typeof record.profileId === 'string' ? record.profileId : '',
        issueId: Number.isInteger(record.issueId) ? record.issueId : undefined,
        title: typeof record.title === 'string' ? record.title : '',
        project: typeof record.project === 'string' ? record.project : '',
        author: typeof record.author === 'string' ? record.author : '',
        status: typeof record.status === 'string' ? record.status : '',
        priority: typeof record.priority === 'string' ? record.priority : '',
        assigneeId: Number.isInteger(record.assigneeId) ? record.assigneeId : undefined,
        assigneeName: typeof record.assigneeName === 'string' ? record.assigneeName : '',
        projectId: Number.isInteger(record.projectId) ? record.projectId : undefined,
        updatedOn,
        url: typeof record.url === 'string' ? record.url : '',
        read: record.read === true,
        isUpdated: record.isUpdated === true,
        bundleCount: Number.isSafeInteger(record.bundleCount) && record.bundleCount > 0
          ? record.bundleCount
          : 1,
        sourceType: typeof record.sourceType === 'string' ? record.sourceType : 'unknown',
        changeSummary: this.normalizeChangeSummary(record.changeSummary),
        lastSeenState: this.normalizeIssueSnapshot(record.lastSeenState)
      };
    }

    serializeNotificationHistoryRecord(record) {
      const normalizedRecord = this.normalizeNotificationHistoryRecord(record);
      if (!normalizedRecord) {
        return undefined;
      }

      return {
        ...normalizedRecord,
        updatedOn: normalizedRecord.updatedOn.toISOString()
      };
    }

    applyNotificationHistoryRetention(records) {
      return records
        .map(record => this.normalizeNotificationHistoryRecord(record))
        .filter(Boolean)
        .sort((left, right) => right.updatedOn - left.updatedOn)
        .slice(0, this.notificationHistoryLimit);
    }

    async loadNotificationHistory() {
      if (this.activeProfile && this.profileState) {
        const history = await this.profileState.read(this.activeProfile.profileId, 'history', []);
        return this.applyNotificationHistoryRetention(history);
      }
      const result = this.normalizeStorageResult(
        await this.chrome.storage.local.get([this.notificationHistoryStorageKey])
      );
      const history = Array.isArray(result[this.notificationHistoryStorageKey])
        ? result[this.notificationHistoryStorageKey]
        : [];

      return this.applyNotificationHistoryRetention(history);
    }

    async saveNotificationHistory(history) {
      const retainedHistory = this.applyNotificationHistoryRetention(history);
      const serializedHistory = retainedHistory
        .map(record => this.serializeNotificationHistoryRecord(record))
        .filter(Boolean);

      if (this.activeProfile && this.profileState) {
        await this.profileState.write(this.activeProfile.profileId, 'history', serializedHistory);
      } else {
        await this.chrome.storage.local.set({ [this.notificationHistoryStorageKey]: serializedHistory });
      }

      return retainedHistory;
    }

    async mergeNotificationHistory(notifications, { readNotificationIds = [] } = {}) {
      const existingHistory = await this.loadNotificationHistory();
      const historyById = new Map(existingHistory.map(record => [record.id, record]));
      const readNotificationSet = new Set(Array.isArray(readNotificationIds) ? readNotificationIds : []);

      (Array.isArray(notifications) ? notifications : []).forEach(notification => {
        const normalizedNotification = this.normalizeNotificationHistoryRecord(notification);
        if (!normalizedNotification) {
          return;
        }

        const existingRecord = historyById.get(normalizedNotification.id);
        const reconciledReadState = normalizedNotification.isUpdated
          ? normalizedNotification.read
          : normalizedNotification.read || existingRecord?.read === true || readNotificationSet.has(normalizedNotification.id);

        historyById.set(normalizedNotification.id, {
          ...existingRecord,
          ...normalizedNotification,
          read: reconciledReadState
        });
      });

      return this.saveNotificationHistory(Array.from(historyById.values()));
    }

    async loadSettings({ notifyPermissionRecovery = false } = {}) {
      if (this.settingsLoadPromise) {
        return this.settingsLoadPromise;
      }

      this.settingsLoadPromise = this.loadSettingsInternal({ notifyPermissionRecovery });

      try {
        return await this.settingsLoadPromise;
      } finally {
        this.settingsLoadPromise = undefined;
      }
    }

    async loadSettingsInternal({ notifyPermissionRecovery = false } = {}) {
      const settingsAtStart = this.settings;
      const configManagerClass = this.ConfigManagerClass;
      if (configManagerClass?.migrateLegacyApiKey) {
        await configManagerClass.migrateLegacyApiKey();
      }

      const [syncResult, localResult] = await Promise.all([
        this.chrome.storage.sync.get(
          configManagerClass?.getSyncSettingKeys
            ? configManagerClass.getSyncSettingKeys()
            : [
                'redmineUrl',
                'checkInterval',
                'enableNotifications',
                'enableSound',
                'maxNotifications',
                'readNotifications',
                'onlyMyProjects',
                'includeWatchedIssues'
              ]
        ),
        this.chrome.storage.local.get(['apiKey'])
      ]);

      const loadedSettings = configManagerClass?.normalizeRuntimeSettings
        ? configManagerClass.normalizeRuntimeSettings(syncResult, localResult)
        : this.getDefaultSettings();
      // Do not let an older asynchronous load overwrite settings explicitly replaced
      // while storage reads were in flight (for example immediately after saving credentials).
      if (this.settings !== settingsAtStart) return this.settings;
      this.settings = loadedSettings;
      this.settingsLoaded = true;

      await this.syncHostPermissionRecoveryState({ notify: notifyPermissionRecovery });

      this.logger.debug('Settings loaded:', {
        redmineUrl: this.settings.redmineUrl ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
        apiKey: this.settings.apiKey ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
        checkInterval: this.settings.checkInterval,
        enableNotifications: this.settings.enableNotifications,
        enableSound: this.settings.enableSound,
        maxNotifications: this.settings.maxNotifications,
        onlyMyProjects: this.settings.onlyMyProjects,
        includeWatchedIssues: this.settings.includeWatchedIssues,
        notificationProjectRules: this.settings.notificationProjectRules,
        notificationChangeFilters: this.settings.notificationChangeFilters,
        notificationQuietHours: this.settings.notificationQuietHours,
        notificationBundling: this.settings.notificationBundling
      });
    }

    async ensureSettingsLoaded() {
      if (this.settingsLoaded) {
        return this.settings;
      }

      await this.loadSettings();
      return this.settings;
    }

    async resolveActiveProfile(apiClient) {
      if (!this.profileState) return null;
      const api = apiClient || await this.createApiClient();
      const user = await api.getCurrentUser();
      const identity = await this.profileState.createProfileIdentity(
        this.settings.redmineUrl, user.id, this.settings.apiKey
      );
      if (this.activeProfile?.profileId === identity.profileId) return this.activeProfile;
      if (this.activeProfile?.profileId && this.activeProfile.profileId !== identity.profileId) {
        await this.clearRetryMetadata();
      }
      this.activeProfile = await this.profileState.initializeAndActivate(identity);
      this.settings.readNotifications = await this.profileState.read(identity.profileId, 'readIds', []);
      this.notifications.clear();
      return this.activeProfile;
    }

    async restoreActiveProfile() {
      if (!this.profileState || !this.settings.redmineUrl) return null;
      const restored = await this.profileState.restoreActiveProfile(this.settings.redmineUrl);
      if (restored) {
        this.activeProfile = restored;
        this.settings.readNotifications = await this.profileState.read(restored.profileId, 'readIds', []);
      }
      return restored;
    }

    async requireProfile(profileId = this.activeProfile?.profileId) {
      if (!this.activeProfile) await this.resolveActiveProfile();
      await this.profileState?.assertActiveProfile(profileId);
      return this.activeProfile;
    }

    async assertNotificationOwnership(notificationId, profileId) {
      await this.requireProfile(profileId);
      if (!notificationId) return;
      const history = await this.loadNotificationHistory();
      const record = this.notifications.get(notificationId) || history.find(item => item.id === notificationId);
      if (!record || record.profileId !== this.activeProfile.profileId) throw new Error('profileMismatch');
    }

    resolveErrorMessage(message) {
      const translated = this.translate(message);
      if (translated !== message) {
        return translated;
      }

      const configManagerClass = this.ConfigManagerClass;
      if (configManagerClass?.redactSensitiveText) {
        const sanitizedMessage = configManagerClass.redactSensitiveText(message);
        if (sanitizedMessage) {
          return sanitizedMessage;
        }
      }

      return message;
    }

    getConfiguredHostPermissionState() {
      if (!this.settings?.redmineUrl || !this.settings?.apiKey) {
        return { configured: false };
      }

      const configManagerClass = this.ConfigManagerClass;
      const validation = configManagerClass?.validateRedmineUrl
        ? configManagerClass.validateRedmineUrl(this.settings.redmineUrl)
        : { valid: true, originPattern: undefined };

      if (!validation.valid) {
        return {
          configured: true,
          valid: false,
          errorMessage: validation.messageKey || 'invalidUrlFormat'
        };
      }

      return {
        configured: true,
        valid: true,
        validation,
        permissionRequest: validation.originPattern
          ? { origins: [validation.originPattern] }
          : undefined
      };
    }

    async getDiagnosticConfiguration() {
      await this.ensureSettingsLoaded();
      let transportScheme = null;
      if (this.settings?.redmineUrl) {
        try {
          const protocol = new URL(this.settings.redmineUrl).protocol;
          if (protocol === 'http:' || protocol === 'https:') {
            transportScheme = protocol.slice(0, -1);
          }
        } catch {
          transportScheme = null;
        }
      }
      return {
        redmineConfigured: Boolean(this.settings?.redmineUrl),
        apiKeyConfigured: Boolean(this.settings?.apiKey),
        transportScheme
      };
    }

    async getConfiguredHostAccessGranted() {
      const permissionState = this.getConfiguredHostPermissionState();
      if (!permissionState.configured || !permissionState.valid || !permissionState.permissionRequest) {
        return false;
      }
      return new Promise(resolve => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          resolve(value === true);
        };
        try {
          const maybePromise = this.chrome.permissions.contains(
            permissionState.permissionRequest,
            finish
          );
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(finish).catch(() => finish(false));
          }
        } catch {
          finish(false);
        }
      });
    }

    async notifyHostPermissionRecovery(normalizedUrl) {
      if (!this.chrome.notifications?.create || !this.chrome.storage?.local) {
        return;
      }

      const result = this.normalizeStorageResult(
        await this.chrome.storage.local.get(['hostPermissionRecoveryNotifiedFor'])
      );
      if (result.hostPermissionRecoveryNotifiedFor === normalizedUrl) {
        return;
      }

      this.chrome.notifications.create(
        HOST_PERMISSION_RECOVERY_NOTIFICATION_ID,
        {
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: this.getFallbackTranslation('extName', 'MewMewNotification'),
          message: this.getFallbackTranslation(
            'hostPermissionRequired',
            'Grant host access for the configured Redmine server before syncing'
          ),
          contextMessage: normalizedUrl
        },
        () => {
          if (this.chrome.runtime.lastError) {
            this.logger.error('Failed to create host permission recovery notification:', this.chrome.runtime.lastError);
          }
        }
      );

      await this.chrome.storage.local.set({
        hostPermissionRecoveryNotifiedFor: normalizedUrl
      });
    }

    async clearHostPermissionRecoveryState() {
      if (!this.chrome.storage?.local) {
        return;
      }

      const result = this.normalizeStorageResult(
        await this.chrome.storage.local.get(['lastErrorCode'])
      );

      await this.chrome.storage.local.remove([
        'hostPermissionRecoveryRequired',
        'hostPermissionRecoveryUrl',
        'hostPermissionRecoveryOrigin',
        'hostPermissionRecoveryNotifiedFor'
      ]);

      if (this.chrome.notifications?.clear) {
        this.chrome.notifications.clear(HOST_PERMISSION_RECOVERY_NOTIFICATION_ID, () => {});
      }

      if (result.lastErrorCode === 'hostPermissionRequired') {
        await this.chrome.storage.local.set({
          lastError: null,
          lastErrorCode: null,
          lastErrorTime: null,
          shouldRetry: null
        });

        const unreadCount = Array.from(this.notifications.values()).filter(notification => !notification.read).length;
        this.updateBadge(unreadCount);
        this.chrome.action.setTitle({
          title: this.getFallbackTranslation('extName', 'MewMewNotification')
        });
      }
    }

    async syncHostPermissionRecoveryState({ notify = false } = {}) {
      const permissionState = this.getConfiguredHostPermissionState();
      if (!permissionState.configured || !permissionState.valid || !this.chrome.permissions?.contains || !permissionState.permissionRequest) {
        await this.clearHostPermissionRecoveryState();
        return;
      }

      const hasPermission = await this.chrome.permissions.contains(permissionState.permissionRequest);
      if (hasPermission) {
        await this.clearHostPermissionRecoveryState();
        return;
      }

      const errorMessage = this.getFallbackTranslation(
        'hostPermissionRequired',
        'Grant host access for the configured Redmine server before syncing'
      );

      await this.chrome.storage.local.set({
        hostPermissionRecoveryRequired: true,
        hostPermissionRecoveryUrl: permissionState.validation.normalizedUrl,
        hostPermissionRecoveryOrigin: permissionState.validation.originPattern,
        lastError: errorMessage,
        lastErrorCode: 'hostPermissionRequired',
        lastErrorTime: this.now(),
        shouldRetry: false
      });

      this.chrome.action.setBadgeText({ text: '!' });
      this.chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
      this.chrome.action.setTitle({ title: `Error: ${errorMessage}` });

      if (notify) {
        await this.notifyHostPermissionRecovery(permissionState.validation.normalizedUrl);
      }
    }

    async ensureConfiguredHostAccess() {
      const permissionState = this.getConfiguredHostPermissionState();
      if (!permissionState.configured) {
        return;
      }

      if (!permissionState.valid) {
        throw new Error(permissionState.errorMessage);
      }

      if (!this.chrome.permissions?.contains || !permissionState.permissionRequest) {
        return;
      }

      const hasPermission = await this.chrome.permissions.contains(permissionState.permissionRequest);

      if (!hasPermission) {
        throw new Error('hostPermissionRequired');
      }
    }

    async createApiClient() {
      await this.ensureSettingsLoaded();

      if (!this.settings.redmineUrl || !this.settings.apiKey) {
        throw new Error('missingRequiredSettings');
      }

      await this.ensureConfiguredHostAccess();
      return new this.RedmineAPIClass(this.settings.redmineUrl, this.settings.apiKey);
    }

    async getNotificationProjects({ forceRefresh = false } = {}) {
      await this.ensureSettingsLoaded();

      if (!this.settings.redmineUrl || !this.settings.apiKey) {
        throw new Error('missingRequiredSettings');
      }

      const api = await this.createApiClient();
      await this.restoreActiveProfile();
      if (!this.activeProfile) await this.resolveActiveProfile(api);

      if (!forceRefresh) {
        const cachedProjects = await this.loadCachedNotificationProjects(this.settings.redmineUrl);
        if (cachedProjects) {
          return cachedProjects;
        }
      }

      const response = await api.getProjects();
      const projects = await this.saveNotificationProjectsCache(this.settings.redmineUrl, response.projects);

      return {
        cached: false,
        projects
      };
    }

    buildNotificationFromIssue(issue, existingNotification = {}) {
      const lastSeenState = existingNotification.lastSeenState || this.buildIssueSnapshot(issue);
      const updatedOn = new Date(issue.updated_on);

      return {
        id: typeof existingNotification.id === 'string' && existingNotification.id
          ? existingNotification.id
          : this.createNotificationRecordId(issue, updatedOn),
        issueId: issue.id,
        profileId: this.activeProfile?.profileId || existingNotification.profileId || '',
        title: `#${issue.id}: ${issue.subject}`,
        project: issue.project?.name || this.translate('unknownProject'),
        author: issue.author?.name || this.translate('unknownAuthor'),
        status: issue.status?.name || this.translate('unknownStatus'),
        priority: issue.priority?.name || this.translate('normalPriority'),
        assigneeId: issue.assigned_to?.id,
        assigneeName: issue.assigned_to?.name || '',
        projectId: issue.project?.id,
        updatedOn,
        url: `${this.settings.redmineUrl}/issues/${issue.id}`,
        read: existingNotification.read === true,
        isUpdated: existingNotification.isUpdated === true,
        bundleCount: Number.isSafeInteger(existingNotification.bundleCount) && existingNotification.bundleCount > 0
          ? existingNotification.bundleCount
          : 1,
        sourceType: issue.sourceType || existingNotification.sourceType || 'unknown',
        changeSummary: this.normalizeChangeSummary(existingNotification.changeSummary),
        lastSeenState
      };
    }

    buildIssueSnapshot(issue) {
      return this.policy.snapshotIssue(issue);
    }

    buildIssueChangeSummary(previousState, currentState) {
      return this.policy.buildChangeSummary(previousState, currentState);
    }

    getNotificationProjectRules() {
      const configManagerClass = this.ConfigManagerClass;
      if (configManagerClass?.normalizeNotificationProjectRules) {
        return configManagerClass.normalizeNotificationProjectRules(this.settings?.notificationProjectRules);
      }

      return {
        mode: 'all',
        includeProjectIds: [],
        excludeProjectIds: []
      };
    }

    getNotificationChangeFilters() {
      const configManagerClass = this.ConfigManagerClass;
      if (configManagerClass?.normalizeNotificationChangeFilters) {
        return configManagerClass.normalizeNotificationChangeFilters(this.settings?.notificationChangeFilters);
      }

      return {
        status: true,
        assignee: true,
        priority: true,
        comment: true,
        generic: true
      };
    }

    getNotificationQuietHours() {
      const configManagerClass = this.ConfigManagerClass;
      if (configManagerClass?.normalizeNotificationQuietHours) {
        return configManagerClass.normalizeNotificationQuietHours(this.settings?.notificationQuietHours);
      }

      return {
        enabled: false,
        start: '22:00',
        end: '08:00'
      };
    }

    getNotificationBundling() {
      const configManagerClass = this.ConfigManagerClass;
      if (configManagerClass?.normalizeNotificationBundling) {
        return configManagerClass.normalizeNotificationBundling(this.settings?.notificationBundling);
      }

      return {
        enabled: false,
        windowMinutes: 5
      };
    }

    createNotificationRecordId(issue, updatedOn = issue?.updated_on) {
      const normalizedIssueId = Number.isInteger(issue?.id)
        ? issue.id
        : Number.parseInt(issue?.issueId, 10);
      const bundling = this.getNotificationBundling();

      if (!bundling.enabled || !Number.isSafeInteger(normalizedIssueId) || normalizedIssueId <= 0) {
        return `issue_${normalizedIssueId}`;
      }

      const updatedTimestamp = updatedOn instanceof Date
        ? updatedOn.getTime()
        : Number.isFinite(updatedOn)
          ? updatedOn
          : new Date(updatedOn).getTime();

      return `issue_${normalizedIssueId}_${Number.isFinite(updatedTimestamp) ? updatedTimestamp : this.now()}`;
    }

    getNotificationsForIssue(issueId) {
      const normalizedIssueId = Number.parseInt(issueId, 10);
      if (!Number.isSafeInteger(normalizedIssueId) || normalizedIssueId <= 0) {
        return [];
      }

      return Array.from(this.notifications.values())
        .filter(notification => notification.issueId === normalizedIssueId)
        .sort((left, right) => right.updatedOn - left.updatedOn);
    }

    findLatestNotificationForIssue(issueId) {
      return this.getNotificationsForIssue(issueId)[0];
    }

    findBundlingTarget(issueId, updatedOn) {
      const bundling = this.getNotificationBundling();
      return this.policy.findBundlingTarget(
        this.getNotificationsForIssue(issueId),
        issueId,
        updatedOn,
        bundling
      );
    }

    mergeChangeSummary(existingSummary, nextSummary) {
      const mergedByField = new Map();

      this.normalizeChangeSummary(existingSummary).forEach(change => {
        mergedByField.set(change.field, { ...change });
      });

      this.normalizeChangeSummary(nextSummary).forEach(change => {
        const existingChange = mergedByField.get(change.field);
        if (!existingChange) {
          mergedByField.set(change.field, { ...change });
          return;
        }

        mergedByField.set(change.field, {
          field: change.field,
          from: existingChange.from || change.from,
          to: change.to
        });
      });

      return Array.from(mergedByField.values());
    }

    isProjectNotificationEligible(projectId) {
      const projectRules = this.getNotificationProjectRules();
      return this.policy.isProjectEligible(projectId, projectRules);
    }

    hasExplicitCommentActivity(issue) {
      return this.policy.hasExplicitCommentActivity(issue);
    }

    classifyIssueUpdate(previousState, currentState, issue) {
      return this.policy.classifyIssueUpdate(previousState, currentState, issue);
    }

    areNotificationChangeCategoriesEnabled(changeCategories) {
      const changeFilters = this.getNotificationChangeFilters();
      const normalizedCategories = Array.isArray(changeCategories) && changeCategories.length > 0
        ? changeCategories
        : ['generic'];

      return normalizedCategories.some(category => {
        if (Object.prototype.hasOwnProperty.call(changeFilters, category)) {
          return changeFilters[category] !== false;
        }

        return changeFilters.generic !== false;
      });
    }

    isWithinQuietHours(referenceTime = new Date()) {
      const quietHours = this.getNotificationQuietHours();
      return this.policy.isWithinQuietHours(referenceTime, quietHours);
    }

    evaluateNotificationCandidate(issue, previousState, currentState) {
      if (!this.isProjectNotificationEligible(issue?.project?.id)) {
        return {
          retain: false,
          deliver: false,
          reason: 'project'
        };
      }

      if (!previousState) {
        const quietHoursSuppressed = this.isWithinQuietHours();

        return {
          retain: true,
          deliver: !quietHoursSuppressed,
          quietHoursSuppressed,
          changeCategories: []
        };
      }

      const changeCategories = this.classifyIssueUpdate(previousState, currentState, issue);
      if (!this.areNotificationChangeCategoriesEnabled(changeCategories)) {
        return {
          retain: false,
          deliver: false,
          reason: 'change-filter',
          changeCategories
        };
      }

      const quietHoursSuppressed = this.isWithinQuietHours();

      return {
        retain: true,
        deliver: !quietHoursSuppressed,
        quietHoursSuppressed,
        changeCategories
      };
    }

    async syncUpdatedIssue(issue) {
      const currentState = this.buildIssueSnapshot(issue);
      const bundlingTarget = this.findBundlingTarget(issue.id, currentState.updatedOn);
      const notificationId = bundlingTarget?.id || this.createNotificationRecordId(issue, currentState.updatedOn);
      const existingNotification = bundlingTarget
        || this.notifications.get(notificationId)
        || this.findLatestNotificationForIssue(issue.id)
        || {};
      const changeSummary = existingNotification.lastSeenState
        ? this.buildIssueChangeSummary(existingNotification.lastSeenState, currentState)
        : [];
      const syncedNotification = this.buildNotificationFromIssue(issue, {
        ...existingNotification,
        id: notificationId,
        isUpdated: false,
        bundleCount: bundlingTarget
          ? Math.max(existingNotification.bundleCount || 1, 1) + 1
          : 1,
        changeSummary: bundlingTarget
          ? this.mergeChangeSummary(existingNotification.changeSummary, changeSummary)
          : changeSummary,
        lastSeenState: currentState
      });

      this.notifications.set(notificationId, syncedNotification);
      const retainedHistory = await this.mergeNotificationHistory([syncedNotification], {
        readNotificationIds: this.settings.readNotifications
      });

      const unreadCount = retainedHistory
        .filter(notification => !notification.read)
        .length;
      this.updateBadge(unreadCount);

      return syncedNotification;
    }

    formatIssueActionContext(context) {
      return {
        permissions: context.permissions,
        current: context.current,
        statusOptions: context.statusOptions,
        assigneeOptions: context.assigneeOptions
      };
    }

    resolveIssueActionError(error) {
      if (typeof error?.message === 'string') {
        if (/403|forbidden/i.test(error.message)) {
          return this.translate('permissionDenied');
        }

        if (/Reply content is required/i.test(error.message)) {
          return this.translate('replyRequired');
        }

        if (/Reply content is too long/i.test(error.message)) {
          return this.translate('replyTooLong');
        }

        if (/Invalid (issue|status|assignee) id/i.test(error.message)) {
          return this.translate('issueActionValidationError');
        }

        if (/No issue changes provided/i.test(error.message)) {
          return this.translate('noChangesToSubmit');
        }
      }

      return this.resolveErrorMessage(error.message || String(error));
    }

    async getIssueActionContext(issueId, profileId, notificationId) {
      try {
        await this.assertNotificationOwnership(notificationId, profileId);
        const api = await this.createApiClient();
        const context = await api.getIssueActionContext(issueId);

        return {
          success: true,
          context: this.formatIssueActionContext(context)
        };
      } catch (error) {
        return {
          success: false,
          error: this.resolveIssueActionError(error),
          status: error.code === 'outcomeUnknown' ? 'outcomeUnknown' : 'failure',
          requiresRefetch: error.code === 'outcomeUnknown'
        };
      }
    }

    async executeIssueAction(issueId, profileId, notificationId, actionCallback) {
      try {
        await this.assertNotificationOwnership(notificationId, profileId);
        const api = await this.createApiClient();
        await actionCallback(api);

        const context = await api.getIssueActionContext(issueId);
        const notification = await this.syncUpdatedIssue(context.issue);

        return {
          success: true,
          notification,
          context: this.formatIssueActionContext(context)
        };
      } catch (error) {
        return {
          success: false,
          error: this.resolveIssueActionError(error),
          status: error.code === 'outcomeUnknown' ? 'outcomeUnknown' : 'failure',
          requiresRefetch: error.code === 'outcomeUnknown'
        };
      }
    }

    async applyIssueChanges(issueId, changes, profileId, notificationId) {
      return this.executeIssueAction(issueId, profileId, notificationId, api => api.applyIssueChanges(issueId, changes));
    }

    createSyncResult(status, details = {}) {
      return {
        status,
        success: status === 'success',
        stale: details.stale === true,
        startedAt: details.startedAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
        lastSuccessAt: details.lastSuccessAt || null,
        errorCode: details.errorCode || null,
        retry: details.retry || null,
        trigger: details.trigger || 'unknown'
      };
    }

    requestSync(trigger = 'unknown', { force = false } = {}) {
      if (this.checkPromise) return this.checkPromise;
      const startedAt = new Date().toISOString();
      this.checkPromise = (async () => {
        if (force && this.activeProfile && this.profileState) {
          await this.profileState.write(this.activeProfile.profileId, 'seenIds', []);
        }
        return this.checkNotifications({ trigger, startedAt });
      })().finally(() => {
        this.checkPromise = null;
      });
      return this.checkPromise;
    }

    async scheduleRetry(error) {
      const retryCount = Math.min(Number(error.retryCount) || 1, MAX_REQUEST_RETRIES);
      const retryAfterSeconds = Math.min(Number(error.retryAfterSeconds) || 60, 300);
      if (retryCount > MAX_REQUEST_RETRIES) throw new Error('rateLimitRetryExceeded');
      const nextAttemptAt = this.now() + retryAfterSeconds * 1000;
      const metadata = { retryCount, nextAttemptAt, profileId: this.activeProfile?.profileId || null };
      await this.chrome.storage.local.set({ [RETRY_METADATA_KEY]: metadata });
      this.chrome.alarms.create(RETRY_ALARM_NAME, { when: nextAttemptAt });
      return metadata;
    }

    async clearRetryMetadata() {
      await this.chrome.storage.local.remove([RETRY_METADATA_KEY]);
      await new Promise(resolve => this.chrome.alarms.clear(RETRY_ALARM_NAME, () => resolve()));
    }

    async checkNotifications({ trigger = 'direct', startedAt = new Date().toISOString() } = {}) {
      await this.ensureSettingsLoaded();

      if (!this.settings.redmineUrl || !this.settings.apiKey) {
        this.logger.debug('Redmine settings not configured');
        return this.createSyncResult('failure', { trigger, startedAt, errorCode: 'missingRequiredSettings' });
      }

      this.logger.debug('Checking notifications...', {
        url: this.settings.redmineUrl ? '[CONFIGURED]' : '[NOT_CONFIGURED]',
        interval: this.settings.checkInterval,
        enabled: this.settings.enableNotifications
      });

      try {
        // Performance monitoring
        const startTime = performance.now();
        await this.ensureConfiguredHostAccess();

        const api = new this.RedmineAPIClass(this.settings.redmineUrl, this.settings.apiKey);
        await this.resolveActiveProfile(api);
        const retryState = await this.chrome.storage.local.get([RETRY_METADATA_KEY]);
        const retryMetadata = retryState?.[RETRY_METADATA_KEY];
        if (retryMetadata && retryMetadata.profileId === (this.activeProfile?.profileId || null)) {
          api.defaultRetryCount = Math.min(Number(retryMetadata.retryCount) || 0, MAX_REQUEST_RETRIES);
        }

        // Load last sync time from storage
        const cursor = this.profileState
          ? await this.profileState.read(this.activeProfile.profileId, 'cursor', null)
          : (await this.chrome.storage.local.get(['lastSyncTime'])).lastSyncTime;
        const cursorState = cursor && typeof cursor === 'object'
          ? cursor
          : { watermark: cursor || null, eventIds: [], reconciliationQueue: [], lastFullReconciliationAt: null };
        if (cursorState.watermark) api.lastSyncTime = new Date(cursorState.watermark);

        const response = await api.getIssuesLossless({
          onlyMyProjects: this.settings.onlyMyProjects,
          includeWatchedIssues: this.settings.includeWatchedIssues,
          cursor: cursorState.watermark
        });

        // Update last sync time
        const currentSyncTime = new Date();
        api.lastSyncTime = currentSyncTime;

        const apiDuration = performance.now() - startTime;
        if (apiDuration > 5000) {
          this.logger.warn(`Slow API response: ${apiDuration.toFixed(2)}ms`);
        }

        this.logger.debug('API response:', {
          issueCount: response.issues?.length || 0,
          totalCount: response.total_count,
          limit: response.limit,
          incrementalSync: api.lastSyncTime ? 'enabled' : 'disabled',
          duration: `${apiDuration.toFixed(2)}ms`
        });
        this.logger.debug('Only my projects filter:', this.settings.onlyMyProjects);
        this.logger.debug('Include watched issues:', this.settings.includeWatchedIssues);

        const issues = response.issues || [];
        const newNotifications = [];
        const updatedNotifications = [];

        // Get previous issue states for comparison
        const previousIssueStates = this.profileState
          ? await this.profileState.read(this.activeProfile.profileId, 'issueStates', {})
          : this.normalizeStorageResult(await this.chrome.storage.local.get(['issueStates'])).issueStates || {};
        const existingHistory = await this.loadNotificationHistory();
        const existingHistoryById = new Map(existingHistory.map(record => [record.id, record]));
        this.notifications = new Map(existingHistory.map(record => [record.id, record]));

        this.logger.debug('Previous issue states count:', Object.keys(previousIssueStates).length);
        this.logger.debug('Current issues count:', issues.length);

        const currentIssueIds = new Set(issues.map(issue => String(issue.id)));
        const trackedIds = Object.keys(previousIssueStates);
        const dueForFullReconciliation = Boolean(cursorState.watermark) && (
          !cursorState.lastFullReconciliationAt
          || this.now() - new Date(cursorState.lastFullReconciliationAt).getTime() >= FULL_RECONCILIATION_INTERVAL_MS
        );
        const missingIds = Array.from(new Set([
          ...(Array.isArray(cursorState.reconciliationQueue) ? cursorState.reconciliationQueue : []),
          ...trackedIds.filter(issueId => dueForFullReconciliation || !currentIssueIds.has(String(issueId)))
        ]));
        const reconciliationResults = missingIds.length ? await api.reconcileIssueIds(missingIds) : [];
        reconciliationResults.forEach(result => {
          if (result.unavailable) {
            const previous = previousIssueStates[result.id] || {};
            previousIssueStates[result.id] = {
              ...previous,
              unavailable: true,
              unavailableCode: result.errorCode,
              unavailableAt: previous.unavailableAt || this.now()
            };
          } else {
            const eventKey = `${result.id}:${new Date(result.updated_on).toISOString()}`;
            if (!issues.some(issue => `${issue.id}:${new Date(issue.updated_on).toISOString()}` === eventKey)) issues.push(result);
          }
        });

        // Create a copy of readNotifications to avoid modifying the original during iteration
        const readNotificationsCopy = [...this.settings.readNotifications];
        const updatedReadNotifications = [...this.settings.readNotifications];

        for (const issue of issues) {
          const currentUpdateTime = new Date(issue.updated_on).getTime();
          const previousState = previousIssueStates[issue.id];
          const currentState = this.buildIssueSnapshot(issue);
          const changeSummary = this.buildIssueChangeSummary(previousState, currentState);
          const bundlingTarget = this.findBundlingTarget(issue.id, currentUpdateTime);
          const notificationId = bundlingTarget?.id || this.createNotificationRecordId(issue, currentUpdateTime);
          const existingRecord = bundlingTarget
            || existingHistoryById.get(notificationId)
            || this.notifications.get(notificationId)
            || {};
          const isRead = readNotificationsCopy.includes(notificationId) || existingRecord.read === true;

          // Check if this is a new issue or an updated issue
          if (!previousState) {
            // New issue
            this.logger.debug(`New issue detected: ${issue.id}`);
            const candidate = this.evaluateNotificationCandidate(issue, previousState, currentState);

            if (candidate.retain) {
              const notification = this.buildNotificationFromIssue(issue, {
                ...existingRecord,
                id: notificationId,
                read: isRead,
                isUpdated: false,
                bundleCount: Number.isSafeInteger(existingRecord.bundleCount) && existingRecord.bundleCount > 0
                  ? existingRecord.bundleCount
                  : 1,
                sourceType: issue.sourceType || existingRecord.sourceType || 'unknown',
                changeSummary: [],
                lastSeenState: currentState
              });
              this.notifications.set(notificationId, notification);

              const hasSeenBefore = await this.hasSeenNotification(notificationId);
              if (!isRead && !hasSeenBefore && candidate.deliver) {
                newNotifications.push(notification);
              }
            }
          } else {
            // Existing issue - check for updates
            const previousUpdateTime = previousState.updatedOn;
            if (currentUpdateTime > previousUpdateTime) {
              // Issue has been updated
              this.logger.debug(`Updated issue detected: ${issue.id}`, {
                previous: new Date(previousUpdateTime),
                current: new Date(currentUpdateTime)
              });
              const candidate = this.evaluateNotificationCandidate(issue, previousState, currentState);

              if (candidate.retain) {
                const isBundledUpdate = bundlingTarget?.id === notificationId;
                const notification = this.buildNotificationFromIssue(issue, {
                  ...existingRecord,
                  id: notificationId,
                  read: isRead,
                  isUpdated: true,
                  bundleCount: isBundledUpdate
                    ? Math.max(existingRecord.bundleCount || 1, 1) + 1
                    : 1,
                  sourceType: issue.sourceType || existingRecord.sourceType || 'unknown',
                  changeSummary: isBundledUpdate
                    ? this.mergeChangeSummary(existingRecord.changeSummary, changeSummary)
                    : changeSummary,
                  lastSeenState: currentState
                });

                // If the issue was previously read but now updated, show notification again
                if (isRead) {
                  // Remove from read notifications to make it appear as unread
                  const readIndex = updatedReadNotifications.indexOf(notificationId);
                  if (readIndex > -1) {
                    updatedReadNotifications.splice(readIndex, 1);
                    notification.read = false;
                  }
                }

                this.notifications.set(notificationId, notification);

                if (candidate.deliver) {
                  updatedNotifications.push(notification);
                }
              }
            }
          }

          // Update the issue state in storage
          previousIssueStates[issue.id] = currentState;
        }

        // Update read notifications in storage only once after processing all issues
        if (updatedReadNotifications.length !== this.settings.readNotifications.length) {
          this.settings.readNotifications = updatedReadNotifications;
          if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'readIds', updatedReadNotifications);
          else await this.chrome.storage.sync.set({ readNotifications: updatedReadNotifications });
        }

        const retainedIssueStates = Object.fromEntries(Object.entries(previousIssueStates)
          .sort(([, left], [, right]) => Number(right.updatedOn || 0) - Number(left.updatedOn || 0))
          .slice(0, MAX_ISSUE_STATES));
        if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'issueStates', retainedIssueStates);
        else await this.chrome.storage.local.set({ issueStates: retainedIssueStates });

        await this.mergeNotificationHistory(
          Array.from(this.notifications.values()),
          { readNotificationIds: updatedReadNotifications }
        );

        this.logger.debug('New notifications:', newNotifications.length);
        this.logger.debug('Updated notifications:', updatedNotifications.length);

        // Update badge
        const unreadCount = Array.from(this.notifications.values()).filter(n => !n.read).length;
        this.updateBadge(unreadCount);

        // Store seen notifications
        const seenNotifications = Array.from(this.notifications.keys());
        if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'seenIds', seenNotifications);
        else await this.chrome.storage.local.set({ seenNotifications });

        const processedReconciliationIds = new Set(reconciliationResults.map(issue => String(issue.id)));
        const nextCursor = {
          version: 1,
          watermark: currentSyncTime.toISOString(),
          eventIds: issues.filter(issue => issue.updated_on).map(issue =>
            `${this.activeProfile?.profileId || 'legacy'}:${issue.id}:${new Date(issue.updated_on).toISOString()}`).slice(-5000),
          reconciliationQueue: missingIds.filter(id => !processedReconciliationIds.has(String(id))),
          lastFullReconciliationAt: dueForFullReconciliation
            ? currentSyncTime.toISOString()
            : cursorState.lastFullReconciliationAt
        };
        const successfulAt = this.now();
        if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'syncHealth', {
          version: 1, lastSuccessAt: successfulAt, lastErrorCode: null, lastErrorAt: null,
          stale: false, retry: null
        });
        else await this.chrome.storage.local.set({ lastError: null, lastErrorCode: null, lastErrorTime: null, lastSuccessAt: successfulAt });
        // Commit watermark last; any earlier storage failure preserves the previous cursor.
        if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'cursor', nextCursor);
        else await this.chrome.storage.local.set({ lastSyncTime: nextCursor.watermark });

        if (newNotifications.length > 0 && this.settings.enableNotifications) await this.showDesktopNotification(newNotifications, 'new');
        if (updatedNotifications.length > 0 && this.settings.enableNotifications) await this.showDesktopNotification(updatedNotifications, 'updated');

        this.logger.debug('Notification check completed. Unread count:', unreadCount);
        await this.clearRetryMetadata();
        return this.createSyncResult('success', {
          trigger, startedAt, lastSuccessAt: new Date().toISOString()
        });

      } catch (error) {
        this.logger.error('Failed to check notifications:', error);

        // Handle specific error types
        let errorMessage = this.resolveErrorMessage(error.message);
        let errorCode = null;
        let shouldRetry = true;
        if (error.message === 'rateLimitRetryScheduled') {
          const retry = await this.scheduleRetry(error);
          return this.createSyncResult('retryScheduled', {
            trigger, startedAt, stale: (await this.loadNotificationHistory()).length > 0,
            errorCode: 'rateLimited', retry
          });
        }

        if (error.message.includes('422')) {
          errorMessage = 'Invalid API parameters - check your Redmine configuration';
          shouldRetry = false; // Don't retry 422 errors immediately

        } else if (error.message.includes('401')) {
          errorMessage = 'Authentication failed - please check your API key';
          shouldRetry = false;

        } else if (error.message.includes('403')) {
          errorMessage = 'Access forbidden - insufficient permissions';
          shouldRetry = false;

        } else if (error.message.includes('404')) {
          errorMessage = 'Resource not found - please check your Redmine URL';
          shouldRetry = false;

        } else if (error.message.includes('connectionTimeout')) {
          errorMessage = 'Connection timeout - Redmine server may be slow';
        } else if (error.message === 'rateLimitRetryExceeded') {
          errorMessage = 'Rate limit retry limit reached';
          errorCode = 'rateLimitRetryExceeded';
          shouldRetry = false;

        } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
          errorMessage = 'Network error - check your internet connection';
        } else if (error.message === 'hostPermissionRequired') {
          errorMessage = this.translate('hostPermissionRequired');
          shouldRetry = false;
          errorCode = 'hostPermissionRequired';
          await this.syncHostPermissionRecoveryState({ notify: true });
        }

        // Store error information for debugging
        if (this.activeProfile && this.profileState) {
          const previousHealth = await this.profileState.read(this.activeProfile.profileId, 'syncHealth', {});
          await this.profileState.write(this.activeProfile.profileId, 'syncHealth', {
            version: 1,
            lastSuccessAt: previousHealth.lastSuccessAt || null,
            lastErrorCode: errorCode || 'syncFailed',
            lastErrorAt: this.now(),
            shouldRetry,
            stale: true,
            retry: null
          });
        } else {
          await this.chrome.storage.local.set({ lastError: errorMessage, lastErrorCode: errorCode, lastErrorTime: this.now(), shouldRetry });
        }

        // Update badge to show error state
        this.chrome.action.setBadgeText({ text: '!' });
        this.chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
        this.chrome.action.setTitle({ title: `Error: ${errorMessage}` });

        this.logger.debug(`Error handling completed. Should retry: ${shouldRetry}`);
        if (!shouldRetry) await this.clearRetryMetadata();
        const stale = (await this.loadNotificationHistory()).length > 0;
        return this.createSyncResult(stale ? 'stale' : 'failure', {
          trigger, startedAt, stale, errorCode: error.code || errorCode || 'syncFailed'
        });
      }
    }

    async hasSeenNotification(notificationId) {
      if (this.activeProfile && this.profileState) {
        const seen = await this.profileState.read(this.activeProfile.profileId, 'seenIds', []);
        return seen.includes(notificationId);
      }
      const result = this.normalizeStorageResult(
        await this.chrome.storage.local.get(['seenNotifications'])
      );
      const seenNotifications = result.seenNotifications || [];
      return seenNotifications.includes(notificationId);
    }

    async loadDesktopMappings() {
      if (!this.activeProfile || !this.profileState) return [];
      const mappings = await this.profileState.read(this.activeProfile.profileId, 'desktopMappings', []);
      const now = this.now();
      const retained = (Array.isArray(mappings) ? mappings : [])
        .filter(mapping => mapping?.expiresAt > now && mapping.profileId === this.activeProfile.profileId)
        .slice(-MAX_DESKTOP_MAPPINGS);
      if (retained.length !== mappings.length) await this.profileState.write(this.activeProfile.profileId, 'desktopMappings', retained);
      return retained;
    }

    async createDesktopMapping(notification, mappingType) {
      if (!this.activeProfile || !this.profileState) return null;
      const mappings = await this.loadDesktopMappings();
      const token = this.profileState.createBindingId().replace(/-/g, '');
      const desktopId = `${mappingType === 'single' ? 'issue' : 'batch'}:${token}`;
      const mapping = {
        desktopId,
        profileId: this.activeProfile.profileId,
        recordId: mappingType === 'single' ? notification.id : null,
        issueUrl: mappingType === 'single' ? notification.url : null,
        type: mappingType,
        createdAt: this.now(),
        expiresAt: this.now() + DESKTOP_MAPPING_TTL_MS
      };
      await this.profileState.write(this.activeProfile.profileId, 'desktopMappings', [...mappings, mapping].slice(-MAX_DESKTOP_MAPPINGS));
      return mapping;
    }

    async removeDesktopMapping(desktopId, profileId = this.activeProfile?.profileId) {
      if (!this.activeProfile || !this.profileState || profileId !== this.activeProfile.profileId) return false;
      const mappings = await this.loadDesktopMappings();
      await this.profileState.write(profileId, 'desktopMappings', mappings.filter(mapping => mapping.desktopId !== desktopId));
      return true;
    }

    async createDesktopSystemNotification(mapping, notificationOptions) {
      const desktopId = mapping?.desktopId || `legacy:${this.now()}:${Math.random().toString(16).slice(2)}`;
      try {
        await new Promise((resolve, reject) => {
          this.chrome.notifications.create(desktopId, notificationOptions, notificationId => {
            if (this.chrome.runtime.lastError) {
              reject(new Error(this.chrome.runtime.lastError.message || 'desktopNotificationCreateFailed'));
            } else {
              resolve(notificationId);
            }
          });
        });
        this.logger.debug('Notification created successfully:', desktopId);
        return true;
      } catch (error) {
        if (mapping) await this.removeDesktopMapping(mapping.desktopId, mapping.profileId);
        this.logger.error('Failed to create notification:', error);
        return false;
      }
    }

    async resolveDesktopMapping(desktopId) {
      if (!this.activeProfile) await this.restoreActiveProfile();
      if (!this.activeProfile || !this.profileState) return null;
      const mapping = (await this.loadDesktopMappings()).find(item => item.desktopId === desktopId);
      if (!mapping || mapping.profileId !== this.activeProfile.profileId || mapping.expiresAt <= this.now()) return null;
      if (mapping.type === 'single') {
        const record = (await this.loadNotificationHistory()).find(item => item.id === mapping.recordId);
        if (!record || record.profileId !== mapping.profileId || record.url !== mapping.issueUrl) return null;
        try {
          const base = new URL(this.settings.redmineUrl);
          const target = new URL(mapping.issueUrl);
          const normalizedBasePath = base.pathname.replace(/\/$/, '');
          if (base.origin !== target.origin || !target.pathname.startsWith(`${normalizedBasePath}/issues/`)) return null;
        } catch {
          return null;
        }
      }
      return mapping;
    }

    async handleDesktopClick(desktopId) {
      const mapping = await this.resolveDesktopMapping(desktopId);
      if (!mapping) {
        if (!desktopId.startsWith('issue:')) this.chrome.action.openPopup();
        return false;
      }
      if (mapping.type === 'batch') this.chrome.action.openPopup();
      else await this.chrome.tabs.create({ url: mapping.issueUrl });
      return true;
    }

    async handleDesktopButton(desktopId, buttonIndex) {
      const mapping = await this.resolveDesktopMapping(desktopId);
      if (!mapping || mapping.type !== 'single') return false;
      if (buttonIndex === 0) {
        await this.chrome.tabs.create({ url: mapping.issueUrl });
        return true;
      }
      if (buttonIndex === 1) {
        try {
          await this.markAsRead(mapping.recordId, mapping.profileId);
          await new Promise(resolve => this.chrome.notifications.clear(desktopId, () => resolve()));
          await this.removeDesktopMapping(desktopId);
          return true;
        } catch (_error) {
          const health = await this.profileState.read(this.activeProfile.profileId, 'syncHealth', {});
          await this.profileState.write(this.activeProfile.profileId, 'syncHealth', {
            ...health, lastErrorCode: 'desktopMarkReadFailed', lastErrorAt: this.now()
          });
          return false;
        }
      }
      return false;
    }

    async showDesktopNotification(notifications, type = 'new') {
      this.logger.debug(`Attempting to show ${type} notification for ${notifications.length} items`);

      if (notifications.length === 1) {
        const notification = notifications[0];
        const isUpdate = type === 'updated';
        const mapping = await this.createDesktopMapping(notification, 'single');

        const notificationOptions = {
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: isUpdate ? this.translate('issueUpdatedTitle') : this.translate('newIssueTitle'),
          message: notification.title,
          contextMessage: `${notification.project}${isUpdate ? ' (' + this.translate('updated') + ')' : ''}`,
          silent: !this.settings.enableSound,
          buttons: [
            { title: this.translate('openIssue') },
            { title: this.translate('markAsRead') }
          ]
        };

        await this.createDesktopSystemNotification(mapping, notificationOptions);
      } else {
        const isUpdate = type === 'updated';
        const count = notifications.length;
        const mapping = await this.createDesktopMapping(notifications[0], 'batch');
        const notificationOptions = {
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: isUpdate ? this.translate('issuesUpdatedTitle') : this.translate('newIssuesTitle'),
          message: this.translate(isUpdate ? 'multipleIssuesUpdatedMessage' : 'multipleNewIssuesMessage', [count]),
          contextMessage: this.translate('clickToViewAll'),
          silent: !this.settings.enableSound
        };

        // ...已移除除錯用 log...

        await this.createDesktopSystemNotification(mapping, notificationOptions);
      }
    }

    updateBadge(count) {
      const text = count > 0 ? count.toString() : '';
      this.chrome.action.setBadgeText({ text });
      this.chrome.action.setBadgeBackgroundColor({ color: '#667eea' });
    }

    async markAsRead(notificationId, profileId) {
      await this.requireProfile(profileId);
      const notification = this.notifications.get(notificationId);
      if (notification && notification.profileId !== this.activeProfile?.profileId) throw new Error('profileMismatch');
      if (notification) {
        notification.read = true;
      }

      const readNotifications = this.profileState
        ? await this.profileState.read(this.activeProfile.profileId, 'readIds', [])
        : this.normalizeStorageResult(await this.chrome.storage.sync.get(['readNotifications'])).readNotifications || [];

      if (!readNotifications.includes(notificationId)) {
        readNotifications.push(notificationId);
        this.trimReadNotifications(readNotifications);
        if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'readIds', readNotifications);
        else await this.chrome.storage.sync.set({ readNotifications });
      }

      const history = await this.loadNotificationHistory();
      const updatedHistory = history.map(record => (
        record.id === notificationId ? { ...record, read: true } : record
      ));
      await this.saveNotificationHistory(updatedHistory);

      // Update badge
      const unreadCount = updatedHistory.filter(n => !n.read).length;
      this.updateBadge(unreadCount);
    }

    async markAllAsRead() {
      await this.requireProfile();
      const history = await this.loadNotificationHistory();
      const unreadNotifications = Array.from(this.notifications.values()).filter(n => !n.read);
      const readNotifications = this.profileState
        ? await this.profileState.read(this.activeProfile.profileId, 'readIds', [])
        : this.normalizeStorageResult(await this.chrome.storage.sync.get(['readNotifications'])).readNotifications || [];

      for (const notification of unreadNotifications) {
        notification.read = true;
        if (!readNotifications.includes(notification.id)) {
          readNotifications.push(notification.id);
          this.trimReadNotifications(readNotifications);
        }
      }

      const updatedHistory = history.map(record => {
        if (!readNotifications.includes(record.id)) {
          readNotifications.push(record.id);
          this.trimReadNotifications(readNotifications);
        }

        return { ...record, read: true };
      });

      if (this.profileState) await this.profileState.write(this.activeProfile.profileId, 'readIds', readNotifications);
      else await this.chrome.storage.sync.set({ readNotifications });
      await this.saveNotificationHistory(updatedHistory);
      this.updateBadge(0);
    }

    async clearNotificationHistory() {
      await this.requireProfile();
      this.notifications.clear();
      if (this.profileState) {
        await Promise.all([
          this.profileState.write(this.activeProfile.profileId, 'readIds', []),
          this.profileState.write(this.activeProfile.profileId, 'history', []),
          this.profileState.write(this.activeProfile.profileId, 'seenIds', []),
          this.profileState.write(this.activeProfile.profileId, 'issueStates', {})
        ]);
      } else {
        await this.chrome.storage.sync.set({ readNotifications: [] });
        await this.chrome.storage.local.set({ [this.notificationHistoryStorageKey]: [], seenNotifications: [], issueStates: {} });
      }
      this.updateBadge(0);

      this.chrome.notifications.getAll((notifications) => {
        Object.keys(notifications).forEach(notificationId => {
          this.chrome.notifications.clear(notificationId);
        });
      });
    }

    trimReadNotifications(readNotifications) {
      if (readNotifications.length > MAX_READ_NOTIFICATIONS) {
        readNotifications.splice(0, readNotifications.length - MAX_READ_NOTIFICATIONS);
      }
    }

    async forceRefreshNotifications() {
      return this.requestSync('forceRefresh', { force: true });
    }

    async getNotifications() {
      await this.ensureSettingsLoaded();
      if (!this.activeProfile) await this.restoreActiveProfile();
      if (!this.activeProfile && this.settings.redmineUrl && this.settings.apiKey) await this.resolveActiveProfile();
      const history = await this.loadNotificationHistory();
      if (history.length > 0) {
        return history;
      }

      return Array.from(this.notifications.values()).sort((a, b) => b.updatedOn - a.updatedOn);
    }

    async getCachedNotifications() {
      await this.ensureSettingsLoaded();
      if (!this.activeProfile) await this.restoreActiveProfile();
      if (!this.activeProfile) return { notifications: [], syncHealth: null };
      const [notifications, syncHealth] = await Promise.all([
        this.loadNotificationHistory(),
        this.profileState.read(this.activeProfile.profileId, 'syncHealth', null)
      ]);
      return { notifications, syncHealth };
    }
  }

  return { NotificationService };
});
