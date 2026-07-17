(function initializeDiagnosticEventStore(root, factory) {
  const exports = factory();

  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    Object.assign(root, exports);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDiagnosticEventStoreExports() {
  const DIAGNOSTICS_SCHEMA_VERSION = 1;
  const DIAGNOSTICS_ENABLED_KEY = 'diagnosticsEnabledV1';
  const DIAGNOSTIC_EVENTS_KEY = 'diagnosticEventsV1';
  const DIAGNOSTIC_RETENTION_DAYS = 7;
  const DIAGNOSTIC_RETENTION_MS = DIAGNOSTIC_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const MAX_DIAGNOSTIC_EVENTS = 100;
  const SAFE_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
  const SAFE_METADATA_KEYS = new Set([
    'action',
    'attempt',
    'changed',
    'configured',
    'count',
    'durationMs',
    'errorCode',
    'granted',
    'language',
    'level',
    'operation',
    'periodMinutes',
    'retryScheduled',
    'status',
    'success',
    'trigger'
  ]);

  function normalizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return Object.fromEntries(Object.entries(metadata)
      .filter(([key, value]) => (
        SAFE_METADATA_KEYS.has(key)
        && (
          typeof value === 'boolean'
          || (typeof value === 'number' && Number.isFinite(value))
          || (typeof value === 'string' && value.length <= 120)
        )
      )));
  }

  function normalizeDiagnosticEvent(event) {
    if (!event || typeof event !== 'object') {
      return undefined;
    }
    const timestamp = new Date(event.timestamp);
    if (
      event.schemaVersion !== DIAGNOSTICS_SCHEMA_VERSION
      || Number.isNaN(timestamp.getTime())
      || !SAFE_LEVELS.has(event.level)
      || typeof event.code !== 'string'
      || !/^[a-z][a-z0-9_]{0,79}$/.test(event.code)
    ) {
      return undefined;
    }

    return {
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      timestamp: timestamp.toISOString(),
      level: event.level,
      code: event.code,
      metadata: normalizeMetadata(event.metadata)
    };
  }

  function pruneDiagnosticEvents(events, now = Date.now()) {
    const cutoff = now - DIAGNOSTIC_RETENTION_MS;
    return (Array.isArray(events) ? events : [])
      .map(normalizeDiagnosticEvent)
      .filter(Boolean)
      .filter(event => new Date(event.timestamp).getTime() >= cutoff)
      .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp))
      .slice(-MAX_DIAGNOSTIC_EVENTS);
  }

  class DiagnosticEventStore {
    constructor({ storageArea, now = Date.now } = {}) {
      if (!storageArea) {
        throw new Error('diagnosticStorageRequired');
      }
      this.storageArea = storageArea;
      this.now = now;
      this.enabled = false;
      this.initialized = false;
      this.writeQueue = Promise.resolve();
    }

    serialize(operation) {
      const result = this.writeQueue.then(operation, operation);
      this.writeQueue = result.catch(() => {});
      return result;
    }

    async initialize() {
      return this.serialize(async () => {
        const stored = await this.storageArea.get([
          DIAGNOSTICS_ENABLED_KEY,
          DIAGNOSTIC_EVENTS_KEY
        ]);
        this.enabled = stored?.[DIAGNOSTICS_ENABLED_KEY] === true;
        this.initialized = true;

        if (!this.enabled) {
          if (stored?.[DIAGNOSTIC_EVENTS_KEY] !== undefined) {
            await this.storageArea.remove([DIAGNOSTIC_EVENTS_KEY]);
          }
          return [];
        }

        const retained = pruneDiagnosticEvents(
          stored?.[DIAGNOSTIC_EVENTS_KEY],
          this.now()
        );
        if (retained.length === 0) {
          if (stored?.[DIAGNOSTIC_EVENTS_KEY] !== undefined) {
            await this.storageArea.remove([DIAGNOSTIC_EVENTS_KEY]);
          }
        } else if (JSON.stringify(retained) !== JSON.stringify(stored?.[DIAGNOSTIC_EVENTS_KEY])) {
          await this.storageArea.set({ [DIAGNOSTIC_EVENTS_KEY]: retained });
        }
        return retained;
      });
    }

    isEnabled() {
      return this.enabled === true;
    }

    handleStorageChanged(changes, namespace) {
      if (namespace !== 'local' || !changes?.[DIAGNOSTICS_ENABLED_KEY]) {
        return;
      }
      this.enabled = changes[DIAGNOSTICS_ENABLED_KEY].newValue === true;
    }

    async setEnabled(enabled) {
      return this.serialize(async () => {
        this.enabled = enabled === true;
        await this.storageArea.set({ [DIAGNOSTICS_ENABLED_KEY]: this.enabled });
        if (!this.enabled) {
          await this.storageArea.remove([DIAGNOSTIC_EVENTS_KEY]);
        }
        return this.enabled;
      });
    }

    async clearEvents() {
      return this.serialize(async () => {
        await this.storageArea.remove([DIAGNOSTIC_EVENTS_KEY]);
      });
    }

    async append(event) {
      if (!this.isEnabled()) {
        return false;
      }
      const normalized = normalizeDiagnosticEvent(event);
      if (!normalized) {
        return false;
      }

      return this.serialize(async () => {
        const stored = await this.storageArea.get([
          DIAGNOSTICS_ENABLED_KEY,
          DIAGNOSTIC_EVENTS_KEY
        ]);
        this.enabled = stored?.[DIAGNOSTICS_ENABLED_KEY] === true;
        if (!this.enabled) {
          await this.storageArea.remove([DIAGNOSTIC_EVENTS_KEY]);
          return false;
        }
        const retained = pruneDiagnosticEvents([
          ...(Array.isArray(stored?.[DIAGNOSTIC_EVENTS_KEY])
            ? stored[DIAGNOSTIC_EVENTS_KEY]
            : []),
          normalized
        ], this.now());
        await this.storageArea.set({ [DIAGNOSTIC_EVENTS_KEY]: retained });
        return true;
      });
    }

    async getEvents() {
      return this.serialize(async () => {
        if (!this.isEnabled()) {
          return [];
        }
        const stored = await this.storageArea.get([DIAGNOSTIC_EVENTS_KEY]);
        const original = stored?.[DIAGNOSTIC_EVENTS_KEY];
        const retained = pruneDiagnosticEvents(original, this.now());
        if (retained.length === 0) {
          if (original !== undefined) {
            await this.storageArea.remove([DIAGNOSTIC_EVENTS_KEY]);
          }
        } else if (JSON.stringify(retained) !== JSON.stringify(original)) {
          await this.storageArea.set({ [DIAGNOSTIC_EVENTS_KEY]: retained });
        }
        return retained;
      });
    }
  }

  return {
    DIAGNOSTICS_SCHEMA_VERSION,
    DIAGNOSTICS_ENABLED_KEY,
    DIAGNOSTIC_EVENTS_KEY,
    DIAGNOSTIC_RETENTION_DAYS,
    MAX_DIAGNOSTIC_EVENTS,
    DiagnosticEventStore,
    normalizeDiagnosticEvent,
    pruneDiagnosticEvents
  };
});
