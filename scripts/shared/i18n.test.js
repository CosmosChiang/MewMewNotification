// Unit tests for I18nManager class
// Import the actual I18nManager to test real implementation

// Mock chrome APIs and fetch before importing
global.chrome = {
  storage: {
    sync: {
      get: jest.fn()
    }
  }
};

global.fetch = jest.fn();

// Import the actual I18nManager
const I18nManager = require('./i18n.js');

describe('I18nManager', () => {
  let i18nManager;
  let logger;

  beforeEach(() => {
    logger = {
      warn: jest.fn(),
      error: jest.fn()
    };
    i18nManager = new I18nManager({ logger });
    jest.clearAllMocks();
    
    // Reset manager state
    i18nManager.currentLanguage = 'en';
    i18nManager.translations = {};
  });

  describe('Constructor', () => {
    test('should initialize with default values', () => {
      expect(i18nManager.currentLanguage).toBe('en');
      expect(i18nManager.translations).toEqual({});
    });

    test('uses every safe default dependency without leaking failures', async () => {
      const manager = new I18nManager();
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          appName: { message: 'MewMew Notification' }
        })
      });

      await expect(manager.loadLanguage('en')).resolves.toEqual({
        appName: { message: 'MewMew Notification' }
      });
      expect(global.fetch).toHaveBeenCalledWith('_locales/en/messages.json');

      manager.translations = {};
      expect(manager.translate('missing')).toBe('missing');

      manager.fetch = undefined;
      await expect(manager.loadLanguage('en')).resolves.toEqual({});
    });
  });

  describe('loadLanguage', () => {
    test('should load language from storage and fetch translations', async () => {
      const mockTranslations = {
        'appName': { 'message': 'MewMew Notification' },
        'settings': { 'message': 'Settings' }
      };

      chrome.storage.sync.get.mockResolvedValue({ language: 'ja' });
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTranslations)
      });

      const result = await i18nManager.loadLanguage();

      expect(chrome.storage.sync.get).toHaveBeenCalledWith(['language']);
      expect(global.fetch).toHaveBeenCalledWith('_locales/ja/messages.json');
      expect(i18nManager.currentLanguage).toBe('ja');
      expect(i18nManager.translations).toEqual(mockTranslations);
      expect(result).toEqual(mockTranslations);
    });

    test('should use default language when no preference is stored', async () => {
      const mockTranslations = {
        'appName': { 'message': 'MewMew Notification' }
      };

      chrome.storage.sync.get.mockResolvedValue({});
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTranslations)
      });

      await i18nManager.loadLanguage();

      expect(global.fetch).toHaveBeenCalledWith('_locales/en/messages.json');
      expect(i18nManager.currentLanguage).toBe('en');
    });

    test('should fallback to English when language file fails to load', async () => {
      const englishTranslations = {
        'appName': { 'message': 'MewMew Notification' }
      };

      chrome.storage.sync.get.mockResolvedValue({ language: 'fr' });
      
      // Mock fetch to fail for French but succeed for English
      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(englishTranslations)
        });

      const result = await i18nManager.loadLanguage();

      expect(global.fetch).toHaveBeenCalledWith('_locales/fr/messages.json');
      expect(global.fetch).toHaveBeenCalledWith('_locales/en/messages.json');
      expect(i18nManager.currentLanguage).toBe('en');
      expect(result).toEqual(englishTranslations);
      expect(logger.error).toHaveBeenCalledWith('i18n_locale_load_failed', expect.objectContaining({
        language: 'fr'
      }));
    });

    test('should handle complete failure gracefully', async () => {
      chrome.storage.sync.get.mockResolvedValue({ language: 'fr' });
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      const result = await i18nManager.loadLanguage();

      expect(i18nManager.translations).toEqual({});
      expect(result).toEqual({});
      expect(logger.error).toHaveBeenCalledTimes(2);
    });

    test('should handle network errors', async () => {
      chrome.storage.sync.get.mockResolvedValue({ language: 'ja' });
      global.fetch.mockRejectedValue(new Error('Network error'));

      const result = await i18nManager.loadLanguage();

      expect(logger.error).toHaveBeenCalledWith('i18n_locale_load_failed', expect.objectContaining({
        errorCode: 'localeLoadFailed'
      }));
      expect(result).toEqual({});
    });

    test('should handle JSON parsing errors', async () => {
      chrome.storage.sync.get.mockResolvedValue({ language: 'ja' });
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      const result = await i18nManager.loadLanguage();

      expect(logger.error).toHaveBeenCalled();
      expect(result).toEqual({});
    });

    test('falls back when storage fails and updates an injected document root', async () => {
      const documentRoot = {};
      const manager = new I18nManager({
        storage: {
          get: jest.fn().mockRejectedValue(new Error('storage unavailable'))
        },
        fetch: jest.fn().mockResolvedValue({
          ok: true,
          json: jest.fn().mockResolvedValue({
            appName: { message: 'MewMew Notification' }
          })
        }),
        documentRoot,
        logger
      });

      await expect(manager.loadLanguage()).resolves.toEqual({
        appName: { message: 'MewMew Notification' }
      });
      expect(documentRoot.lang).toBe('en');
      expect(logger.warn).toHaveBeenCalledWith('i18n_storage_read_failed', {
        errorCode: 'storageReadFailed'
      });
    });

    test('returns deterministic English state when no fetch dependency exists', async () => {
      const documentRoot = {};
      const manager = new I18nManager({
        storage: { get: jest.fn().mockResolvedValue({ language: 'ja' }) },
        fetch: null,
        documentRoot,
        logger
      });
      manager.fetch = undefined;

      await expect(manager.loadLanguage()).resolves.toEqual({});
      expect(manager.getCurrentLanguage()).toBe('en');
      expect(documentRoot.lang).toBe('en');
      expect(logger.error).toHaveBeenCalledTimes(2);
    });

    test('accepts null storage results and responses with no explicit ok flag', async () => {
      const manager = new I18nManager({
        storage: { get: jest.fn().mockResolvedValue(null) },
        fetch: jest.fn().mockResolvedValue({
          json: jest.fn().mockResolvedValue({ title: { message: 'Title' } })
        }),
        logger
      });

      await expect(manager.loadLanguage()).resolves.toEqual({
        title: { message: 'Title' }
      });
      expect(manager.getCurrentLanguage()).toBe('en');
    });
  });

  describe('translate', () => {
    beforeEach(() => {
      i18nManager.translations = {
        'appName': { 'message': 'MewMew Notification' },
        'welcome': { 'message': 'Welcome, $1!' },
        'notifications': { 'message': 'You have $1 notifications from $2' },
        'empty': { 'message': '' }
      };
    });

    test('should return translated message for existing key', () => {
      const result = i18nManager.translate('appName');
      expect(result).toBe('MewMew Notification');
    });

    test('should return key for missing translation', () => {
      const result = i18nManager.translate('nonexistent');
      
      expect(result).toBe('nonexistent');
      expect(logger.warn).toHaveBeenCalledWith('i18n_translation_missing', {
        errorCode: 'translationMissing'
      });
    });

    test('should handle single substitution', () => {
      const result = i18nManager.translate('welcome', ['John']);
      expect(result).toBe('Welcome, John!');
    });

    test('should handle multiple substitutions', () => {
      const result = i18nManager.translate('notifications', ['5', 'Redmine']);
      expect(result).toBe('You have 5 notifications from Redmine');
    });

    test('should handle no substitutions array', () => {
      const result = i18nManager.translate('welcome');
      expect(result).toBe('Welcome, $1!');
    });

    test('should handle empty substitutions array', () => {
      const result = i18nManager.translate('welcome', []);
      expect(result).toBe('Welcome, $1!');
    });

    test('should handle substitutions with missing placeholders', () => {
      const result = i18nManager.translate('appName', ['unused']);
      expect(result).toBe('MewMew Notification');
    });

    test('should handle empty message', () => {
      const result = i18nManager.translate('empty');
      expect(result).toBe('');
    });
  });

  describe('getCurrentLanguage', () => {
    test('should return current language', () => {
      i18nManager.currentLanguage = 'ja';
      expect(i18nManager.getCurrentLanguage()).toBe('ja');
    });
  });

  describe('getTranslations', () => {
    test('should return current translations object', () => {
      const translations = {
        'test': { 'message': 'Test' }
      };
      i18nManager.translations = translations;
      
      expect(i18nManager.getTranslations()).toBe(translations);
    });
  });

  describe('Integration Tests', () => {
    test('should complete full loading and translation workflow', async () => {
      const mockTranslations = {
        'welcome': { 'message': 'こんにちは、$1!' },
        'app': { 'message': 'アプリ' }
      };

      chrome.storage.sync.get.mockResolvedValue({ language: 'ja' });
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTranslations)
      });

      await i18nManager.loadLanguage();
      
      expect(i18nManager.getCurrentLanguage()).toBe('ja');
      expect(i18nManager.translate('welcome', ['田中'])).toBe('こんにちは、田中!');
      expect(i18nManager.translate('app')).toBe('アプリ');
    });
  });
});
