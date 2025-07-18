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
      if (!this.isValidUrl(settings.redmineUrl)) {
        errors.push('Invalid Redmine URL format');
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
    try {
      const urlObj = new URL(url);
      // Allow both HTTP and HTTPS protocols
      // Note: HTTP is not recommended for production due to security concerns
      return ['http:', 'https:'].includes(urlObj.protocol);
    } catch {
      return false;
    }
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
  window.ConfigManager = ConfigManager;
  // Create global instance
  window.configManager = new ConfigManager();
}
