class OptionsManager {
  constructor() {
    this.currentLanguage = 'en';
    this.translations = {};
    this.settings = {};
    this.statusHideTimers = new Map();
    this.init();
  }

  async init() {
    await this.loadLanguage();
    await this.loadSettings();
    this.setupEventListeners();
    
    // Initialize language options dynamically (with fallback to static options)
    await this.initializeLanguageOptions();
    
    this.updateUI();
    this.populateForm();
    await this.syncConfiguredPermissionStatus();
  }

  async loadLanguage(languageOverride) {
    try {
      if (languageOverride) {
        this.currentLanguage = languageOverride;
      } else {
        const result = await chrome.storage.sync.get(['language']);
        const configManagerClass = this.getConfigManagerClass();
        const languageSettings = configManagerClass?.normalizeStorageResult
          ? configManagerClass.normalizeStorageResult(result)
          : (result && typeof result === 'object' ? result : {});
        this.currentLanguage = languageSettings.language || 'en';
      }
      
      const response = await fetch(`_locales/${this.currentLanguage}/messages.json`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.translations = await response.json();
      return this.translations;
    } catch (error) {
      console.error('Failed to load language:', error);
      // Fallback to English if loading fails
      if (this.currentLanguage !== 'en') {
        return this.loadLanguage('en');
      }
      this.translations = {};
      return this.translations;
    }
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
    const translation = this.translations[key];
    if (!translation) return key;
    
    let message = translation.message;
    if (substitutions.length > 0) {
      substitutions.forEach((sub, index) => {
        message = message.replace(`$${index + 1}`, sub);
      });
    }
    
    return message;
  }

  getConfigManagerClass() {
    return globalThis.ConfigManager || undefined;
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
      'notificationSettingsTitle': 'notificationSettings',
      'checkIntervalLabel': 'checkInterval',
      'enableNotificationsLabel': 'enableDesktopNotifications',
      'enableSoundLabel': 'enableNotificationSound',
      'onlyMyProjectsLabel': 'onlyMyProjects',
      'includeWatchedIssuesLabel': 'includeWatchedIssues',
      'maxNotificationsLabel': 'maxNotifications',
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
  getSupportedLanguages() {
    const languageSelect = document.getElementById('languageSelect');
    if (!languageSelect) return [];

    return Array.from(languageSelect.options).map(option => ({
      code: option.value,
      name: option.text
    }));
  }

  // Method to add a new language option programmatically
  addLanguageOption(languageCode, displayName) {
    const languageSelect = document.getElementById('languageSelect');
    if (!languageSelect) return;

    // Check if language already exists
    const existingOption = Array.from(languageSelect.options).find(
      option => option.value === languageCode
    );
    
    if (existingOption) {
      console.warn(`Language ${languageCode} already exists`);
      return;
    }

    // Create new option
    const newOption = document.createElement('option');
    newOption.value = languageCode;
    newOption.text = displayName;
    
    // Add to select (sorted alphabetically by display name)
    const options = Array.from(languageSelect.options);
    const insertIndex = options.findIndex(option => option.text > displayName);
    
    if (insertIndex === -1) {
      languageSelect.appendChild(newOption);
    } else {
      languageSelect.insertBefore(newOption, options[insertIndex]);
    }

    console.log(`Added language option: ${languageCode} - ${displayName}`);
  }

  // Method to automatically detect available languages from _locales directory
  async getAvailableLanguages() {
    const defaultLanguages = [
      { code: 'en', name: 'English' },
      { code: 'zh_TW', name: '繁體中文' },
      { code: 'zh_CN', name: '简体中文' },
      { code: 'ja', name: '日本語' }
    ];

    const availableLanguages = [];
    
    for (const lang of defaultLanguages) {
      try {
        // Try to fetch the language file to verify it exists
        const response = await fetch(`_locales/${lang.code}/messages.json`);
        if (response.ok) {
          availableLanguages.push(lang);
        }
      } catch (error) {
        console.warn(`Language ${lang.code} not available:`, error);
      }
    }

    return availableLanguages;
  }

  // Method to validate language completeness
  async validateLanguageFile(languageCode) {
    try {
      const response = await fetch(`_locales/${languageCode}/messages.json`);
      if (!response.ok) {
        return { valid: false, error: 'Language file not found' };
      }

      const translations = await response.json();
      const requiredKeys = Object.keys(this.translations); // Current language keys as reference
      const missingKeys = requiredKeys.filter(key => !translations[key]);

      return {
        valid: missingKeys.length === 0,
        missingKeys: missingKeys,
        totalKeys: requiredKeys.length,
        availableKeys: Object.keys(translations).length
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  // Enhanced method to initialize language options dynamically
  async initializeLanguageOptions() {
    const languageSelect = document.getElementById('languageSelect');
    if (!languageSelect) return;

    try {
      // Get available languages
      const availableLanguages = await this.getAvailableLanguages();
      
      // Clear existing options
      languageSelect.innerHTML = '';
      
      // Add available languages
      availableLanguages.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang.code;
        option.text = lang.name;
        languageSelect.appendChild(option);
      });

      // Update with current language translations
      this.updateLanguageOptions();
      
      console.log(`Initialized ${availableLanguages.length} language options`);
    } catch (error) {
      console.error('Failed to initialize language options:', error);
      // Fallback to existing options if dynamic loading fails
    }
  }

  // Developer tool: Check all language files for completeness
  async checkAllLanguageFiles() {
    const languageSelect = document.getElementById('languageSelect');
    if (!languageSelect) return;

    const results = {};
    const languages = Array.from(languageSelect.options).map(option => option.value);

    console.log('🌐 Checking language file completeness...');
    
    for (const langCode of languages) {
      const validation = await this.validateLanguageFile(langCode);
      results[langCode] = validation;
      
      if (validation.valid) {
        console.log(`✅ ${langCode}: Complete (${validation.availableKeys} keys)`);
      } else {
        console.warn(`⚠️ ${langCode}: ${validation.error || 'Incomplete'}`);
        if (validation.missingKeys) {
          console.warn(`   Missing keys (${validation.missingKeys.length}/${validation.totalKeys}):`, validation.missingKeys);
        }
      }
    }

    return results;
  }

  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
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

    // Reset button
    document.getElementById('resetBtn').addEventListener('click', () => {
      this.resetSettings();
    });

    // Language change - just update UI, don't auto-save
    document.getElementById('languageSelect').addEventListener('change', (e) => {
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
    });
  }

  switchTab(tabId) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(button => {
      button.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

    // Update tab panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    document.getElementById(tabId).classList.add('active');
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
    document.getElementById('languageSelect').value = this.settings.language;
  }

  async testConnection() {
    const button = document.getElementById('testConnectionBtn');
    const statusDiv = document.getElementById('connectionStatus');
    
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

    const notificationSettings = {
      checkInterval: checkIntervalValidation.value,
      enableNotifications: document.getElementById('enableNotifications').checked,
      enableSound: document.getElementById('enableSound').checked,
      onlyMyProjects: document.getElementById('onlyMyProjects').checked,
      includeWatchedIssues: document.getElementById('includeWatchedIssues').checked,
      maxNotifications: maxNotificationsValidation.value
    };

    // Disable button and show loading
    button.disabled = true;
    button.textContent = this.translate('saving');

    try {
      await chrome.storage.sync.set(notificationSettings);
      // Update local settings
      Object.assign(this.settings, notificationSettings);
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

  async saveSettings() {
    const button = document.getElementById('saveBtn');
    
    // Get form values
    const redmineUrl = this.sanitizeInput(document.getElementById('redmineUrl').value);
    const apiKey = document.getElementById('apiKey').value.trim();
    const checkIntervalValue = document.getElementById('checkInterval').value;
    const maxNotificationsValue = document.getElementById('maxNotifications').value;

    // Validate URL format
    const urlValidation = this.validateUrl(redmineUrl);
    if (!urlValidation.valid) {
      this.showStatus('saveStatus', 'error', urlValidation.message);
      return;
    }
    const normalizedUrl = urlValidation.normalizedUrl;

    // Validate API key format
    const apiKeyValidation = this.validateApiKey(apiKey);
    if (!apiKeyValidation.valid) {
      this.showStatus('saveStatus', 'error', apiKeyValidation.message);
      return;
    }

    // Validate check interval
    const checkIntervalValidation = this.validateNumber(checkIntervalValue, 1, 1440, this.translate('checkInterval'));
    if (!checkIntervalValidation.valid) {
      this.showStatus('saveStatus', 'error', checkIntervalValidation.message);
      return;
    }

    // Validate max notifications
    const maxNotificationsValidation = this.validateNumber(maxNotificationsValue, 1, 1000, this.translate('maxNotifications'));
    if (!maxNotificationsValidation.valid) {
      this.showStatus('saveStatus', 'error', maxNotificationsValidation.message);
      return;
    }

    const settings = {
      redmineUrl: normalizedUrl,
      apiKey: apiKey,
      checkInterval: checkIntervalValidation.value,
      enableNotifications: document.getElementById('enableNotifications').checked,
      enableSound: document.getElementById('enableSound').checked,
      onlyMyProjects: document.getElementById('onlyMyProjects').checked,
      includeWatchedIssues: document.getElementById('includeWatchedIssues').checked,
      maxNotifications: maxNotificationsValidation.value,
      language: document.getElementById('languageSelect').value
    };

    // Disable button and show loading
    button.disabled = true;
    button.textContent = this.translate('saving');

    try {
      const permissionResult = await this.ensureOriginPermission(normalizedUrl);
      if (!permissionResult.granted) {
        this.showStatus('saveStatus', 'error', permissionResult.message);
        return;
      }

      const previousUrl = this.settings.redmineUrl;
      const configManagerClass = this.getConfigManagerClass();
      const { syncSettings, localSettings } = configManagerClass?.splitSettingsBySensitivity
        ? configManagerClass.splitSettingsBySensitivity(settings)
        : {
            syncSettings: { ...settings, apiKey: undefined },
            localSettings: { apiKey: apiKey }
          };

      if (syncSettings.apiKey === undefined) {
        delete syncSettings.apiKey;
      }

      await Promise.all([
        chrome.storage.sync.set(syncSettings),
        chrome.storage.local.set(localSettings)
      ]);

      if (this.shouldRemoveOriginPermission(previousUrl, normalizedUrl)) {
        await this.removeOriginPermission(previousUrl);
      }

      // Update local settings
      this.settings = {
        ...settings,
        apiKey: apiKey
      };
      this.showStatus(
        'saveStatus',
        permissionResult.warningMessage ? 'warning' : 'success',
        this.buildStatusMessage('settingsSaved', permissionResult.warningMessage)
      );
    } catch (error) {
      this.showStatus('saveStatus', 'error', this.translate('saveError') + ': ' + error.message);
    } finally {
      button.disabled = false;
      button.textContent = this.translate('save');
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
      this.populateForm();
      this.showStatus('saveStatus', 'success', this.translate('settingsReset'));
    } catch (error) {
      this.showStatus('saveStatus', 'error', this.translate('resetError') + ': ' + error.message);
    }
  }

  async changeLanguage(language) {
    try {
      await chrome.storage.sync.set({ language });
      this.currentLanguage = language;
      await this.loadLanguage();
      this.updateUI();
    } catch (error) {
      console.error('Failed to change language:', error);
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
