// Unit tests for ConfigManager class
// Import the actual ConfigManager to test real implementation

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Mock chrome APIs before importing the module
global.chrome = {
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    },
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    }
  }
};

// Import the actual ConfigManager
const { ConfigManager } = require('./config-manager.js');

describe('ConfigManager', () => {
  let configManager;

  beforeEach(() => {
    configManager = new ConfigManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clear cache after each test
    configManager.cache.clear();
    configManager.cacheExpiry.clear();
  });

  describe('Constructor', () => {
    test('should initialize with correct default values', () => {
      expect(configManager.cache).toBeInstanceOf(Map);
      expect(configManager.cacheExpiry).toBeInstanceOf(Map);
      expect(configManager.defaultCacheTime).toBe(5 * 60 * 1000);
    });
  });

  describe('Static Methods', () => {
    describe('isValidUrl', () => {
      test('should return true for valid HTTPS URLs', () => {
        expect(ConfigManager.isValidUrl('https://redmine.example.com')).toBe(true);
        expect(ConfigManager.isValidUrl('https://localhost:3000')).toBe(true);
        expect(ConfigManager.isValidUrl('https://test.com/redmine')).toBe(true);
      });

      test('should only return true for local development HTTP URLs', () => {
        expect(ConfigManager.isValidUrl('http://redmine.example.com')).toBe(false);
        expect(ConfigManager.isValidUrl('http://localhost:3000')).toBe(true);
        expect(ConfigManager.isValidUrl('http://127.0.0.1:3000')).toBe(true);
      });

      test('should return false for invalid URLs', () => {
        expect(ConfigManager.isValidUrl('not-a-url')).toBe(false);
        expect(ConfigManager.isValidUrl('ftp://invalid')).toBe(false);
        expect(ConfigManager.isValidUrl('just-text')).toBe(false);
        expect(ConfigManager.isValidUrl('')).toBe(false);
        expect(ConfigManager.isValidUrl(null)).toBe(false);
        expect(ConfigManager.isValidUrl(undefined)).toBe(false);
      });

      test('should recognize supported development hosts only', () => {
        expect(ConfigManager.isDevelopmentHost('localhost')).toBe(true);
        expect(ConfigManager.isDevelopmentHost('127.0.0.1')).toBe(true);
        expect(ConfigManager.isDevelopmentHost('[::1]')).toBe(true);
        expect(ConfigManager.isDevelopmentHost(undefined)).toBe(false);
      });
    });

    describe('validateSettings', () => {
      test('should return valid for correct settings', async () => {
        const settings = {
          redmineUrl: 'https://redmine.example.com',
          checkInterval: 30,
          maxNotifications: 100
        };

        const result = await ConfigManager.validateSettings(settings);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      test('should return errors for invalid URL', async () => {
        const settings = {
          redmineUrl: 'invalid-url'
        };

        const result = await ConfigManager.validateSettings(settings);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('invalidUrlFormat');
      });

      test('should return errors for invalid check interval', async () => {
        // 0 is falsy so won't be validated
        const settings1 = { checkInterval: 1500 };
        let result = await ConfigManager.validateSettings(settings1);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Check interval must be between 1 and 1440 minutes');

        const settings2 = { checkInterval: -1 };
        result = await ConfigManager.validateSettings(settings2);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Check interval must be between 1 and 1440 minutes');
      });

      test('should return errors for invalid max notifications', async () => {
        // 0 is falsy so won't be validated
        const settings1 = { maxNotifications: 1001 };
        let result = await ConfigManager.validateSettings(settings1);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Max notifications must be between 1 and 1000');

        const settings2 = { maxNotifications: -1 };
        result = await ConfigManager.validateSettings(settings2);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Max notifications must be between 1 and 1000');
      });

      test('should handle multiple validation errors', async () => {
        const settings = {
          redmineUrl: 'invalid-url',
          maxNotifications: 1001  // checkInterval: 0 won't be validated since 0 is falsy
        };

        const result = await ConfigManager.validateSettings(settings);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(2);
        expect(result.errors).toContain('invalidUrlFormat');
        expect(result.errors).toContain('Max notifications must be between 1 and 1000');
      });

      test('should ignore missing fields', async () => {
        const settings = {};

        const result = await ConfigManager.validateSettings(settings);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('sanitizeConfig', () => {
      test('should only keep allowed configuration keys', () => {
        const config = {
          redmineUrl: 'https://example.com',
          apiKey: 'test-key',
          checkInterval: 30,
          maliciousKey: 'should-be-removed'
        };

        const sanitized = ConfigManager.sanitizeConfig(config);
        
        expect(sanitized.redmineUrl).toBe('https://example.com');
        expect(sanitized.apiKey).toBe('test-key');
        expect(sanitized.checkInterval).toBe(30);
        expect(sanitized.maliciousKey).toBeUndefined();
        expect(sanitized.hasOwnProperty('maliciousKey')).toBe(false);
      });

      test('should handle empty config object', () => {
        const sanitized = ConfigManager.sanitizeConfig({});
        expect(Object.keys(sanitized)).toHaveLength(0);
      });

      test('should handle null and undefined input', () => {
        expect(() => ConfigManager.sanitizeConfig(null)).toThrow();
        expect(() => ConfigManager.sanitizeConfig(undefined)).toThrow();
      });

      test('should keep all allowed keys', () => {
        const config = {
          redmineUrl: 'https://example.com',
          apiKey: 'test-key',
          checkInterval: 30,
          enableNotifications: true,
          enableSound: false,
          maxNotifications: 100,
          language: 'en',
          onlyMyProjects: true,
          includeWatchedIssues: false
        };

        const sanitized = ConfigManager.sanitizeConfig(config);
        expect(Object.keys(sanitized)).toHaveLength(9);
        expect(sanitized).toEqual(config);
      });
    });

    describe('validateRedmineUrl', () => {
      test('should reject insecure remote HTTP URLs', () => {
        expect(ConfigManager.validateRedmineUrl('http://redmine.example.com')).toEqual({
          valid: false,
          messageKey: 'httpsRequiredForRemoteUrls'
        });
      });

      test('should allow development HTTP URLs with warning metadata', () => {
        expect(ConfigManager.validateRedmineUrl('http://localhost:3000')).toEqual({
          valid: true,
          normalizedUrl: 'http://localhost:3000',
          originPattern: 'http://localhost:3000/*',
          requiresWarning: true,
          messageKey: 'insecureDevelopmentUrlWarning'
        });
      });
    });

    describe('splitSettingsBySensitivity', () => {
      test('should keep API key in local settings only', () => {
        const result = ConfigManager.splitSettingsBySensitivity({
          redmineUrl: 'https://redmine.example.com',
          apiKey: 'super-secret-key',
          language: 'en'
        });

        expect(result.syncSettings).toEqual({
          redmineUrl: 'https://redmine.example.com',
          language: 'en'
        });
        expect(result.localSettings).toEqual({
          apiKey: 'super-secret-key'
        });
      });
    });

    describe('redactSensitiveText', () => {
      test('should redact URLs and token-like values', () => {
        expect(
          ConfigManager.redactSensitiveText(
            'Request to https://redmine.example.com failed for token abcdefghijklmnopqrstuvwxyz'
          )
        ).toBe('Request to [URL] failed for token [KEY]');
      });

      test('should return empty string for non-string values', () => {
        expect(ConfigManager.redactSensitiveText(undefined)).toBe('');
      });
    });
  });

  describe('Cache Operations', () => {
    describe('setCache and getFromCache', () => {
      test('should store and retrieve cached values', () => {
        const key = 'test-key';
        const value = { data: 'test' };

        configManager.setCache(key, value);
        
        const retrieved = configManager.getFromCache(key);
        expect(retrieved).toEqual(value);
      });

      test('should return null for expired cache', () => {
        const key = 'test-key';
        const value = { data: 'test' };
        const shortTtl = 10; // 10ms

        configManager.setCache(key, value, shortTtl);
        
        // Wait for cache to expire
        return new Promise(resolve => {
          setTimeout(() => {
            const retrieved = configManager.getFromCache(key);
            expect(retrieved).toBeNull();
            resolve();
          }, 15);
        });
      });

      test('should clean expired cache entries', () => {
        const key = 'test-key';
        const value = { data: 'test' };
        const shortTtl = 10;

        configManager.setCache(key, value, shortTtl);
        expect(configManager.cache.has(key)).toBe(true);
        expect(configManager.cacheExpiry.has(key)).toBe(true);

        return new Promise(resolve => {
          setTimeout(() => {
            configManager.getFromCache(key); // This should clean expired entries
            expect(configManager.cache.has(key)).toBe(false);
            expect(configManager.cacheExpiry.has(key)).toBe(false);
            resolve();
          }, 15);
        });
      });
    });

    describe('clearSettingsCache', () => {
      test('should clear settings-related cache entries', () => {
        configManager.setCache('redmine-settings', { url: 'test' });
        configManager.setCache('notification-config', { enabled: true });
        configManager.setCache('language-prefs', { lang: 'en' });
        configManager.setCache('other-cache', { data: 'keep' });

        configManager.clearSettingsCache();

        expect(configManager.getFromCache('redmine-settings')).toBeNull();
        expect(configManager.getFromCache('notification-config')).toBeNull();
        expect(configManager.getFromCache('language-prefs')).toBeNull();
        expect(configManager.getFromCache('other-cache')).toEqual({ data: 'keep' });
      });
    });
  });

  describe('Chrome Storage Integration', () => {
    describe('getCachedSettings', () => {
      test('should return cached settings if available', async () => {
        const keys = ['redmineUrl', 'apiKey'];
        const cachedData = { redmineUrl: 'https://cached.com', apiKey: 'cached-key' };
        
        configManager.setCache(JSON.stringify(keys), cachedData);

        const result = await configManager.getCachedSettings(keys);
        expect(result).toEqual(cachedData);
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
      });

      test('should fetch from chrome storage when cache is empty', async () => {
        const keys = ['redmineUrl', 'apiKey'];
        const storageData = { redmineUrl: 'https://storage.com', apiKey: 'storage-key' };
        
        chrome.storage.sync.get.mockResolvedValue(storageData);

        const result = await configManager.getCachedSettings(keys);
        
        expect(chrome.storage.sync.get).toHaveBeenCalledWith(keys);
        expect(result).toEqual(storageData);
        
        // Should now be cached
        const cacheKey = JSON.stringify(keys);
        expect(configManager.getFromCache(cacheKey)).toEqual(storageData);
      });

      test('should handle chrome storage errors', async () => {
        const keys = ['redmineUrl'];
        const error = new Error('Storage error');
        
        chrome.storage.sync.get.mockRejectedValue(error);

        await expect(configManager.getCachedSettings(keys)).rejects.toThrow('Storage error');
      });
    });

    describe('setCachedSettings', () => {
      test('should save settings to chrome storage and clear cache', async () => {
        const settings = { redmineUrl: 'https://new.com', apiKey: 'new-key' };
        
        // Set some cache first
        configManager.setCache('redmine-test', 'old-data');
        configManager.setCache('notification-test', 'old-data');
        
        chrome.storage.sync.set.mockResolvedValue();

        await configManager.setCachedSettings(settings);
        
        expect(chrome.storage.sync.set).toHaveBeenCalledWith(settings);
        expect(configManager.getFromCache('redmine-test')).toBeNull();
        expect(configManager.getFromCache('notification-test')).toBeNull();
      });

      test('should handle chrome storage set errors', async () => {
        const settings = { redmineUrl: 'https://test.com' };
        const error = new Error('Storage set error');
        
        chrome.storage.sync.set.mockRejectedValue(error);

        await expect(configManager.setCachedSettings(settings)).rejects.toThrow('Storage set error');
      });
    });

    describe('migrateLegacyApiKey', () => {
      test('should move API key from sync storage to local storage', async () => {
        chrome.storage.sync.get.mockResolvedValue({ apiKey: 'legacy-api-key' });
        chrome.storage.local.get.mockResolvedValue({});
        chrome.storage.local.set.mockResolvedValue(undefined);
        chrome.storage.sync.remove.mockResolvedValue(undefined);

        const result = await ConfigManager.migrateLegacyApiKey();

        expect(result).toBe('legacy-api-key');
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ apiKey: 'legacy-api-key' });
        expect(chrome.storage.sync.remove).toHaveBeenCalledWith(['apiKey']);
      });

      test('should keep local API key and remove stale sync copy', async () => {
        chrome.storage.sync.get.mockResolvedValue({ apiKey: 'legacy-api-key' });
        chrome.storage.local.get.mockResolvedValue({ apiKey: 'local-api-key' });
        chrome.storage.sync.remove.mockResolvedValue(undefined);

        const result = await ConfigManager.migrateLegacyApiKey();

        expect(result).toBe('local-api-key');
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        expect(chrome.storage.sync.remove).toHaveBeenCalledWith(['apiKey']);
      });

      test('should return empty string when no API key exists in either storage area', async () => {
        chrome.storage.sync.get.mockResolvedValue({});
        chrome.storage.local.get.mockResolvedValue({});

        const result = await ConfigManager.migrateLegacyApiKey();

        expect(result).toBe('');
        expect(chrome.storage.local.set).not.toHaveBeenCalled();
        expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
      });

      test('should return empty string when chrome storage is unavailable', async () => {
        const originalChrome = global.chrome;
        global.chrome = undefined;

        await expect(ConfigManager.migrateLegacyApiKey()).resolves.toBe('');

        global.chrome = originalChrome;
      });
    });
  });

  describe('Browser export path', () => {
    test('should attach ConfigManager to globalThis when module exports are unavailable', () => {
      const filePath = path.join(__dirname, 'config-manager.js');
      const source = fs.readFileSync(filePath, 'utf8');
      const sandbox = {
        chrome: global.chrome,
        globalThis: {}
      };

      vm.runInNewContext(source, sandbox, {
        filename: filePath
      });

      expect(typeof sandbox.globalThis.ConfigManager).toBe('function');
      expect(sandbox.globalThis.configManager).toBeInstanceOf(sandbox.globalThis.ConfigManager);
    });
  });
});
