(function initializeSafeLogger(root, factory) {
  const exports = factory();

  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    Object.assign(root, exports);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSafeLoggerExports() {
  const EVENT_SCHEMA_VERSION = 1;
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
  const SENSITIVE_KEY_PATTERN = /(api|authorization|body|credential|host|issue|key|profile|response|server|stack|subject|title|token|url|user)/i;
  const URL_PATTERN = /\b(?:https?|chrome-extension):\/\/\S+/gi;
  const TOKEN_PATTERN = /\b[A-Za-z0-9_-]{24,}\b/g;

  function normalizeEventCode(code) {
    const normalized = String(code || 'runtime_event')
      .replace(URL_PATTERN, 'redacted')
      .replace(TOKEN_PATTERN, 'redacted')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_\d+(?=_|$)/g, '_n')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
    return normalized || 'runtime_event';
  }

  function sanitizePrimitive(value) {
    if (typeof value === 'boolean' || typeof value === 'number') {
      return value;
    }

    if (typeof value !== 'string') {
      return undefined;
    }

    const redacted = value
      .replace(URL_PATTERN, '[REDACTED]')
      .replace(TOKEN_PATTERN, '[REDACTED]');
    return redacted.length > 120 ? `${redacted.slice(0, 117)}...` : redacted;
  }

  function sanitizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return Object.entries(metadata).reduce((safe, [key, value]) => {
      if (!SAFE_METADATA_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) {
        return safe;
      }

      const sanitized = sanitizePrimitive(value);
      if (sanitized !== undefined) {
        safe[key] = sanitized;
      }
      return safe;
    }, {});
  }

  class SafeLogger {
    constructor({
      consoleAdapter = typeof console !== 'undefined' ? console : undefined,
      clock = () => new Date().toISOString(),
      isDebugEnabled = () => false,
      eventSink = () => {}
    } = {}) {
      this.consoleAdapter = consoleAdapter;
      this.clock = clock;
      this.isDebugEnabled = isDebugEnabled;
      this.eventSink = eventSink;
    }

    createEvent(level, code, metadata) {
      return {
        schemaVersion: EVENT_SCHEMA_VERSION,
        timestamp: this.clock(),
        level,
        code: normalizeEventCode(code),
        metadata: sanitizeMetadata(metadata)
      };
    }

    emit(level, code, metadata) {
      const event = this.createEvent(level, code, metadata);

      if (level === 'warn' || level === 'error') {
        this.consoleAdapter?.[level]?.(event);
      }

      if (this.isDebugEnabled()) {
        try {
          const sinkResult = this.eventSink(event);
          sinkResult?.catch?.(() => {});
        } catch {
          // Diagnostic retention must never affect extension behavior.
        }
      }

      return event;
    }

    debug(code, metadata) {
      return this.emit('debug', code, metadata);
    }

    info(code, metadata) {
      return this.emit('info', code, metadata);
    }

    warn(code, metadata) {
      return this.emit('warn', code, metadata);
    }

    error(code, metadata) {
      return this.emit('error', code, metadata);
    }
  }

  return {
    EVENT_SCHEMA_VERSION,
    SafeLogger,
    normalizeEventCode,
    sanitizeMetadata
  };
});
