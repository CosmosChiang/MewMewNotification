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

  beforeEach(() => {
    i18nManager = new I18nManager();
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

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await i18nManager.loadLanguage();

      expect(global.fetch).toHaveBeenCalledWith('_locales/fr/messages.json');
      expect(global.fetch).toHaveBeenCalledWith('_locales/en/messages.json');
      expect(i18nManager.currentLanguage).toBe('en');
      expect(result).toEqual(englishTranslations);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    test('should handle complete failure gracefully', async () => {
      chrome.storage.sync.get.mockResolvedValue({ language: 'fr' });
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await i18nManager.loadLanguage();

      expect(i18nManager.translations).toEqual({});
      expect(result).toEqual({});
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    test('should handle network errors', async () => {
      chrome.storage.sync.get.mockResolvedValue({ language: 'ja' });
      global.fetch.mockRejectedValue(new Error('Network error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await i18nManager.loadLanguage();

      expect(consoleSpy).toHaveBeenCalledWith('Failed to load language:', expect.any(Error));
      expect(result).toEqual({});

      consoleSpy.mockRestore();
    });

    test('should handle JSON parsing errors', async () => {
      chrome.storage.sync.get.mockResolvedValue({ language: 'ja' });
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await i18nManager.loadLanguage();

      expect(consoleSpy).toHaveBeenCalled();
      expect(result).toEqual({});

      consoleSpy.mockRestore();
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
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = i18nManager.translate('nonexistent');
      
      expect(result).toBe('nonexistent');
      expect(consoleSpy).toHaveBeenCalledWith('Translation missing for key: nonexistent');

      consoleSpy.mockRestore();
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
