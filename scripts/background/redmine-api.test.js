const { ConfigManager } = require('../shared/config-manager.js');
const { RedmineAPI } = require('./redmine-api.js');

function createApi(fetchImplementation = jest.fn()) {
  return new RedmineAPI('https://redmine.example.test', 'valid-api-key-123', {
    fetch: fetchImplementation,
    AbortController,
    setTimeout,
    clearTimeout,
    ConfigManagerClass: ConfigManager,
    logger: {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  });
}

describe('RedmineAPI module', () => {
  test('validates constructor input and API endpoints', () => {
    expect(() => new RedmineAPI('ftp://example.test', 'valid-api-key-123', {
      ConfigManagerClass: ConfigManager
    })).toThrow('urlMustBeHttpOrHttps');
    expect(() => new RedmineAPI('https://example.test', null, {
      ConfigManagerClass: ConfigManager
    })).toThrow();
    const api = createApi();
    expect(api.validateApiEndpoint('/issues.json')).toBe(true);
    expect(() => api.validateApiEndpoint('/admin/users.json')).toThrow();
    expect(api.validateApiParams({
      limit: 50,
      status_id: '*',
      unknown: 'value'
    })).toEqual({
      limit: 50,
      status_id: 'open',
      unknown: 'value'
    });
  });

  test('uses injected transport and returns parsed JSON', async () => {
    const fetchImplementation = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('{"user":{"id":1}}')
    });
    const api = createApi(fetchImplementation);
    api.minRequestInterval = 0;

    await expect(api.getCurrentUser()).resolves.toEqual({ id: 1 });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://redmine.example.test/users/current.json',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Redmine-API-Key': 'valid-api-key-123'
        }),
        signal: expect.any(Object)
      })
    );
  });

  test('maps HTTP authentication failures without exposing credentials', async () => {
    const api = createApi(jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: jest.fn().mockResolvedValue('private response body')
    }));
    api.minRequestInterval = 0;

    await expect(api.getCurrentUser()).rejects.toThrow('Authentication failed');
  });

  test('bounds cache entries and clears them', () => {
    const api = createApi();
    api.maxCacheSize = 2;
    api.setCache('a', 1, 100);
    api.setCache('b', 2, 200);
    api.setCache('c', 3, 300);
    expect(api.cache.size).toBe(2);
    expect(api.getFromCache('c')).toBe(3);
    api.clearCache();
    expect(api.cache.size).toBe(0);
  });
});
