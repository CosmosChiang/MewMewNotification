## Context

`background.js` currently combines Redmine transport, request queuing, retry and timeout behavior, synchronization, notification policy, persistence, desktop actions, runtime routing, and Chrome event registration. Options and Popup similarly combine view state, Chrome calls, localization, and rendering. The three controllers duplicate language loading and translation while the existing `I18nManager` remains largely unused.

Fake Redmine integration tests evaluate the entire service-worker source in a VM just to access `RedmineAPI`. That also constructs `NotificationManager`, starts settings and locale loading, and repairs alarms, producing `chrome is not defined` and invalid locale URL errors even though the three target assertions pass.

The extension must remain a dependency-free classic Manifest V3 runtime. Listener registration must remain synchronous at service-worker evaluation time, and the refactor must preserve version 1.5.0 storage, message, synchronization, and notification behavior.

## Goals / Non-Goals

**Goals:**

- Establish narrow runtime modules with explicit dependencies and no import-time effects.
- Reduce `background.js` to composition and synchronous Chrome event registration.
- Share one localization implementation across background, Options, and Popup.
- Replace free-form console output with redacted structured logging.
- Test Redmine transport and pure notification policy without evaluating unrelated Chrome bootstrap code.
- Raise coverage while testing meaningful module behavior.

**Non-Goals:**

- Converting the service worker or extension pages to ESM.
- Changing runtime message action names or response compatibility.
- Changing Redmine API behavior, storage keys, sync algorithms, UI layout, or notification policy.
- Adding the diagnostics UI or persistence; `add-sanitized-diagnostics` will consume the logger's opt-in sink.
- Introducing a bundler, TypeScript, or runtime npm dependency.

## Decisions

### Use classic dual-export scripts

Every extracted runtime file exposes named values through `globalThis` when loaded by `importScripts` or a page script and through `module.exports` under Jest. Imports only define classes, factories, constants, and pure functions.

Alternative considered: ESM service workers and page modules. This would simplify imports but expands the migration surface and changes testing and packaging simultaneously, so it is deferred.

### Split the background runtime by responsibility

Create the following modules:

- `scripts/background/redmine-api.js`: request queue, rate limiting, bounded retry, timeout, endpoint validation, pagination, capability discovery, and issue mutation.
- `scripts/background/notification-policy.js`: snapshot normalization, change summaries, category classification, project eligibility, quiet-hours evaluation, and bundling calculations as pure functions.
- `scripts/background/profile-state-repository.js`: typed access to profile history, read/seen IDs, issue states, cursor, project cache, sync health, and desktop mappings.
- `scripts/background/notification-service.js`: single-flight synchronization and use-case orchestration through injected API, repository, policy, Chrome adapter, clock, and logger.
- `scripts/background/runtime-router.js`: action constants, request validation, handler dispatch, safe error mapping, and response envelopes.
- `scripts/background/runtime-bootstrap.js`: synchronous registration functions for runtime, alarm, storage, notification, install, and startup events.

`background.js` imports these files in dependency order, builds one runtime, registers listeners synchronously, and then starts allowed asynchronous initialization such as alarm repair. No extracted module constructs a manager, reads storage, registers a listener, creates an alarm, or calls fetch while loading.

### Preserve runtime contracts during extraction

Existing message action strings remain unchanged. Request validation moves into the router, but successful response fields and safe error codes remain compatible with Popup and Options. Existing storage keys and profile schemas are not renamed.

Each extraction step first characterizes current behavior with tests, moves one responsibility, and reruns the full Jest suite. This reduces the chance of combining structural movement with behavior changes.

### Inject environmental dependencies

Transport receives fetch, abort, timers, clock, and logger. Repositories receive storage and profile manager. Services receive Chrome adapters rather than reading global `chrome` from domain logic. Test defaults are supplied explicitly; production composition supplies browser globals.

Alternative considered: keep global fallbacks inside each module. That is convenient but would preserve hidden dependencies and recreate the current integration-test problem.

### Make I18nManager context neutral

`I18nManager` accepts storage, fetch, locale URL resolver, optional document root, and logger. It handles language selection, English fallback, substitution, and document `lang`. It exports through `globalThis`, not `window`, so service workers can use it.

Popup, Options, and background own only their element-to-key mappings and call the shared manager for loading and translation. Locale fetch failure returns a deterministic empty English state after one fallback attempt and records a safe error code.

### Use structured allowlisted logging

`SafeLogger` accepts event codes and allowlisted primitive metadata. It redacts URL-like strings, token-like strings, server/profile identifiers, response bodies, issue content, and raw error stacks before any output.

Default production behavior emits sanitized `warn` and `error` events to the console and suppresses `debug` and `info`. The logger exposes an injected `isDebugEnabled` predicate and `eventSink`; only when the predicate returns true does it send sanitized structured events to the sink. Until diagnostics is implemented, production composition uses `false` and a no-op sink.

Free-form server response bodies and request headers are never logger input. Transport converts failures into stable error codes and selected safe status metadata first.

## Risks / Trade-offs

- [Large mechanical refactor changes behavior] → Move one module at a time, preserve public contracts, and run the complete suite after each extraction.
- [Classic global exports collide or load in the wrong order] → Use explicit unique export names, a fixed import list, package validation, and Chromium smoke coverage.
- [Stricter request validation breaks a current caller] → Characterize every existing action request and response before moving the router.
- [Redaction removes useful troubleshooting context] → Retain safe event codes, timestamps, counts, durations, and booleans; the diagnostics change can persist the same sanitized events.
- [Coverage target encourages shallow tests] → Apply high thresholds only to extracted pure modules and use the global 65% floor for the complete runtime.

## Migration Plan

1. Add `SafeLogger` and context-neutral `I18nManager`, then migrate background, Options, and Popup.
2. Extract `RedmineAPI` and switch Fake Redmine tests to direct module loading.
3. Extract pure notification policy and profile repository.
4. Extract notification service and runtime router while preserving action contracts.
5. Move Chrome listener wiring to bootstrap helpers and reduce `background.js` to composition.
6. Update import order, package allowlist, coverage configuration, and architecture documentation.
7. Run unit, integration, smoke, package, and OpenSpec verification after every extraction stage.

Rollback is performed by reverting the refactor commits in reverse order; storage and message schemas remain compatible throughout.

## Open Questions

None.
