(function initializeDiagnosticSnapshot(root, factory) {
  const exports = factory();

  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    Object.assign(root, exports);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDiagnosticSnapshotExports() {
  const DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION = 1;
  const DIAGNOSTICS_SCHEMA_VERSION = 1;
  const MAX_DIAGNOSTIC_EVENTS = 100;
  const DIAGNOSTIC_RETENTION_DAYS = 7;
  const SAFE_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
  const SAFE_REQUIRED_PERMISSIONS = new Set(['alarms', 'background', 'notifications', 'storage']);
  const SAFE_ERROR_CODES = new Set([
    'missingRequiredSettings',
    'syncFailed',
    'rateLimited',
    'rateLimitRetryExceeded',
    'hostPermissionRequired',
    'connectionTimeout',
    'networkError',
    'unknown'
  ]);
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
  const PROHIBITED_KEYS = new Set([
    'apikey',
    'token',
    'url',
    'hostname',
    'serverscope',
    'bindingid',
    'profileid',
    'issueid',
    'issuetitle',
    'comment',
    'projectname',
    'username',
    'requestheaders',
    'responsebody',
    'rawerror',
    'stack'
  ]);
  const URL_VALUE_PATTERN = /\b(?:https?|chrome-extension):\/\/\S+/i;
  const HOST_VALUE_PATTERN = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|test|local|internal|example)\b/i;
  const SECRET_VALUE_PATTERN = /\b(?:bearer|authorization|api[_ -]?key|token)\b/i;

  class DiagnosticSafetyError extends Error {
    constructor() {
      super('diagnosticsUnsafe');
      this.code = 'diagnosticsUnsafe';
    }
  }

  function assertSafe(condition) {
    if (!condition) {
      throw new DiagnosticSafetyError();
    }
  }

  function assertExactKeys(value, keys) {
    assertSafe(value && typeof value === 'object' && !Array.isArray(value));
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    assertSafe(actual.length === expected.length);
    assertSafe(actual.every((key, index) => key === expected[index]));
    assertSafe(actual.every(key => !PROHIBITED_KEYS.has(key.toLowerCase())));
  }

  function isIsoTimestampOrNull(value) {
    if (value === null) return true;
    if (typeof value !== 'string') return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString() === value;
  }

  function isSafeCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function isSafePrimitive(value) {
    if (typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'string' || value.length > 120) return false;
    if (value === '[REDACTED]') return true;
    return /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value)
      && !URL_VALUE_PATTERN.test(value)
      && !HOST_VALUE_PATTERN.test(value)
      && !SECRET_VALUE_PATTERN.test(value);
  }

  function validateDiagnosticEvent(event) {
    assertExactKeys(event, ['schemaVersion', 'timestamp', 'level', 'code', 'metadata']);
    assertSafe(event.schemaVersion === DIAGNOSTICS_SCHEMA_VERSION);
    assertSafe(isIsoTimestampOrNull(event.timestamp) && event.timestamp !== null);
    assertSafe(SAFE_LEVELS.has(event.level));
    assertSafe(typeof event.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(event.code));
    assertSafe(event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata));
    Object.entries(event.metadata).forEach(([key, value]) => {
      assertSafe(SAFE_METADATA_KEYS.has(key));
      assertSafe(!PROHIBITED_KEYS.has(key.toLowerCase()));
      assertSafe(isSafePrimitive(value));
    });
  }

  function validateDiagnosticSnapshot(snapshot) {
    assertExactKeys(snapshot, [
      'schemaVersion',
      'generatedAt',
      'extension',
      'configuration',
      'permissions',
      'alarms',
      'sync',
      'schemas',
      'profile',
      'counts',
      'diagnostics',
      'events'
    ]);
    assertSafe(snapshot.schemaVersion === DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION);
    assertSafe(isIsoTimestampOrNull(snapshot.generatedAt) && snapshot.generatedAt !== null);

    assertExactKeys(snapshot.extension, ['version', 'manifestVersion']);
    assertSafe(typeof snapshot.extension.version === 'string' && /^[0-9A-Za-z.+-]{1,32}$/.test(snapshot.extension.version));
    assertSafe(snapshot.extension.manifestVersion === 3);

    assertExactKeys(snapshot.configuration, ['redmineConfigured', 'apiKeyConfigured', 'transportScheme']);
    assertSafe(typeof snapshot.configuration.redmineConfigured === 'boolean');
    assertSafe(typeof snapshot.configuration.apiKeyConfigured === 'boolean');
    assertSafe(['http', 'https', null].includes(snapshot.configuration.transportScheme));

    assertExactKeys(snapshot.permissions, ['required', 'configuredHostAccessGranted']);
    assertSafe(Array.isArray(snapshot.permissions.required));
    assertSafe(snapshot.permissions.required.length <= SAFE_REQUIRED_PERMISSIONS.size);
    assertSafe(new Set(snapshot.permissions.required).size === snapshot.permissions.required.length);
    assertSafe(snapshot.permissions.required.every(permission => SAFE_REQUIRED_PERMISSIONS.has(permission)));
    assertSafe(typeof snapshot.permissions.configuredHostAccessGranted === 'boolean');

    assertExactKeys(snapshot.alarms, ['periodic', 'retry']);
    assertExactKeys(snapshot.alarms.periodic, ['exists', 'periodMinutes']);
    assertSafe(typeof snapshot.alarms.periodic.exists === 'boolean');
    assertSafe(
      snapshot.alarms.periodic.periodMinutes === null
      || (Number.isFinite(snapshot.alarms.periodic.periodMinutes) && snapshot.alarms.periodic.periodMinutes >= 0)
    );
    assertExactKeys(snapshot.alarms.retry, ['exists', 'scheduledAt']);
    assertSafe(typeof snapshot.alarms.retry.exists === 'boolean');
    assertSafe(isIsoTimestampOrNull(snapshot.alarms.retry.scheduledAt));

    assertExactKeys(snapshot.sync, [
      'lastSuccessAt',
      'stale',
      'lastErrorCode',
      'retryScheduled',
      'nextRetryAt'
    ]);
    assertSafe(isIsoTimestampOrNull(snapshot.sync.lastSuccessAt));
    assertSafe(typeof snapshot.sync.stale === 'boolean');
    assertSafe(snapshot.sync.lastErrorCode === null || SAFE_ERROR_CODES.has(snapshot.sync.lastErrorCode));
    assertSafe(typeof snapshot.sync.retryScheduled === 'boolean');
    assertSafe(isIsoTimestampOrNull(snapshot.sync.nextRetryAt));

    assertExactKeys(snapshot.schemas, ['profileState', 'diagnostics']);
    assertSafe(snapshot.schemas.profileState === 1);
    assertSafe(snapshot.schemas.diagnostics === DIAGNOSTICS_SCHEMA_VERSION);

    assertExactKeys(snapshot.profile, ['active', 'serverFingerprint']);
    assertSafe(typeof snapshot.profile.active === 'boolean');
    if (snapshot.profile.active) {
      assertSafe(/^[a-f0-9]{16}$/.test(snapshot.profile.serverFingerprint));
    } else {
      assertSafe(snapshot.profile.serverFingerprint === null);
    }

    assertExactKeys(snapshot.counts, [
      'history',
      'unread',
      'issueStates',
      'desktopMappings',
      'retainedEvents'
    ]);
    Object.values(snapshot.counts).forEach(count => assertSafe(isSafeCount(count)));
    assertSafe(snapshot.counts.unread <= snapshot.counts.history);

    assertExactKeys(snapshot.diagnostics, ['enabled', 'maxEvents', 'retentionDays']);
    assertSafe(typeof snapshot.diagnostics.enabled === 'boolean');
    assertSafe(snapshot.diagnostics.maxEvents === MAX_DIAGNOSTIC_EVENTS);
    assertSafe(snapshot.diagnostics.retentionDays === DIAGNOSTIC_RETENTION_DAYS);

    assertSafe(Array.isArray(snapshot.events) && snapshot.events.length <= MAX_DIAGNOSTIC_EVENTS);
    assertSafe(snapshot.diagnostics.enabled || snapshot.events.length === 0);
    assertSafe(snapshot.counts.retainedEvents === snapshot.events.length);
    snapshot.events.forEach(validateDiagnosticEvent);
    return true;
  }

  function toIsoTimestamp(value) {
    if (value === null || value === undefined) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function normalizeSafeErrorCode(value) {
    return SAFE_ERROR_CODES.has(value) ? value : (value ? 'unknown' : null);
  }

  class DiagnosticSnapshotBuilder {
    constructor({
      chrome,
      notificationService,
      profileRepository,
      eventStore,
      periodicAlarmName,
      retryAlarmName,
      now = Date.now,
      cryptoApi = globalThis.crypto
    } = {}) {
      this.chrome = chrome;
      this.notificationService = notificationService;
      this.profileRepository = profileRepository;
      this.eventStore = eventStore;
      this.periodicAlarmName = periodicAlarmName;
      this.retryAlarmName = retryAlarmName;
      this.now = now;
      this.crypto = cryptoApi;
    }

    async getAlarm(name) {
      return new Promise(resolve => {
        let settled = false;
        const finish = alarm => {
          if (settled) return;
          settled = true;
          resolve(alarm || null);
        };
        try {
          const maybePromise = this.chrome.alarms.get(name, finish);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(finish).catch(() => finish(null));
          }
        } catch {
          finish(null);
        }
      });
    }

    async createServerFingerprint(bindingId, serverScope) {
      if (!bindingId || !serverScope) {
        return null;
      }
      if (!this.crypto?.subtle) {
        throw new DiagnosticSafetyError();
      }
      const input = new TextEncoder().encode(
        `mewmew-diagnostic-server-v1\n${bindingId}\n${serverScope}`
      );
      const digest = await this.crypto.subtle.digest('SHA-256', input);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
    }

    async build() {
      const [
        configuration,
        configuredHostAccessGranted,
        profileState,
        periodicAlarm,
        retryAlarm,
        events
      ] = await Promise.all([
        this.notificationService.getDiagnosticConfiguration(),
        this.notificationService.getConfiguredHostAccessGranted(),
        this.profileRepository.getDiagnosticSummary(),
        this.getAlarm(this.periodicAlarmName),
        this.getAlarm(this.retryAlarmName),
        this.eventStore.getEvents()
      ]);
      const manifest = this.chrome.runtime.getManifest();
      const serverFingerprint = await this.createServerFingerprint(
        profileState.bindingId,
        profileState.serverScope
      );
      const syncHealth = profileState.syncHealth || {};
      const nextRetryAt = toIsoTimestamp(
        syncHealth.retry?.nextAttemptAt ?? retryAlarm?.scheduledTime
      );
      const safeEvents = this.eventStore.isEnabled() ? events : [];
      const snapshot = {
        schemaVersion: DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION,
        generatedAt: new Date(this.now()).toISOString(),
        extension: {
          version: manifest.version,
          manifestVersion: manifest.manifest_version
        },
        configuration,
        permissions: {
          required: (manifest.permissions || [])
            .filter(permission => SAFE_REQUIRED_PERMISSIONS.has(permission))
            .sort(),
          configuredHostAccessGranted
        },
        alarms: {
          periodic: {
            exists: Boolean(periodicAlarm),
            periodMinutes: Number.isFinite(periodicAlarm?.periodInMinutes)
              ? periodicAlarm.periodInMinutes
              : null
          },
          retry: {
            exists: Boolean(retryAlarm),
            scheduledAt: toIsoTimestamp(retryAlarm?.scheduledTime)
          }
        },
        sync: {
          lastSuccessAt: toIsoTimestamp(syncHealth.lastSuccessAt),
          stale: syncHealth.stale === true,
          lastErrorCode: normalizeSafeErrorCode(syncHealth.lastErrorCode),
          retryScheduled: Boolean(syncHealth.retry || retryAlarm),
          nextRetryAt
        },
        schemas: {
          profileState: profileState.schemaVersion,
          diagnostics: DIAGNOSTICS_SCHEMA_VERSION
        },
        profile: {
          active: profileState.active === true,
          serverFingerprint
        },
        counts: {
          history: profileState.counts.history,
          unread: profileState.counts.unread,
          issueStates: profileState.counts.issueStates,
          desktopMappings: profileState.counts.desktopMappings,
          retainedEvents: safeEvents.length
        },
        diagnostics: {
          enabled: this.eventStore.isEnabled(),
          maxEvents: MAX_DIAGNOSTIC_EVENTS,
          retentionDays: DIAGNOSTIC_RETENTION_DAYS
        },
        events: safeEvents
      };
      validateDiagnosticSnapshot(snapshot);
      return snapshot;
    }
  }

  return {
    DIAGNOSTIC_SNAPSHOT_SCHEMA_VERSION,
    SAFE_ERROR_CODES,
    DiagnosticSafetyError,
    DiagnosticSnapshotBuilder,
    normalizeSafeErrorCode,
    toIsoTimestamp,
    validateDiagnosticSnapshot
  };
});
