const {
  DIAGNOSTICS_ENABLED_KEY,
  DIAGNOSTIC_EVENTS_KEY,
  DIAGNOSTIC_RETENTION_DAYS,
  MAX_DIAGNOSTIC_EVENTS,
  DiagnosticEventStore,
  normalizeDiagnosticEvent,
  pruneDiagnosticEvents
} = require('./diagnostic-event-store.js');
const { SafeLogger } = require('./safe-logger.js');

function createStorage(initial = {}) {
  const state = { ...initial };
  return {
    state,
    get: jest.fn(async keys => Object.fromEntries(
      keys.filter(key => Object.prototype.hasOwnProperty.call(state, key))
        .map(key => [key, state[key]])
    )),
    set: jest.fn(async values => Object.assign(state, values)),
    remove: jest.fn(async keys => {
      (Array.isArray(keys) ? keys : [keys]).forEach(key => delete state[key]);
    })
  };
}

function eventAt(timestamp, overrides = {}) {
  return {
    schemaVersion: 1,
    timestamp: new Date(timestamp).toISOString(),
    level: 'info',
    code: 'sync_completed',
    metadata: { success: true },
    ...overrides
  };
}

describe('DiagnosticEventStore', () => {
  const now = Date.parse('2026-07-17T12:00:00.000Z');

  test('is disabled by default and removes unexpected retained events', async () => {
    const storage = createStorage({
      [DIAGNOSTIC_EVENTS_KEY]: [eventAt(now)]
    });
    const store = new DiagnosticEventStore({ storageArea: storage, now: () => now });

    await expect(store.initialize()).resolves.toEqual([]);
    expect(store.isEnabled()).toBe(false);
    expect(storage.state[DIAGNOSTIC_EVENTS_KEY]).toBeUndefined();
    await expect(store.append(eventAt(now))).resolves.toBe(false);
  });

  test('serializes concurrent appends without losing events', async () => {
    const storage = createStorage({ [DIAGNOSTICS_ENABLED_KEY]: true });
    const store = new DiagnosticEventStore({ storageArea: storage, now: () => now });
    await store.initialize();

    await Promise.all([
      store.append(eventAt(now - 2, { code: 'first_event' })),
      store.append(eventAt(now - 1, { code: 'second_event' })),
      store.append(eventAt(now, { code: 'third_event' }))
    ]);

    expect(storage.state[DIAGNOSTIC_EVENTS_KEY].map(event => event.code)).toEqual([
      'first_event',
      'second_event',
      'third_event'
    ]);
  });

  test('keeps the newest 100 events and the exact seven-day boundary', () => {
    const boundary = now - DIAGNOSTIC_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const events = [
      eventAt(boundary - 1, { code: 'expired_event' }),
      eventAt(boundary, { code: 'boundary_event' }),
      ...Array.from({ length: 105 }, (_, index) => (
        eventAt(now - 105 + index, { code: `event_${index}` })
      ))
    ];

    const retained = pruneDiagnosticEvents(events, now);
    expect(retained).toHaveLength(MAX_DIAGNOSTIC_EVENTS);
    expect(retained.some(event => event.code === 'expired_event')).toBe(false);
    expect(retained.at(-1).code).toBe('event_104');
  });

  test('clears events without disabling future capture', async () => {
    const storage = createStorage({
      [DIAGNOSTICS_ENABLED_KEY]: true,
      [DIAGNOSTIC_EVENTS_KEY]: [eventAt(now)]
    });
    const store = new DiagnosticEventStore({ storageArea: storage, now: () => now });
    await store.initialize();

    await store.clearEvents();
    expect(store.isEnabled()).toBe(true);
    expect(storage.state[DIAGNOSTIC_EVENTS_KEY]).toBeUndefined();
    await store.append(eventAt(now));
    expect(storage.state[DIAGNOSTIC_EVENTS_KEY]).toHaveLength(1);
  });

  test('disabling is destructive and rejects an already queued append', async () => {
    const storage = createStorage({ [DIAGNOSTICS_ENABLED_KEY]: true });
    const store = new DiagnosticEventStore({ storageArea: storage, now: () => now });
    await store.initialize();
    await store.append(eventAt(now));
    await store.setEnabled(false);

    expect(storage.state[DIAGNOSTICS_ENABLED_KEY]).toBe(false);
    expect(storage.state[DIAGNOSTIC_EVENTS_KEY]).toBeUndefined();
    await expect(store.append(eventAt(now))).resolves.toBe(false);
  });

  test('reacts only to the local enabled key and never touches sync storage', () => {
    const storage = createStorage();
    const store = new DiagnosticEventStore({ storageArea: storage, now: () => now });

    store.handleStorageChanged({ [DIAGNOSTICS_ENABLED_KEY]: { newValue: true } }, 'sync');
    expect(store.isEnabled()).toBe(false);
    store.handleStorageChanged({ other: { newValue: true } }, 'local');
    expect(store.isEnabled()).toBe(false);
    store.handleStorageChanged({ [DIAGNOSTICS_ENABLED_KEY]: { newValue: true } }, 'local');
    expect(store.isEnabled()).toBe(true);
  });

  test('rejects malformed or unsafe event shapes', () => {
    expect(() => new DiagnosticEventStore()).toThrow('diagnosticStorageRequired');
    expect(normalizeDiagnosticEvent(null)).toBeUndefined();
    expect(normalizeDiagnosticEvent(eventAt(now, { code: 'Unsafe Code!' }))).toBeUndefined();
    expect(normalizeDiagnosticEvent(eventAt(now, { timestamp: 'invalid' }))).toBeUndefined();
    expect(normalizeDiagnosticEvent(eventAt(now, { level: 'fatal' }))).toBeUndefined();
    expect(normalizeDiagnosticEvent(eventAt(now, {
      metadata: {
        success: true,
        apiKey: 'secret',
        count: Number.NaN,
        status: 'x'.repeat(121)
      }
    }))).toEqual(expect.objectContaining({
      metadata: { success: true }
    }));
  });

  test('captures only sanitized SafeLogger events while explicitly enabled', async () => {
    const storage = createStorage({ [DIAGNOSTICS_ENABLED_KEY]: true });
    const store = new DiagnosticEventStore({ storageArea: storage, now: () => now });
    await store.initialize();
    const logger = new SafeLogger({
      consoleAdapter: undefined,
      clock: () => new Date(now).toISOString(),
      isDebugEnabled: () => store.isEnabled(),
      eventSink: event => store.append(event)
    });

    logger.info('Request https://redmine.private.example/issues/9 failed', {
      status: 'https://redmine.private.example',
      apiKey: 'seeded-api-key-value',
      errorCode: 'syncFailed'
    });
    await store.writeQueue;
    expect(storage.state[DIAGNOSTIC_EVENTS_KEY]).toEqual([
      expect.objectContaining({
        code: 'request_redacted_failed',
        metadata: {
          status: '[REDACTED]',
          errorCode: 'syncFailed'
        }
      })
    ]);

    await store.setEnabled(false);
    logger.error('disabled_event', { errorCode: 'syncFailed' });
    await store.writeQueue;
    expect(storage.state[DIAGNOSTIC_EVENTS_KEY]).toBeUndefined();
  });

  test('prunes and rewrites retained state during initialization and inspection', async () => {
    const expired = eventAt(now - (8 * 24 * 60 * 60 * 1000));
    const recent = eventAt(now, { metadata: null });
    const storage = createStorage({
      [DIAGNOSTICS_ENABLED_KEY]: true,
      [DIAGNOSTIC_EVENTS_KEY]: [recent, expired]
    });
    const store = new DiagnosticEventStore({ storageArea: storage, now: () => now });

    await expect(store.initialize()).resolves.toEqual([
      expect.objectContaining({ metadata: {} })
    ]);
    expect(storage.set).toHaveBeenCalledWith({
      [DIAGNOSTIC_EVENTS_KEY]: [expect.objectContaining({ metadata: {} })]
    });
    await expect(store.getEvents()).resolves.toHaveLength(1);

    storage.state[DIAGNOSTIC_EVENTS_KEY] = [expired];
    await expect(store.getEvents()).resolves.toEqual([]);
    expect(storage.state[DIAGNOSTIC_EVENTS_KEY]).toBeUndefined();
  });

  test('removes an expired-only initialization and blocks disabled or malformed queued events', async () => {
    const expired = eventAt(now - (8 * 24 * 60 * 60 * 1000));
    const storage = createStorage({
      [DIAGNOSTICS_ENABLED_KEY]: true,
      [DIAGNOSTIC_EVENTS_KEY]: [expired]
    });
    const store = new DiagnosticEventStore({ storageArea: storage, now: () => now });
    await expect(store.initialize()).resolves.toEqual([]);
    expect(storage.state[DIAGNOSTIC_EVENTS_KEY]).toBeUndefined();

    await expect(store.append({ unsafe: true })).resolves.toBe(false);
    store.enabled = true;
    storage.state[DIAGNOSTICS_ENABLED_KEY] = false;
    await expect(store.append(eventAt(now))).resolves.toBe(false);
    expect(storage.state[DIAGNOSTIC_EVENTS_KEY]).toBeUndefined();

    await expect(store.getEvents()).resolves.toEqual([]);
  });
});
