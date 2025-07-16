// Configuration management utility
class ConfigManager {
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
}
