const {
  EVENT_SCHEMA_VERSION,
  SafeLogger,
  normalizeEventCode,
  sanitizeMetadata
} = require('./safe-logger.js');

describe('SafeLogger', () => {
  test('suppresses debug and info console output by default', () => {
    const consoleAdapter = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    const sink = jest.fn();
    const logger = new SafeLogger({ consoleAdapter, eventSink: sink });

    logger.debug('sync_completed', { count: 3 });
    logger.info('runtime_ready', { success: true });
    logger.warn('runtime_warning', { changed: false });

    expect(consoleAdapter.debug).not.toHaveBeenCalled();
    expect(consoleAdapter.info).not.toHaveBeenCalled();
    expect(consoleAdapter.warn).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      code: 'runtime_warning'
    }));
    expect(sink).not.toHaveBeenCalled();
  });

  test('emits structured sanitized warning and error events', () => {
    const consoleAdapter = {
      warn: jest.fn(),
      error: jest.fn()
    };
    const logger = new SafeLogger({
      consoleAdapter,
      clock: () => '2026-07-17T00:00:00.000Z'
    });

    logger.error('Request failed https://secret.example/issues/42', {
      status: 500,
      token: 'secret-token-value-abcdefghijklmnopqrstuvwxyz',
      responseBody: 'private response',
      count: 2
    });

    expect(consoleAdapter.error).toHaveBeenCalledWith({
      schemaVersion: EVENT_SCHEMA_VERSION,
      timestamp: '2026-07-17T00:00:00.000Z',
      level: 'error',
      code: 'request_failed_redacted',
      metadata: {
        status: 500,
        count: 2
      }
    });
    expect(JSON.stringify(consoleAdapter.error.mock.calls)).not.toContain('secret.example');
    expect(JSON.stringify(consoleAdapter.error.mock.calls)).not.toContain('private response');
  });

  test('sends only sanitized events to an opt-in sink', () => {
    const sink = jest.fn();
    const logger = new SafeLogger({
      consoleAdapter: {},
      isDebugEnabled: () => true,
      eventSink: sink,
      clock: () => 'fixed'
    });

    logger.debug('profile_123456_event', {
      trigger: 'popup',
      profileId: 'profile-secret',
      durationMs: 25
    });

    expect(sink).toHaveBeenCalledWith({
      schemaVersion: EVENT_SCHEMA_VERSION,
      timestamp: 'fixed',
      level: 'debug',
      code: 'profile_n_event',
      metadata: {
        trigger: 'popup',
        durationMs: 25
      }
    });
  });

  test('normalizes unsafe event codes and metadata primitives', () => {
    const longText = 'x '.repeat(61);
    expect(normalizeEventCode('')).toBe('runtime_event');
    expect(sanitizeMetadata(null)).toEqual({});
    expect(sanitizeMetadata({
      count: 1,
      success: true,
      operation: 'refresh',
      unknown: 'ignored',
      issueTitle: 'secret'
    })).toEqual({
      count: 1,
      success: true,
      operation: 'refresh'
    });
    expect(sanitizeMetadata([])).toEqual({});
    expect(sanitizeMetadata({
      status: { raw: 'object' },
      action: 'https://private.example/action',
      language: longText,
      trigger: 'abcdefghijklmnopqrstuvwxyz123456'
    })).toEqual({
      action: '[REDACTED]',
      language: `${longText.slice(0, 117)}...`,
      trigger: '[REDACTED]'
    });
  });

  test('isolates synchronous and asynchronous diagnostic sink failures', async () => {
    const rejected = Promise.reject(new Error('storage failed'));
    const asynchronous = new SafeLogger({
      consoleAdapter: {},
      isDebugEnabled: () => true,
      eventSink: jest.fn(() => rejected)
    });
    expect(() => asynchronous.info('event_one')).not.toThrow();
    await expect(rejected).rejects.toThrow('storage failed');

    const synchronous = new SafeLogger({
      consoleAdapter: {},
      isDebugEnabled: () => true,
      eventSink: jest.fn(() => {
        throw new Error('sink failed');
      })
    });
    expect(() => synchronous.error('event_two')).not.toThrow();
  });
});
