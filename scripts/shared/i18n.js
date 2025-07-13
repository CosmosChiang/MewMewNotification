// Shared internationalization utility
class I18nManager {
  constructor() {
    this.currentLanguage = 'en';
    this.translations = {};
  }

  async loadLanguage() {
    try {
      // Get language preference from settings
      const result = await chrome.storage.sync.get(['language']);
      this.currentLanguage = result.language || 'en';
      
      // Load translations
      const response = await fetch(`_locales/${this.currentLanguage}/messages.json`);
      if (!response.ok) {
        throw new Error(`Failed to load language file: ${response.status}`);
      }
      
      this.translations = await response.json();
      console.log(`Language loaded: ${this.currentLanguage}`);
      
      return this.translations;
    } catch (error) {
      console.error('Failed to load language:', error);
      
      // Fallback to English if loading fails
      if (this.currentLanguage !== 'en') {
        this.currentLanguage = 'en';
        return await this.loadLanguage();
      }
      
      // If even English fails, return empty object
      this.translations = {};
      return this.translations;
    }
  }

  translate(key, substitutions = []) {
    const translation = this.translations[key];
    if (!translation) {
      console.warn(`Translation missing for key: ${key}`);
      return key;
    }
    
    let message = translation.message;
    if (substitutions && substitutions.length > 0) {
      substitutions.forEach((sub, index) => {
        message = message.replace(`$${index + 1}`, sub);
      });
    }
    
    return message;
  }

  getCurrentLanguage() {
    return this.currentLanguage;
  }

  getTranslations() {
    return this.translations;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = I18nManager;
} else {
  window.I18nManager = I18nManager;
}
