(function initializeI18nManager(root, factory) {
  const I18nManager = factory();

  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = I18nManager;
  } else {
    root.I18nManager = I18nManager;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createI18nManager() {
  class I18nManager {
    constructor({
      storage,
      fetch: fetchImplementation,
      localeUrlResolver = language => `_locales/${language}/messages.json`,
      documentRoot,
      logger
    } = {}) {
      this.storage = storage || globalThis.chrome?.storage?.sync;
      this.fetch = fetchImplementation || globalThis.fetch;
      this.localeUrlResolver = localeUrlResolver;
      this.documentRoot = documentRoot;
      this.logger = logger || {
        warn: () => {},
        error: () => {}
      };
      this.currentLanguage = 'en';
      this.translations = {};
    }

    async loadLanguage(languageOverride) {
      let selectedLanguage = languageOverride;

      if (!selectedLanguage) {
        try {
          const result = await this.storage?.get?.(['language']);
          const normalized = result && typeof result === 'object' ? result : {};
          selectedLanguage = normalized.language || 'en';
        } catch {
          selectedLanguage = 'en';
          this.logger.warn('i18n_storage_read_failed', { errorCode: 'storageReadFailed' });
        }
      }

      return this.loadWithEnglishFallback(selectedLanguage || 'en');
    }

    async loadWithEnglishFallback(language) {
      const candidates = language === 'en' ? ['en'] : [language, 'en'];

      for (const candidate of candidates) {
        try {
          if (typeof this.fetch !== 'function') {
            throw new Error('localeFetchUnavailable');
          }
          const response = await this.fetch(this.localeUrlResolver(candidate));
          if (response?.ok === false) {
            throw new Error('localeFetchFailed');
          }
          this.translations = await response.json();
          this.currentLanguage = candidate;
          if (this.documentRoot) {
            this.documentRoot.lang = candidate.replace('_', '-');
          }
          return this.translations;
        } catch {
          this.logger.error('i18n_locale_load_failed', {
            errorCode: 'localeLoadFailed',
            language: candidate
          });
        }
      }

      this.currentLanguage = 'en';
      this.translations = {};
      if (this.documentRoot) {
        this.documentRoot.lang = 'en';
      }
      return this.translations;
    }

    translate(key, substitutions = []) {
      const translation = this.translations[key];
      if (!translation) {
        this.logger.warn('i18n_translation_missing', {
          errorCode: 'translationMissing'
        });
        return key;
      }

      let message = translation.message;
      substitutions.forEach((substitution, index) => {
        message = message.replace(`$${index + 1}`, substitution);
      });
      return message;
    }

    getCurrentLanguage() {
      return this.currentLanguage;
    }

    getTranslations() {
      return this.translations;
    }
  }

  return I18nManager;
});
