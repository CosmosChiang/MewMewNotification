class OptionsManager {
  constructor() {
    const SafeLoggerClass = globalThis.SafeLogger;
    this.logger = SafeLoggerClass ? new SafeLoggerClass() : {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    };
    const I18nManagerClass = globalThis.I18nManager;
    this.i18n = I18nManagerClass ? new I18nManagerClass({
      storage: globalThis.chrome?.storage?.sync,
      fetch: globalThis.fetch,
      localeUrlResolver: language => `_locales/${language}/messages.json`,
      documentRoot: globalThis.document?.documentElement,
      logger: this.logger
    }) : null;
    this.currentLanguage = 'en';
    this.translations = {};
    this.settings = {};
    this.privacyConsent = null;
    const DiagnosticEventStoreClass = globalThis.DiagnosticEventStore;
    this.diagnosticStore = DiagnosticEventStoreClass
      ? new DiagnosticEventStoreClass({ storageArea: globalThis.chrome?.storage?.local })
      : null;
    this.diagnosticsEnabled = false;
    this.availableNotificationProjects = [];
    this.statusHideTimers = new Map();
    this.init();
  }

  async init() {
    await this.loadLanguage();
    await this.loadSettings();
    await this.loadPrivacyConsent();
    await this.loadDiagnosticsState();
    this.setupEventListeners();
    
    this.updateUI();
    await this.syncConfiguredPermissionStatus();
    await this.loadNotificationProjects();
    this.populateForm();
  }

  async loadLanguage(languageOverride) {
    if (!this.i18n) {
      this.translations = {};
      return this.translations;
    }

    this.translations = await this.i18n.loadLanguage(languageOverride);
    this.currentLanguage = this.i18n.getCurrentLanguage();
    return this.translations;
  }

  async loadSettings() {
    const configManagerClass = this.getConfigManagerClass();
    if (configManagerClass?.migrateLegacyApiKey) {
      await configManagerClass.migrateLegacyApiKey();
    }

    const [syncResult, localResult] = await Promise.all([
      chrome.storage.sync.get(
        configManagerClass?.getSyncSettingKeys
          ? configManagerClass.getSyncSettingKeys()
          : [
              'redmineUrl',
              'checkInterval',
              'enableNotifications',
              'enableSound',
              'maxNotifications',
              'language',
              'onlyMyProjects',
              'includeWatchedIssues'
            ]
      ),
      chrome.storage.local.get(['apiKey'])
    ]);

    this.settings = configManagerClass?.normalizeRuntimeSettings
      ? configManagerClass.normalizeRuntimeSettings(syncResult, localResult)
      : {
          redmineUrl: '',
          apiKey: '',
          checkInterval: 15,
          enableNotifications: true,
          enableSound: true,
          maxNotifications: 50,
          language: 'en',
          onlyMyProjects: true,
          includeWatchedIssues: false
        };
  }

  translate(key, substitutions = []) {
    return this.i18n ? this.i18n.translate(key, substitutions) : key;
  }

  getConfigManagerClass() {
    return globalThis.ConfigManager || undefined;
  }

  getPrivacyConsentApi() {
    return globalThis.PrivacyConsent || {
      PRIVACY_NOTICE_VERSION: 1,
      PRIVACY_CONSENT_STORAGE_KEY: 'privacyNoticeConsentV1',
      isCurrentPrivacyConsent: consent => Boolean(
        consent
        && consent.version === 1
        && Number.isFinite(consent.acceptedAt)
        && consent.acceptedAt > 0
      ),
      readPrivacyConsent: async storageArea => {
        const result = await storageArea.get(['privacyNoticeConsentV1']);
        return result?.privacyNoticeConsentV1 || null;
      },
      writePrivacyConsent: async (storageArea, now = Date.now()) => {
        const consent = { version: 1, acceptedAt: now };
        await storageArea.set({ privacyNoticeConsentV1: consent });
        return consent;
      }
    };
  }

  async loadPrivacyConsent() {
    const privacyApi = this.getPrivacyConsentApi();
    this.privacyConsent = await privacyApi.readPrivacyConsent(chrome.storage.local);
    this.updatePrivacyConsentControl();
    return this.privacyConsent;
  }

  async loadDiagnosticsState() {
    if (this.diagnosticStore) {
      await this.diagnosticStore.initialize();
      this.diagnosticsEnabled = this.diagnosticStore.isEnabled();
    } else {
      const stored = await chrome.storage.local.get(['diagnosticsEnabledV1']);
      this.diagnosticsEnabled = stored?.diagnosticsEnabledV1 === true;
    }
    this.updateDiagnosticsControl();
    return this.diagnosticsEnabled;
  }

  updateDiagnosticsControl() {
    const checkbox = document.getElementById('diagnosticsEnabled');
    if (checkbox) {
      checkbox.checked = this.diagnosticsEnabled === true;
    }
  }

  async setDiagnosticsEnabled(enabled) {
    try {
      if (this.diagnosticStore) {
        await this.diagnosticStore.setEnabled(enabled);
      } else {
        await chrome.storage.local.set({ diagnosticsEnabledV1: enabled === true });
        if (!enabled) {
          await chrome.storage.local.remove(['diagnosticEventsV1']);
        }
      }
      this.diagnosticsEnabled = enabled === true;
      this.updateDiagnosticsControl();
      this.showStatus(
        'diagnosticsStatus',
        'success',
        this.translate(this.diagnosticsEnabled ? 'diagnosticsEnabledSuccess' : 'diagnosticsDisabledSuccess')
      );
      return true;
    } catch {
      this.updateDiagnosticsControl();
      this.showStatus('diagnosticsStatus', 'error', this.translate('diagnosticsUpdateError'));
      return false;
    }
  }

  async clearDiagnostics() {
    try {
      if (this.diagnosticStore) {
        await this.diagnosticStore.clearEvents();
      } else {
        await chrome.storage.local.remove(['diagnosticEventsV1']);
      }
      this.showStatus('diagnosticsStatus', 'success', this.translate('diagnosticsClearedSuccess'));
      return true;
    } catch {
      this.showStatus('diagnosticsStatus', 'error', this.translate('diagnosticsClearError'));
      return false;
    }
  }

  createDiagnosticsFilename(date = new Date()) {
    const compact = date.toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .slice(0, 15);
    return `mewmew-diagnostics-${compact}.json`;
  }

  async exportDiagnostics() {
    let objectUrl;
    let anchor;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getDiagnostics' });
      if (!response?.success || !response.diagnostics) {
        throw new Error(response?.error || 'diagnosticsUnsafe');
      }
      const validator = globalThis.validateDiagnosticSnapshot;
      if (typeof validator !== 'function' || validator(response.diagnostics) !== true) {
        throw new Error('diagnosticsUnsafe');
      }
      const content = JSON.stringify(response.diagnostics, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      objectUrl = URL.createObjectURL(blob);
      anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = this.createDiagnosticsFilename(new Date(response.diagnostics.generatedAt));
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      this.showStatus('diagnosticsStatus', 'success', this.translate('diagnosticsExportSuccess'));
      return true;
    } catch {
      this.showStatus('diagnosticsStatus', 'error', this.translate('diagnosticsExportError'));
      return false;
    } finally {
      anchor?.remove?.();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  updatePrivacyConsentControl() {
    const checkbox = document.getElementById('privacyNoticeAcknowledged');
    if (!checkbox) {
      return;
    }

    const privacyApi = this.getPrivacyConsentApi();
    const hasCurrentConsent = privacyApi.isCurrentPrivacyConsent(this.privacyConsent);
    checkbox.checked = hasCurrentConsent;
    checkbox.disabled = hasCurrentConsent;
  }

  async ensurePrivacyConsent(statusElementId) {
    const privacyApi = this.getPrivacyConsentApi();
    if (privacyApi.isCurrentPrivacyConsent(this.privacyConsent)) {
      return true;
    }

    const checkbox = document.getElementById('privacyNoticeAcknowledged');
    if (!checkbox?.checked) {
      this.showStatus(statusElementId, 'error', this.translate('privacyConsentRequired'));
      checkbox?.focus?.();
      return false;
    }

    try {
      this.privacyConsent = await privacyApi.writePrivacyConsent(chrome.storage.local);
      this.updatePrivacyConsentControl();
      return true;
    } catch {
      this.showStatus(statusElementId, 'error', this.translate('privacyConsentSaveError'));
      return false;
    }
  }

  resolveErrorMessage(message) {
    const translated = this.translate(message);
    if (translated !== message) {
      return translated;
    }

    return this.sanitizeErrorMessage(message);
  }

  buildStatusMessage(successKey, warningMessage) {
    if (!warningMessage) {
      return this.translate(successKey);
    }

    return `${this.translate(successKey)} ${warningMessage}`;
  }

  getValidatedUrlDetails(url) {
    const configManagerClass = this.getConfigManagerClass();
    if (configManagerClass?.validateRedmineUrl) {
      return configManagerClass.validateRedmineUrl(url);
    }

    if (!url || url.trim() === '') {
      return {
        valid: false,
        messageKey: 'urlRequired'
      };
    }

    try {
      const urlObj = new URL(url.trim());
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return {
          valid: false,
          messageKey: 'urlMustBeHttpOrHttps'
        };
      }

      const normalizedUrl = urlObj.toString().replace(/\/$/, '');
      return {
        valid: true,
        normalizedUrl,
        originPattern: `${urlObj.protocol}//${urlObj.hostname}/*`,
        requiresWarning: urlObj.protocol === 'http:',
        messageKey: urlObj.protocol === 'http:' ? 'insecureDevelopmentUrlWarning' : undefined
      };
    } catch {
      return {
        valid: false,
        messageKey: 'invalidUrlFormat'
      };
    }
  }

  // Validation methods
  validateUrl(url) {
    const validation = this.getValidatedUrlDetails(url);
    if (!validation.valid) {
      return {
        valid: false,
        message: this.translate(validation.messageKey)
      };
    }

    return {
      valid: true,
      normalizedUrl: validation.normalizedUrl,
      warningMessage: validation.requiresWarning ? this.translate(validation.messageKey) : undefined,
      originPattern: validation.originPattern
    };
  }

  validateApiKey(apiKey) {
    if (!apiKey || apiKey.trim() === '') {
      return { valid: false, message: this.translate('apiKeyRequired') };
    }
    
    const trimmedKey = apiKey.trim();
    
    // More robust API key validation
    if (trimmedKey.length < 10) {
      return { valid: false, message: this.translate('apiKeyTooShort') };
    }
    
    if (trimmedKey.length > 100) {
      return { valid: false, message: this.translate('apiKeyTooLong') };
    }
    
    // Allow alphanumeric and common special characters used in API keys
    if (!/^[a-zA-Z0-9\-_]+$/.test(trimmedKey)) {
      return { valid: false, message: this.translate('apiKeyInvalidFormat') };
    }
    
    return { valid: true };
  }

  async ensureOriginPermission(redmineUrl) {
    const validation = this.getValidatedUrlDetails(redmineUrl);

    if (!validation.valid) {
      return {
        granted: false,
        message: this.translate(validation.messageKey)
      };
    }

    const warningMessage = validation.requiresWarning
      ? this.translate(validation.messageKey)
      : undefined;

    if (!chrome.permissions?.contains || !chrome.permissions?.request) {
      return {
        granted: true,
        warningMessage
      };
    }

    const permissionRequest = {
      origins: [validation.originPattern]
    };

    const alreadyGranted = await chrome.permissions.contains(permissionRequest);
    if (alreadyGranted) {
      return {
        granted: true,
        warningMessage
      };
    }

    const granted = await chrome.permissions.request(permissionRequest);
    if (!granted) {
      return {
        granted: false,
        message: this.translate('hostPermissionDenied')
      };
    }

    return {
      granted: true,
      warningMessage
    };
  }

  async removeOriginPermission(redmineUrl) {
    if (!redmineUrl || !chrome.permissions?.contains || !chrome.permissions?.remove) {
      return false;
    }

    const configManagerClass = this.getConfigManagerClass();
    const validation = configManagerClass?.validateRedmineUrl
      ? configManagerClass.validateRedmineUrl(redmineUrl)
      : undefined;

    if (!validation?.valid) {
      return false;
    }

    const permissionRequest = {
      origins: [validation.originPattern]
    };

    const alreadyGranted = await chrome.permissions.contains(permissionRequest);
    if (!alreadyGranted) {
      return false;
    }

    return chrome.permissions.remove(permissionRequest);
  }

  shouldRemoveOriginPermission(previousUrl, nextUrl) {
    if (!previousUrl || !nextUrl) {
      return false;
    }

    const previousValidation = this.getValidatedUrlDetails(previousUrl);
    const nextValidation = this.getValidatedUrlDetails(nextUrl);

    if (!previousValidation.valid || !nextValidation.valid) {
      return false;
    }

    return previousValidation.originPattern !== nextValidation.originPattern;
  }

  async syncConfiguredPermissionStatus() {
    const statusElement = document.getElementById('redmineStatus');
    if (!statusElement) {
      return;
    }

    const missingPermissionMessage = this.translate('hostPermissionRequired');
    this.clearStatusTimer('redmineStatus');

    if (!this.settings.redmineUrl || !this.settings.apiKey || !chrome.permissions?.contains) {
      if (statusElement.textContent === missingPermissionMessage) {
        statusElement.style.display = 'none';
      }
      return;
    }

    const configManagerClass = this.getConfigManagerClass();
    const validation = configManagerClass?.validateRedmineUrl
      ? configManagerClass.validateRedmineUrl(this.settings.redmineUrl)
      : undefined;

    if (!validation?.valid || !validation.originPattern) {
      if (statusElement.textContent === missingPermissionMessage) {
        statusElement.style.display = 'none';
      }
      return;
    }

    const hasPermission = await chrome.permissions.contains({
      origins: [validation.originPattern]
    });

    if (!hasPermission) {
      this.showPersistentStatus('redmineStatus', 'info', missingPermissionMessage);
      return;
    }

    if (statusElement.textContent === missingPermissionMessage) {
      statusElement.style.display = 'none';
    }
  }



  validateNumber(value, min, max, fieldName) {
    const num = parseInt(value);
    
    if (isNaN(num)) {
      return { valid: false, message: this.translate('mustBeNumber', [fieldName]) };
    }
    
    if (num < min || num > max) {
      return { valid: false, message: this.translate('numberOutOfRange', [fieldName, min, max]) };
    }
    
    return { valid: true, value: num };
  }

  getSelectedNotificationProjectRuleMode() {
    if (document.getElementById('notificationProjectRuleModeInclude')?.checked) {
      return 'include';
    }

    if (document.getElementById('notificationProjectRuleModeExclude')?.checked) {
      return 'exclude';
    }

    return 'all';
  }

  setSelectedNotificationProjectRuleMode(mode) {
    const normalizedMode = ['include', 'exclude'].includes(mode) ? mode : 'all';
    const allRadio = document.getElementById('notificationProjectRuleModeAll');
    const includeRadio = document.getElementById('notificationProjectRuleModeInclude');
    const excludeRadio = document.getElementById('notificationProjectRuleModeExclude');

    if (allRadio) {
      allRadio.checked = normalizedMode === 'all';
    }

    if (includeRadio) {
      includeRadio.checked = normalizedMode === 'include';
    }

    if (excludeRadio) {
      excludeRadio.checked = normalizedMode === 'exclude';
    }
  }

  getSelectedNotificationProjectIds() {
    const projectSelection = document.getElementById('notificationProjectSelection');
    if (!projectSelection?.querySelectorAll) {
      return [];
    }

    return Array.from(projectSelection.querySelectorAll('.project-checkbox-input'))
      .filter(checkbox => checkbox.checked === true)
      .map(checkbox => Number.parseInt(checkbox.value, 10))
      .filter(value => Number.isSafeInteger(value) && value > 0);
  }

  renderNotificationProjectOptions() {
    const projectSelection = document.getElementById('notificationProjectSelection');
    if (!projectSelection) {
      return;
    }

    const projectRules = this.settings.notificationProjectRules || { mode: 'all' };
    const selectedProjectIds = new Set(
      (
        projectRules.mode === 'include'
          ? projectRules.includeProjectIds
          : projectRules.mode === 'exclude'
            ? projectRules.excludeProjectIds
            : []
      ).map(value => String(value))
    );

    projectSelection.innerHTML = '';
    if (Array.isArray(projectSelection.children)) {
      projectSelection.children.length = 0;
    }

    this.availableNotificationProjects.forEach(project => {
      const checkboxLabel = document.createElement('label');
      checkboxLabel.className = 'checkbox-label project-checkbox-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'project-checkbox-input';
      checkbox.value = String(project.id);
      checkbox.dataset.projectId = String(project.id);
      checkbox.checked = selectedProjectIds.has(String(project.id));

      const checkboxText = document.createElement('span');
      checkboxText.textContent = project.identifier ? `${project.name} (${project.identifier})` : project.name;

      checkboxLabel.appendChild(checkbox);
      checkboxLabel.appendChild(checkboxText);
      projectSelection.appendChild(checkboxLabel);
    });

    this.updateNotificationFocusControlState();
  }

  updateNotificationFocusControlState() {
    const projectSelection = document.getElementById('notificationProjectSelection');
    if (projectSelection) {
      const shouldDisableProjectSelection = this.getSelectedNotificationProjectRuleMode() === 'all'
        || this.availableNotificationProjects.length === 0;
      if (shouldDisableProjectSelection) {
        projectSelection.classList.add('disabled');
      } else {
        projectSelection.classList.remove('disabled');
      }
      projectSelection.setAttribute('aria-disabled', shouldDisableProjectSelection ? 'true' : 'false');

      Array.from(projectSelection.querySelectorAll('.project-checkbox-input')).forEach(checkbox => {
        checkbox.disabled = shouldDisableProjectSelection;
      });
    }

    const quietHoursEnabled = document.getElementById('notificationQuietHoursEnabled')?.checked === true;
    const quietHoursStart = document.getElementById('notificationQuietHoursStart');
    const quietHoursEnd = document.getElementById('notificationQuietHoursEnd');

    if (quietHoursStart) {
      quietHoursStart.disabled = !quietHoursEnabled;
    }

    if (quietHoursEnd) {
      quietHoursEnd.disabled = !quietHoursEnabled;
    }

    const bundlingEnabled = document.getElementById('notificationBundlingEnabled')?.checked === true;
    const bundlingWindow = document.getElementById('notificationBundlingWindow');
    if (bundlingWindow) {
      bundlingWindow.disabled = !bundlingEnabled;
    }
  }

  clearStatusMessage(elementId) {
    const element = document.getElementById(elementId);
    if (!element) {
      return;
    }

    this.clearStatusTimer(elementId);
    element.className = 'status-message';
    element.textContent = '';
    element.style.display = 'none';
  }

  async loadNotificationProjects({ forceRefresh = false } = {}) {
    const refreshButton = document.getElementById('refreshNotificationProjectsBtn');
    const statusElementId = 'notificationProjectStatus';

    if (!this.settings.redmineUrl || !this.settings.apiKey || !chrome.runtime?.sendMessage) {
      this.availableNotificationProjects = [];
      this.renderNotificationProjectOptions();
      this.showPersistentStatus(statusElementId, 'info', this.translate('notificationProjectsUnavailable'));
      return [];
    }

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = this.translate('notificationProjectsLoading');
    }

    try {
      this.showPersistentStatus(statusElementId, 'info', this.translate('notificationProjectsLoading'));
      const response = await chrome.runtime.sendMessage({
        action: 'getNotificationProjects',
        forceRefresh
      });

      if (!response?.success) {
        throw new Error(response?.error || 'loadError');
      }

      this.availableNotificationProjects = Array.isArray(response.projects)
        ? [...response.projects].sort((left, right) => {
          const leftName = String(left?.name || '');
          const rightName = String(right?.name || '');
          const nameComparison = leftName.localeCompare(rightName, undefined, { sensitivity: 'base' });
          if (nameComparison !== 0) {
            return nameComparison;
          }

          return Number(left?.id || 0) - Number(right?.id || 0);
        })
        : [];
      this.renderNotificationProjectOptions();

      if (this.availableNotificationProjects.length === 0) {
        this.showPersistentStatus(statusElementId, 'info', this.translate('notificationProjectsEmpty'));
      } else {
        this.clearStatusMessage(statusElementId);
      }

      return this.availableNotificationProjects;
    } catch (error) {
      this.availableNotificationProjects = [];
      this.renderNotificationProjectOptions();
      this.showPersistentStatus(statusElementId, 'error', this.resolveErrorMessage(error.message || String(error)));
      return [];
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = this.translate('refreshProjectList');
      }
    }
  }

  buildNotificationFocusSettings() {
    const configManagerClass = this.getConfigManagerClass();
    const projectRuleMode = this.getSelectedNotificationProjectRuleMode();
    const selectedProjectIds = this.getSelectedNotificationProjectIds();
    const rawProjectRules = projectRuleMode === 'include'
      ? { mode: 'include', includeProjectIds: selectedProjectIds }
      : projectRuleMode === 'exclude'
        ? { mode: 'exclude', excludeProjectIds: selectedProjectIds }
        : { mode: 'all' };
    const rawChangeFilters = {
      status: document.getElementById('notificationChangeFilterStatus')?.checked !== false,
      assignee: document.getElementById('notificationChangeFilterAssignee')?.checked !== false,
      priority: document.getElementById('notificationChangeFilterPriority')?.checked !== false,
      comment: document.getElementById('notificationChangeFilterComment')?.checked !== false,
      generic: document.getElementById('notificationChangeFilterGeneric')?.checked !== false
    };
    const rawQuietHours = {
      enabled: document.getElementById('notificationQuietHoursEnabled')?.checked === true,
      start: document.getElementById('notificationQuietHoursStart')?.value || '',
      end: document.getElementById('notificationQuietHoursEnd')?.value || ''
    };
    const rawBundling = {
      enabled: document.getElementById('notificationBundlingEnabled')?.checked === true,
      windowMinutes: Number.parseInt(document.getElementById('notificationBundlingWindow')?.value, 10)
    };

    return {
      notificationProjectRules: configManagerClass?.normalizeNotificationProjectRules
        ? configManagerClass.normalizeNotificationProjectRules(rawProjectRules)
        : rawProjectRules,
      notificationChangeFilters: configManagerClass?.normalizeNotificationChangeFilters
        ? configManagerClass.normalizeNotificationChangeFilters(rawChangeFilters)
        : rawChangeFilters,
      notificationQuietHours: configManagerClass?.normalizeNotificationQuietHours
        ? configManagerClass.normalizeNotificationQuietHours(rawQuietHours)
        : rawQuietHours,
      notificationBundling: configManagerClass?.normalizeNotificationBundling
        ? configManagerClass.normalizeNotificationBundling(rawBundling)
        : rawBundling
    };
  }

  updateUI() {
    // Update page title
    document.title = this.translate('optionsTitle');
    
    // Update all translatable elements
    const elements = {
      'settingsTitle': 'optionsTitle',
      'redmineTab': 'redmineSettings',
      'notificationsTab': 'notificationSettings',
      'languageTab': 'languageSettings',
      'aboutTab': 'about',
      'redmineSettingsTitle': 'redmineSettings',
      'redmineUrlLabel': 'redmineUrl',
      'redmineUrlHelp': 'redmineUrlHelp',
      'apiKeyLabel': 'apiKey',
      'apiKeyHelp': 'apiKeyHelp',
      'testConnectionBtn': 'testConnection',
      'privacyNoticeTitle': 'privacyNoticeTitle',
      'privacyNoticeSummary': 'privacyNoticeSummary',
      'privacyPolicyLink': 'privacyPolicyLink',
      'privacyNoticeAcknowledgedLabel': 'privacyNoticeAcknowledgedLabel',
      'notificationSettingsTitle': 'notificationSettings',
      'checkIntervalLabel': 'checkInterval',
      'enableNotificationsLabel': 'enableDesktopNotifications',
      'enableSoundLabel': 'enableNotificationSound',
      'onlyMyProjectsLabel': 'onlyMyProjects',
      'includeWatchedIssuesLabel': 'includeWatchedIssues',
      'maxNotificationsLabel': 'maxNotifications',
      'notificationFocusTitle': 'notificationFocusTitle',
      'notificationFocusHelp': 'notificationFocusHelp',
      'notificationProjectRulesLabel': 'notificationProjectRulesLabel',
      'notificationProjectRulesHelp': 'notificationProjectRulesHelp',
      'notificationProjectRuleModeAllLabel': 'notificationProjectRuleAll',
      'notificationProjectRuleModeIncludeLabel': 'notificationProjectRuleInclude',
      'notificationProjectRuleModeExcludeLabel': 'notificationProjectRuleExclude',
      'refreshNotificationProjectsBtn': 'refreshProjectList',
      'notificationChangeFiltersTitle': 'notificationChangeFiltersTitle',
      'notificationChangeFiltersHelp': 'notificationChangeFiltersHelp',
      'notificationChangeFilterStatusLabel': 'notificationChangeFilterStatus',
      'notificationChangeFilterAssigneeLabel': 'notificationChangeFilterAssignee',
      'notificationChangeFilterPriorityLabel': 'notificationChangeFilterPriority',
      'notificationChangeFilterCommentLabel': 'notificationChangeFilterComment',
      'notificationChangeFilterGenericLabel': 'notificationChangeFilterGeneric',
      'notificationQuietHoursTitle': 'notificationQuietHoursTitle',
      'notificationQuietHoursHelp': 'notificationQuietHoursHelp',
      'notificationQuietHoursEnabledLabel': 'notificationQuietHoursEnabled',
      'notificationQuietHoursStartLabel': 'notificationQuietHoursStart',
      'notificationQuietHoursEndLabel': 'notificationQuietHoursEnd',
      'notificationBundlingTitle': 'notificationBundlingTitle',
      'notificationBundlingHelp': 'notificationBundlingHelp',
      'notificationBundlingEnabledLabel': 'notificationBundlingEnabled',
      'notificationBundlingWindowLabel': 'notificationBundlingWindow',
      'languageSettingsTitle': 'languageSettings',
      'languageSelectLabel': 'selectLanguage',
      'aboutTitle': 'about',
      'aboutAppName': 'appName',
      'aboutDescription': 'appDescription',
      'featuresTitle': 'features',
      'feature1': 'feature1',
      'feature2': 'feature2',
      'feature3': 'feature3',
      'feature4': 'feature4',
      'feature5': 'feature5',
      'feature6': 'feature6',
      'feature7': 'feature7',
      'feature8': 'feature8',
      'feature9': 'feature9',
      'feature10': 'feature10',
      'feature11': 'feature11',
      'supportTitle': 'support',
      'supportText': 'supportText',
      'privacyTitle': 'privacyTitle',
      'aboutPrivacyPolicyLink': 'privacyPolicyLink',
      'diagnosticsTitle': 'diagnosticsTitle',
      'diagnosticsDescription': 'diagnosticsDescription',
      'diagnosticsEnabledLabel': 'diagnosticsEnabledLabel',
      'exportDiagnosticsBtn': 'exportDiagnostics',
      'clearDiagnosticsBtn': 'clearDiagnostics',
      'resetBtn': 'reset',
      'saveRedmineBtn': 'saveRedmineSettings',
      'saveNotificationsBtn': 'saveNotificationSettings',
      'saveLanguageBtn': 'saveLanguageSettings'
    };

    Object.entries(elements).forEach(([elementId, translationKey]) => {
      const element = document.getElementById(elementId);
      if (element) {
        element.textContent = this.translate(translationKey);
      }
    });

    this.updateVersionDisplay();

    // Update input placeholders
    const placeholders = {
      'redmineUrl': 'redmineUrlPlaceholder',
      'apiKey': 'apiKeyPlaceholder'
    };

    Object.entries(placeholders).forEach(([elementId, translationKey]) => {
      const element = document.getElementById(elementId);
      if (element) {
        element.placeholder = this.translate(translationKey);
      }
    });

    // Update select options
    this.updateSelectOptions();
  }

  updateVersionDisplay() {
    const element = document.getElementById('aboutVersion');
    if (!element) {
      return;
    }

    const version = globalThis.chrome?.runtime?.getManifest?.().version || '';
    const label = this.translate('versionLabel');
    element.textContent = version ? `${label}: ${version}` : label;
  }

  updateSelectOptions() {
    // Update check interval options with dynamic translation
    const checkIntervalSelect = document.getElementById('checkInterval');
    if (checkIntervalSelect) {
      const intervalMappings = [
        { value: '1', translationKey: 'minute1' },
        { value: '5', translationKey: 'minutes5' },
        { value: '10', translationKey: 'minutes10' },
        { value: '15', translationKey: 'minutes15' },
        { value: '30', translationKey: 'minutes30' },
        { value: '60', translationKey: 'hour1' }
      ];

      intervalMappings.forEach((mapping, index) => {
        const option = checkIntervalSelect.options[index];
        if (option && option.value === mapping.value) {
          option.text = this.translate(mapping.translationKey);
        }
      });
    }

    // Update max notifications options (numbers only, no translation needed)
    const maxNotificationsSelect = document.getElementById('maxNotifications');
    if (maxNotificationsSelect) {
      // Options are just numbers, no need to translate
    }

    // Update language options dynamically
    this.updateLanguageOptions();

    const bundlingWindowSelect = document.getElementById('notificationBundlingWindow');
    if (bundlingWindowSelect) {
      const bundlingMappings = [
        { value: '5', translationKey: 'minutes5' },
        { value: '10', translationKey: 'minutes10' },
        { value: '15', translationKey: 'minutes15' },
        { value: '30', translationKey: 'minutes30' }
      ];

      bundlingMappings.forEach((mapping, index) => {
        const option = bundlingWindowSelect.options[index];
        if (option && option.value === mapping.value) {
          option.text = this.translate(mapping.translationKey);
        }
      });
    }
  }

  updateLanguageOptions() {
    const languageSelect = document.getElementById('languageSelect');
    if (!languageSelect) return;

    // Get all available languages by looking at the options in the select
    const availableLanguages = Array.from(languageSelect.options).map(option => ({
      code: option.value,
      originalText: option.text
    }));

    // Update each language option with translated name
    availableLanguages.forEach((lang, index) => {
      const option = languageSelect.options[index];
      if (option && option.value === lang.code) {
        const translationKey = `language_${lang.code}`;
        const translatedName = this.translate(translationKey);
        
        // If translation exists, use it; otherwise keep the original text
        option.text = translatedName !== translationKey ? translatedName : lang.originalText;
      }
    });
  }

  // Method to get supported languages dynamically
  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
      button.addEventListener('keydown', event => this.handleTabKeydown(event));
    });

    // Test connection button
    document.getElementById('testConnectionBtn').addEventListener('click', () => {
      this.testConnection();
    });

    // Individual save buttons
    document.getElementById('saveRedmineBtn').addEventListener('click', () => {
      this.saveRedmineSettings();
    });

    document.getElementById('saveNotificationsBtn').addEventListener('click', () => {
      this.saveNotificationSettings();
    });

    document.getElementById('saveLanguageBtn').addEventListener('click', () => {
      this.saveLanguageSettings();
    });

    document.getElementById('refreshNotificationProjectsBtn').addEventListener('click', () => {
      this.loadNotificationProjects({ forceRefresh: true });
    });

    const diagnosticsEnabled = document.getElementById('diagnosticsEnabled');
    diagnosticsEnabled?.addEventListener('change', event => {
      this.setDiagnosticsEnabled(event.target.checked);
    });
    document.getElementById('exportDiagnosticsBtn')?.addEventListener('click', () => {
      this.exportDiagnostics();
    });
    document.getElementById('clearDiagnosticsBtn')?.addEventListener('click', () => {
      this.clearDiagnostics();
    });

    [
      'notificationProjectRuleModeAll',
      'notificationProjectRuleModeInclude',
      'notificationProjectRuleModeExclude',
      'notificationQuietHoursEnabled',
      'notificationBundlingEnabled'
    ].forEach(elementId => {
      const element = document.getElementById(elementId);
      if (element) {
        element.addEventListener('change', () => {
          this.updateNotificationFocusControlState();
        });
      }
    });

    // Reset button
    document.getElementById('resetBtn').addEventListener('click', () => {
      this.resetSettings();
    });

    // Language change - just update UI, don't auto-save
    document.getElementById('languageSelect').addEventListener('change', (_event) => {
      // Just update the preview, don't save automatically
      // Users need to click save button to persist changes
    });

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && changes.language) {
        this.loadLanguage().then(() => {
          this.updateUI();
        });
      }
      if (namespace === 'local' && changes.diagnosticsEnabledV1) {
        this.diagnosticsEnabled = changes.diagnosticsEnabledV1.newValue === true;
        this.diagnosticStore?.handleStorageChanged(changes, namespace);
        this.updateDiagnosticsControl();
      }
    });
  }

  handleTabKeydown(event) {
    const tabs = Array.from(document.querySelectorAll('.tab-button'));
    const index = tabs.indexOf(event.currentTarget);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].focus();
    this.switchTab(tabs[next].dataset.tab);
  }

  switchTab(tabId) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(button => {
      button.classList.remove('active');
      const selected = button.dataset.tab === tabId;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.setAttribute('tabindex', selected ? '0' : '-1');
    });
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

    // Update tab panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.remove('active');
      panel.hidden = true;
    });
    document.getElementById(tabId).classList.add('active');
    document.getElementById(tabId).hidden = false;
  }

  populateForm() {
    // Populate form fields with current settings
    document.getElementById('redmineUrl').value = this.settings.redmineUrl;
    document.getElementById('apiKey').value = this.settings.apiKey;
    document.getElementById('checkInterval').value = this.settings.checkInterval;
    document.getElementById('enableNotifications').checked = this.settings.enableNotifications;
    document.getElementById('enableSound').checked = this.settings.enableSound;
    document.getElementById('onlyMyProjects').checked = this.settings.onlyMyProjects;
    document.getElementById('includeWatchedIssues').checked = this.settings.includeWatchedIssues;
    document.getElementById('maxNotifications').value = this.settings.maxNotifications;
    this.setSelectedNotificationProjectRuleMode(this.settings.notificationProjectRules?.mode);
    document.getElementById('notificationChangeFilterStatus').checked = this.settings.notificationChangeFilters?.status !== false;
    document.getElementById('notificationChangeFilterAssignee').checked = this.settings.notificationChangeFilters?.assignee !== false;
    document.getElementById('notificationChangeFilterPriority').checked = this.settings.notificationChangeFilters?.priority !== false;
    document.getElementById('notificationChangeFilterComment').checked = this.settings.notificationChangeFilters?.comment !== false;
    document.getElementById('notificationChangeFilterGeneric').checked = this.settings.notificationChangeFilters?.generic !== false;
    document.getElementById('notificationQuietHoursEnabled').checked = this.settings.notificationQuietHours?.enabled === true;
    document.getElementById('notificationQuietHoursStart').value = this.settings.notificationQuietHours?.start || '22:00';
    document.getElementById('notificationQuietHoursEnd').value = this.settings.notificationQuietHours?.end || '08:00';
    document.getElementById('notificationBundlingEnabled').checked = this.settings.notificationBundling?.enabled === true;
    document.getElementById('notificationBundlingWindow').value = String(this.settings.notificationBundling?.windowMinutes || 5);
    document.getElementById('languageSelect').value = this.settings.language;
    this.renderNotificationProjectOptions();
    this.updateNotificationFocusControlState();
  }

  async testConnection() {
    const button = document.getElementById('testConnectionBtn');
    const statusDiv = document.getElementById('connectionStatus');

    if (!await this.ensurePrivacyConsent('connectionStatus')) {
      return;
    }
    
    // Get current form values
    const redmineUrl = this.sanitizeInput(document.getElementById('redmineUrl').value);
    const apiKey = document.getElementById('apiKey').value.trim();
    
    // Validate URL format
    const urlValidation = this.validateUrl(redmineUrl);
    if (!urlValidation.valid) {
      this.showStatus('connectionStatus', 'error', urlValidation.message);
      return;
    }
    const normalizedUrl = urlValidation.normalizedUrl;

    // Validate API key format
    const apiKeyValidation = this.validateApiKey(apiKey);
    if (!apiKeyValidation.valid) {
      this.showStatus('connectionStatus', 'error', apiKeyValidation.message);
      return;
    }

    // Disable button and show loading
    button.disabled = true;
    button.textContent = this.translate('testing');
    statusDiv.className = 'status-message info';
    statusDiv.textContent = this.translate('testingConnection');
    statusDiv.style.display = 'block';

    try {
      const permissionResult = await this.ensureOriginPermission(normalizedUrl);
      if (!permissionResult.granted) {
        this.showStatus('connectionStatus', 'error', permissionResult.message);
        return;
      }

      const response = await chrome.runtime.sendMessage({
        action: 'testConnection',
        redmineUrl: normalizedUrl,
        apiKey: apiKey
      });

      if (response.success) {
        this.showStatus(
          'connectionStatus',
          permissionResult.warningMessage ? 'warning' : 'success',
          this.buildStatusMessage('connectionSuccess', permissionResult.warningMessage)
        );
      } else {
        let errorMessage = this.translate('connectionError') + ': ' + this.resolveErrorMessage(response.error);
        
        // Handle specific error types
        if (response.error === 'connectionTimeout') {
          errorMessage = this.translate('connectionTimeout');
        }
        
        this.showStatus('connectionStatus', 'error', errorMessage);
      }
    } catch (error) {
      let errorMessage = this.translate('connectionError') + ': ' + this.resolveErrorMessage(error.message);
      
      // Handle specific error types
      if (error.message === 'connectionTimeout') {
        errorMessage = this.translate('connectionTimeout');
      }
      
      this.showStatus('connectionStatus', 'error', errorMessage);
    } finally {
      button.disabled = false;
      button.textContent = this.translate('testConnection');
    }
  }

  async saveRedmineSettings() {
    const button = document.getElementById('saveRedmineBtn');

    if (!await this.ensurePrivacyConsent('redmineStatus')) {
      return;
    }
    
    // Get Redmine form values with proper sanitization
    const redmineUrl = this.sanitizeInput(document.getElementById('redmineUrl').value);
    const apiKey = this.sanitizeInput(document.getElementById('apiKey').value);

    // Validate URL format
    const urlValidation = this.validateUrl(redmineUrl);
    if (!urlValidation.valid) {
      this.showStatus('redmineStatus', 'error', urlValidation.message);
      return;
    }
    const normalizedUrl = urlValidation.normalizedUrl;

    // Validate API key format
    const apiKeyValidation = this.validateApiKey(apiKey);
    if (!apiKeyValidation.valid) {
      this.showStatus('redmineStatus', 'error', apiKeyValidation.message);
      return;
    }

    // Additional security check for URL
    if (!this.isValidRedmineUrl(normalizedUrl)) {
      this.showStatus('redmineStatus', 'error', this.translate('invalidRedmineUrl'));
      return;
    }

    // Use API key directly
    const apiKeyToSave = apiKey;

    // Disable button and show loading
    button.disabled = true;
    button.textContent = this.translate('saving');

    try {
      const permissionResult = await this.ensureOriginPermission(normalizedUrl);
      if (!permissionResult.granted) {
        this.showStatus('redmineStatus', 'error', permissionResult.message);
        return;
      }

      const previousUrl = this.settings.redmineUrl;
      const configManagerClass = this.getConfigManagerClass();
      const { syncSettings, localSettings } = configManagerClass?.splitSettingsBySensitivity
        ? configManagerClass.splitSettingsBySensitivity({
            redmineUrl: normalizedUrl,
            apiKey: apiKeyToSave
          })
        : {
            syncSettings: { redmineUrl: normalizedUrl },
            localSettings: { apiKey: apiKeyToSave }
          };

      await Promise.all([
        chrome.storage.sync.set(syncSettings),
        chrome.storage.local.set(localSettings)
      ]);

      if (this.shouldRemoveOriginPermission(previousUrl, normalizedUrl)) {
        await this.removeOriginPermission(previousUrl);
      }

      // Update local settings
      this.settings.redmineUrl = normalizedUrl;
      this.settings.apiKey = apiKey;
      await this.loadNotificationProjects({ forceRefresh: true });
      this.showStatus(
        'redmineStatus',
        permissionResult.warningMessage ? 'warning' : 'success',
        this.buildStatusMessage('redmineSettingsSaved', permissionResult.warningMessage)
      );
    } catch (error) {
      this.showStatus('redmineStatus', 'error', this.translate('saveError') + ': ' + this.sanitizeErrorMessage(error.message));
    } finally {
      button.disabled = false;
      button.textContent = this.translate('saveRedmineSettings');
    }
  }

  async saveNotificationSettings() {
    const button = document.getElementById('saveNotificationsBtn');
    
    // Get notification form values
    const checkIntervalValue = document.getElementById('checkInterval').value;
    const maxNotificationsValue = document.getElementById('maxNotifications').value;

    // Validate check interval
    const checkIntervalValidation = this.validateNumber(checkIntervalValue, 1, 1440, this.translate('checkInterval'));
    if (!checkIntervalValidation.valid) {
      this.showStatus('notificationsStatus', 'error', checkIntervalValidation.message);
      return;
    }

    // Validate max notifications
    const maxNotificationsValidation = this.validateNumber(maxNotificationsValue, 1, 1000, this.translate('maxNotifications'));
    if (!maxNotificationsValidation.valid) {
      this.showStatus('notificationsStatus', 'error', maxNotificationsValidation.message);
      return;
    }

    const quietHoursEnabled = document.getElementById('notificationQuietHoursEnabled').checked;
    const quietHoursStartEl = document.getElementById('notificationQuietHoursStart');
    const quietHoursEndEl = document.getElementById('notificationQuietHoursEnd');
    const configManagerClass = this.getConfigManagerClass();

    if (quietHoursEnabled) {
      const isValidQuietHoursTime = typeof configManagerClass?.isValidTimeString === 'function'
        ? value => configManagerClass.isValidTimeString(value)
        : value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

      if (!isValidQuietHoursTime(quietHoursStartEl.value) || !isValidQuietHoursTime(quietHoursEndEl.value)) {
        this.showStatus('notificationsStatus', 'error', this.translate('quietHoursInvalidTime'));
        return;
      }

      if (quietHoursStartEl.value === quietHoursEndEl.value) {
        this.showStatus('notificationsStatus', 'error', this.translate('quietHoursStartEndSame'));
        return;
      }
    }

    const bundlingWindowValidation = this.validateNumber(
      document.getElementById('notificationBundlingWindow').value,
      1,
      60,
      this.translate('notificationBundlingWindow')
    );
    if (!bundlingWindowValidation.valid) {
      this.showStatus('notificationsStatus', 'error', bundlingWindowValidation.message);
      return;
    }

    const notificationFocusSettings = this.buildNotificationFocusSettings();

    const notificationSettings = {
      checkInterval: checkIntervalValidation.value,
      enableNotifications: document.getElementById('enableNotifications').checked,
      enableSound: document.getElementById('enableSound').checked,
      onlyMyProjects: document.getElementById('onlyMyProjects').checked,
      includeWatchedIssues: document.getElementById('includeWatchedIssues').checked,
      maxNotifications: maxNotificationsValidation.value,
      ...notificationFocusSettings,
      notificationBundling: {
        ...notificationFocusSettings.notificationBundling,
        windowMinutes: bundlingWindowValidation.value
      }
    };

    // Disable button and show loading
    button.disabled = true;
    button.textContent = this.translate('saving');

    try {
      await chrome.storage.sync.set(notificationSettings);
      // Update local settings
      Object.assign(this.settings, notificationSettings);
      this.renderNotificationProjectOptions();
      this.updateNotificationFocusControlState();
      this.showStatus('notificationsStatus', 'success', this.translate('notificationSettingsSaved'));
    } catch (error) {
      this.showStatus('notificationsStatus', 'error', this.translate('saveError') + ': ' + error.message);
    } finally {
      button.disabled = false;
      button.textContent = this.translate('saveNotificationSettings');
    }
  }

  async saveLanguageSettings() {
    const button = document.getElementById('saveLanguageBtn');
    
    // Get language form value
    const languageSettings = {
      language: document.getElementById('languageSelect').value
    };

    // Disable button and show loading
    button.disabled = true;
    button.textContent = this.translate('saving');

    try {
      await chrome.storage.sync.set(languageSettings);
      // Update local settings
      Object.assign(this.settings, languageSettings);
      this.showStatus('languageStatus', 'success', this.translate('languageSettingsSaved'));
      
      // Auto-reload language
      this.currentLanguage = languageSettings.language;
      await this.loadLanguage();
      this.updateUI();
    } catch (error) {
      this.showStatus('languageStatus', 'error', this.translate('saveError') + ': ' + error.message);
    } finally {
      button.disabled = false;
      button.textContent = this.translate('saveLanguageSettings');
    }
  }

  async resetSettings() {
    if (!confirm(this.translate('confirmReset'))) {
      return;
    }

    const previousUrl = this.settings.redmineUrl;
    const configManagerClass = this.getConfigManagerClass();
    const defaultSettings = configManagerClass?.getDefaultSyncSettings
      ? configManagerClass.getDefaultSyncSettings()
      : {
          redmineUrl: '',
          checkInterval: 15,
          enableNotifications: true,
          enableSound: true,
          onlyMyProjects: true,
          includeWatchedIssues: false,
          maxNotifications: 50,
          language: 'en'
        };

    try {
      await Promise.all([
        chrome.storage.sync.set(defaultSettings),
        chrome.storage.local.remove(['apiKey'])
      ]);

      if (previousUrl) {
        await this.removeOriginPermission(previousUrl);
      }

      this.settings = {
        ...defaultSettings,
        apiKey: ''
      };
      this.availableNotificationProjects = [];
      this.populateForm();
      this.showPersistentStatus('notificationProjectStatus', 'info', this.translate('notificationProjectsUnavailable'));
      this.showStatus('saveStatus', 'success', this.translate('settingsReset'));
    } catch (error) {
      this.showStatus('saveStatus', 'error', this.translate('resetError') + ': ' + error.message);
    }
  }

  clearStatusTimer(elementId) {
    const timeoutId = this.statusHideTimers.get(elementId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.statusHideTimers.delete(elementId);
    }
  }

  setStatusMessage(elementId, type, message, autoHide = true) {
    const element = document.getElementById(elementId);
    if (!element) {
      return;
    }

    this.clearStatusTimer(elementId);
    element.className = `status-message ${type}`;
    element.textContent = message;
    element.style.display = 'block';

    if (!autoHide) {
      return;
    }

    const timeoutId = setTimeout(() => {
      element.style.display = 'none';
      this.statusHideTimers.delete(elementId);
    }, 5000);

    this.statusHideTimers.set(elementId, timeoutId);
  }

  showStatus(elementId, type, message) {
    this.setStatusMessage(elementId, type, message);
  }

  showPersistentStatus(elementId, type, message) {
    this.setStatusMessage(elementId, type, message, false);
  }

  // Security helper functions
  sanitizeInput(input) {
    if (typeof input !== 'string') {
      return '';
    }
    return input.trim().replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters
  }

  sanitizeErrorMessage(message) {
    const configManagerClass = this.getConfigManagerClass();
    if (configManagerClass?.redactSensitiveText) {
      const sanitizedMessage = configManagerClass.redactSensitiveText(message);
      return sanitizedMessage || 'Unknown error';
    }

    if (typeof message !== 'string') {
      return 'Unknown error';
    }

    return message.replace(/https?:\/\/[^\s]+/g, '[URL]')
      .replace(/[a-zA-Z0-9\-_]{20,}/g, '[KEY]')
      .substring(0, 200);
  }

  isValidRedmineUrl(url) {
    const configManagerClass = this.getConfigManagerClass();
    if (!configManagerClass?.validateRedmineUrl) {
      return this.getValidatedUrlDetails(url).valid;
    }

    return configManagerClass.validateRedmineUrl(url).valid;
  }
}

// Initialize the options page when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new OptionsManager();
});
