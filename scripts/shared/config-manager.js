// Configuration management utility with caching
class ConfigManager {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = new Map();
    this.defaultCacheTime = 5 * 60 * 1000; // 5 minutes
  }

  static getSyncSettingKeys() {
    return [
      'redmineUrl',
      'checkInterval',
      'enableNotifications',
      'enableSound',
      'maxNotifications',
      'language',
      'readNotifications',
      'onlyMyProjects',
      'includeWatchedIssues',
      'notificationProjectRules',
      'notificationChangeFilters',
      'notificationQuietHours',
      'notificationBundling'
    ];
  }

  static getDefaultNotificationProjectRules() {
    return {
      mode: 'all',
      includeProjectIds: [],
      excludeProjectIds: []
    };
  }

  static getDefaultNotificationChangeFilters() {
    return {
      status: true,
      assignee: true,
      priority: true,
      comment: true,
      generic: true
    };
  }

  static getDefaultNotificationQuietHours() {
    return {
      enabled: false,
      start: '22:00',
      end: '08:00'
    };
  }

  static getDefaultNotificationBundling() {
    return {
      enabled: false,
      windowMinutes: 5
    };
  }

  static getDefaultSyncSettings() {
    return {
      redmineUrl: '',
      checkInterval: 15,
      enableNotifications: true,
      enableSound: true,
      maxNotifications: 50,
      language: 'en',
      readNotifications: [],
      onlyMyProjects: true,
      includeWatchedIssues: false,
      notificationProjectRules: this.getDefaultNotificationProjectRules(),
      notificationChangeFilters: this.getDefaultNotificationChangeFilters(),
      notificationQuietHours: this.getDefaultNotificationQuietHours(),
      notificationBundling: this.getDefaultNotificationBundling()
    };
  }

  static normalizeIntegerArray(values) {
    if (!Array.isArray(values)) {
      return [];
    }

    const normalizedValues = values
      .map(value => {
        if (typeof value === 'number') {
          return value;
        }

        if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) {
          return Number(value.trim());
        }

        return undefined;
      })
      .filter(value => Number.isSafeInteger(value) && value > 0);

    return Array.from(new Set(normalizedValues));
  }

  static normalizeNotificationProjectRules(value) {
    const defaults = this.getDefaultNotificationProjectRules();
    if (!value || typeof value !== 'object') {
      return defaults;
    }

    const includeProjectIds = this.normalizeIntegerArray(value.includeProjectIds);
    const excludeProjectIds = this.normalizeIntegerArray(value.excludeProjectIds);
    const rawMode = typeof value.mode === 'string' ? value.mode : '';
    let mode = ['all', 'include', 'exclude'].includes(rawMode) ? rawMode : '';

    if (!mode) {
      if (includeProjectIds.length > 0) {
        mode = 'include';
      } else if (excludeProjectIds.length > 0) {
        mode = 'exclude';
      } else {
        mode = defaults.mode;
      }
    }

    if (mode === 'include') {
      if (includeProjectIds.length === 0) {
        return defaults;
      }
      return {
        mode,
        includeProjectIds,
        excludeProjectIds: []
      };
    }

    if (mode === 'exclude') {
      return {
        mode,
        includeProjectIds: [],
        excludeProjectIds
      };
    }

    return defaults;
  }

  static normalizeNotificationChangeFilters(value) {
    const defaults = this.getDefaultNotificationChangeFilters();
    if (!value || typeof value !== 'object') {
      return defaults;
    }

    return {
      status: value.status !== false,
      assignee: value.assignee !== false,
      priority: value.priority !== false,
      comment: value.comment !== false,
      generic: value.generic !== false
    };
  }

  static isValidTimeString(value) {
    return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  static normalizeNotificationQuietHours(value) {
    const defaults = this.getDefaultNotificationQuietHours();
    if (!value || typeof value !== 'object') {
      return defaults;
    }

    return {
      enabled: value.enabled === true,
      start: this.isValidTimeString(value.start) ? value.start : defaults.start,
      end: this.isValidTimeString(value.end) ? value.end : defaults.end
    };
  }

  static normalizeNotificationBundling(value) {
    const defaults = this.getDefaultNotificationBundling();
    if (!value || typeof value !== 'object') {
      return defaults;
    }

    const windowMinutes = Number.isSafeInteger(value.windowMinutes)
      ? value.windowMinutes
      : Number.parseInt(value.windowMinutes, 10);

    return {
      enabled: value.enabled === true,
      windowMinutes: Number.isSafeInteger(windowMinutes) && windowMinutes >= 1 && windowMinutes <= 60
        ? windowMinutes
        : defaults.windowMinutes
    };
  }

  static normalizeSyncSettings(syncSettings) {
    const settings = this.normalizeStorageResult(syncSettings);
    const defaults = this.getDefaultSyncSettings();

    return {
      ...defaults,
      redmineUrl: typeof settings.redmineUrl === 'string'
        ? settings.redmineUrl
        : defaults.redmineUrl,
      checkInterval: Number.isFinite(settings.checkInterval) && settings.checkInterval > 0
        ? settings.checkInterval
        : defaults.checkInterval,
      enableNotifications: settings.enableNotifications !== false,
      enableSound: settings.enableSound !== false,
      maxNotifications: Number.isFinite(settings.maxNotifications) && settings.maxNotifications > 0
        ? settings.maxNotifications
        : defaults.maxNotifications,
      language: typeof settings.language === 'string' && settings.language.trim()
        ? settings.language
        : defaults.language,
      readNotifications: Array.isArray(settings.readNotifications)
        ? settings.readNotifications.filter(value => typeof value === 'string' && value.trim())
        : defaults.readNotifications,
      onlyMyProjects: settings.onlyMyProjects !== false,
      includeWatchedIssues: settings.includeWatchedIssues === true,
      notificationProjectRules: this.normalizeNotificationProjectRules(settings.notificationProjectRules),
      notificationChangeFilters: this.normalizeNotificationChangeFilters(settings.notificationChangeFilters),
      notificationQuietHours: this.normalizeNotificationQuietHours(settings.notificationQuietHours),
      notificationBundling: this.normalizeNotificationBundling(settings.notificationBundling)
    };
  }

  static normalizeRuntimeSettings(syncSettings, localSettings) {
    const normalizedSyncSettings = this.normalizeSyncSettings(syncSettings);
    const normalizedLocalSettings = this.normalizeStorageResult(localSettings);

    return {
      ...normalizedSyncSettings,
      apiKey: typeof normalizedLocalSettings.apiKey === 'string'
        ? normalizedLocalSettings.apiKey
        : ''
    };
  }

  static async validateSettings(settings) {
    const errors = [];
    
    if (settings.redmineUrl) {
      const validation = this.validateRedmineUrl(settings.redmineUrl);
      if (!validation.valid) {
        errors.push(validation.messageKey || 'Invalid Redmine URL format');
      }
    }
    
    if (settings.checkInterval && (settings.checkInterval < 1 || settings.checkInterval > 1440)) {
      errors.push('Check interval must be between 1 and 1440 minutes');
    }
    
    if (settings.maxNotifications && (settings.maxNotifications < 1 || settings.maxNotifications > 1000)) {
      errors.push('Max notifications must be between 1 and 1000');
    }

    if (settings.notificationQuietHours) {
      const quietHours = this.normalizeNotificationQuietHours(settings.notificationQuietHours);
      if (
        settings.notificationQuietHours.start !== undefined && !this.isValidTimeString(settings.notificationQuietHours.start)
        || settings.notificationQuietHours.end !== undefined && !this.isValidTimeString(settings.notificationQuietHours.end)
      ) {
        errors.push('Quiet hours must use HH:MM 24-hour format');
      }

      if (quietHours.enabled && quietHours.start === quietHours.end) {
        errors.push('Quiet hours start and end must not be the same');
      }
    }

    if (settings.notificationBundling) {
      const bundlingWindow = Number.isSafeInteger(settings.notificationBundling.windowMinutes)
        ? settings.notificationBundling.windowMinutes
        : Number.parseInt(settings.notificationBundling.windowMinutes, 10);

      if (!Number.isSafeInteger(bundlingWindow) || bundlingWindow < 1 || bundlingWindow > 60) {
        errors.push('Notification bundling window must be between 1 and 60 minutes');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  // Cached storage operations
  async getCachedSettings(keys) {
    const cacheKey = JSON.stringify(keys);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await chrome.storage.sync.get(keys);
    this.setCache(cacheKey, result);
    return result;
  }

  async setCachedSettings(settings) {
    // Clear related cache entries
    this.clearSettingsCache();
    return await chrome.storage.sync.set(settings);
  }

  getFromCache(key) {
    const expiry = this.cacheExpiry.get(key);
    if (expiry && Date.now() < expiry) {
      return this.cache.get(key);
    }
    // Clean expired cache
    this.cache.delete(key);
    this.cacheExpiry.delete(key);
    return null;
  }

  setCache(key, value, ttl = this.defaultCacheTime) {
    this.cache.set(key, value);
    this.cacheExpiry.set(key, Date.now() + ttl);
  }

  clearSettingsCache() {
    // Clear all settings-related cache entries
    for (const [key] of this.cache) {
      if (key.includes('redmine') || key.includes('notification') || key.includes('language')) {
        this.cache.delete(key);
        this.cacheExpiry.delete(key);
      }
    }
  }

  static isValidUrl(url) {
    return this.validateRedmineUrl(url).valid;
  }

  static isDevelopmentHost(hostname) {
    if (typeof hostname !== 'string') {
      return false;
    }

    const normalizedHost = hostname.toLowerCase();
    return normalizedHost === 'localhost' ||
      normalizedHost === '127.0.0.1' ||
      normalizedHost === '::1' ||
      normalizedHost === '[::1]';
  }

  static getOriginPattern(input) {
    const url = input instanceof URL ? input : new URL(input);
    return `${url.protocol}//${url.hostname}/*`;
  }

  static validateRedmineUrl(url) {
    if (typeof url !== 'string' || url.trim() === '') {
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

      if (!urlObj.hostname) {
        return {
          valid: false,
          messageKey: 'invalidUrlFormat'
        };
      }

      const normalizedUrl = urlObj.toString().replace(/\/$/, '');
      const originPattern = this.getOriginPattern(urlObj);

      if (urlObj.protocol === 'https:') {
        return {
          valid: true,
          normalizedUrl,
          originPattern,
          requiresWarning: false
        };
      }

      return {
        valid: true,
        normalizedUrl,
        originPattern,
        requiresWarning: true,
        messageKey: 'insecureDevelopmentUrlWarning'
      };
    } catch {
      return {
        valid: false,
        messageKey: 'invalidUrlFormat'
      };
    }
  }

  static redactSensitiveText(value) {
    if (typeof value !== 'string') {
      return '';
    }

    return value
      .replace(/https?:\/\/[^\s]+/g, '[URL]')
      .replace(/[A-Za-z0-9\-_]{20,}/g, '[KEY]')
      .substring(0, 200);
  }

  static splitSettingsBySensitivity(settings) {
    const syncSettings = {};
    const localSettings = {};

    for (const [key, value] of Object.entries(settings)) {
      if (key === 'apiKey') {
        localSettings.apiKey = value;
        continue;
      }

      syncSettings[key] = value;
    }

    return {
      syncSettings,
      localSettings
    };
  }

  static async migrateLegacyApiKey() {
    if (!chrome?.storage?.sync || !chrome?.storage?.local) {
      return '';
    }

    const [syncResult, localResult] = await Promise.all([
      chrome.storage.sync.get(['apiKey']),
      chrome.storage.local.get(['apiKey'])
    ]);

    const syncSettings = this.normalizeStorageResult(syncResult);
    const localSettings = this.normalizeStorageResult(localResult);
    const localApiKey = typeof localSettings.apiKey === 'string' ? localSettings.apiKey : '';
    const syncApiKey = typeof syncSettings.apiKey === 'string' ? syncSettings.apiKey : '';

    if (localApiKey) {
      if (syncApiKey) {
        await chrome.storage.sync.remove(['apiKey']);
      }

      return localApiKey;
    }

    if (!syncApiKey) {
      return '';
    }

    await chrome.storage.local.set({ apiKey: syncApiKey });
    await chrome.storage.sync.remove(['apiKey']);
    return syncApiKey;
  }

  static normalizeStorageResult(result) {
    return result && typeof result === 'object' ? result : {};
  }

  static sanitizeConfig(config) {
    const sanitized = {};
    
    // Only allow known configuration keys
    const allowedKeys = [
      'redmineUrl', 'apiKey', 'checkInterval', 'enableNotifications',
      'enableSound', 'maxNotifications', 'language', 'onlyMyProjects',
      'includeWatchedIssues', 'notificationProjectRules',
      'notificationChangeFilters', 'notificationQuietHours',
      'notificationBundling'
    ];
    
    for (const key of allowedKeys) {
      if (config.hasOwnProperty(key)) {
        sanitized[key] = config[key];
      }
    }
    
    return sanitized;
  }
}

// Export for use in options page
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ConfigManager };
} else {
  globalThis.ConfigManager = ConfigManager;
  globalThis.configManager = new ConfigManager();
}
