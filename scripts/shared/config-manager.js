// Configuration management utility with caching
class ConfigManager {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = new Map();
    this.defaultCacheTime = 5 * 60 * 1000; // 5 minutes
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

    const localApiKey = typeof localResult.apiKey === 'string' ? localResult.apiKey : '';
    const syncApiKey = typeof syncResult.apiKey === 'string' ? syncResult.apiKey : '';

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

  static sanitizeConfig(config) {
    const sanitized = {};
    
    // Only allow known configuration keys
    const allowedKeys = [
      'redmineUrl', 'apiKey', 'checkInterval', 'enableNotifications',
      'enableSound', 'maxNotifications', 'language', 'onlyMyProjects',
      'includeWatchedIssues'
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
