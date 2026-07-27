# Extension runtime architecture

## Composition

`background.js` is the classic Manifest V3 composition root. It loads scripts with `importScripts` in this order:

1. `SafeLogger`, diagnostic event storage, `I18nManager`, configuration, and profile primitives.
2. Redmine transport and pure notification policy.
3. Profile repository and notification service.
4. Diagnostic snapshot construction, runtime router, and Chrome event bootstrap.

The composition root creates one logger, localization manager, profile repository, notification service, and router. It registers Chrome listeners synchronously and only then starts explicit asynchronous initialization and periodic-alarm repair. Imported runtime modules define exports only; they do not read storage, register listeners, create alarms, start timers, or fetch data.

## Module responsibilities

- `scripts/background/redmine-api.js`: validated Redmine transport, request queue, timeout, bounded retry, pagination, discovery, and issue mutations. Fetch, abort, timers, clock, configuration validation, and logger are injectable.
- `scripts/background/notification-policy.js`: pure snapshot normalization, change summaries, update classification, project eligibility, quiet-hours checks, and bundling selection.
- `scripts/background/profile-state-repository.js`: typed façade over versioned profile domains such as history, read/seen IDs, issue state, cursor, project cache, sync health, and desktop mappings.
- `scripts/background/notification-service.js`: single-flight synchronization and notification/issue-action use cases. It receives Chrome, transport, repository, policy, localization, clock, and logging dependencies.
- `scripts/background/runtime-router.js`: request validation and compatible response envelopes for runtime actions.
- `scripts/background/runtime-bootstrap.js`: synchronous registration for install, startup, alarm, storage, message, and desktop-notification events.
- `scripts/background/diagnostic-snapshot.js`: closed-schema health snapshot construction, locally bound server fingerprinting, and final safety validation.
- `scripts/shared/i18n.js`: context-neutral locale loading, one English fallback, substitution, and optional BCP 47 document language updates.
- `scripts/shared/diagnostic-event-store.js`: opt-in, serialized local retention of at most 100 sanitized events for seven days.
- `scripts/shared/safe-logger.js`: structured, redacted runtime events. Debug and info are quiet by default; warning and error events are sanitized before console output.

## Runtime action contract

The router preserves these action names:

- `getNotifications`
- `getCachedNotifications`
- `markAsRead`
- `markAllAsRead`
- `testConnection`
- `refreshNotifications`
- `forceRefreshNotifications`
- `clearNotificationHistory`
- `getIssueActionContext`
- `applyIssueChanges`
- `getSettings`
- `getNotificationProjects`
- `getDiagnostics` (same-extension callers only)

Successful fields remain compatible with Popup and Options. Failures use stable safe codes; arbitrary exception objects and response bodies are not returned by the router.

## Chrome listener contract

Exactly one listener is registered for each required event during worker evaluation:

- `runtime.onInstalled`
- `runtime.onStartup`
- `alarms.onAlarm`
- `storage.onChanged`
- `runtime.onMessage`
- `notifications.onClicked`
- `notifications.onButtonClicked` when supported
- `notifications.onClosed` when supported

The periodic alarm is repaired idempotently. Module evaluation does not unconditionally synchronize.

## Persisted state contract

Existing version 1.5.0 keys and schemas remain compatible. Important configuration keys include `redmineUrl`, local-only `apiKey`, `checkInterval`, language and notification preferences, and `privacyNoticeConsentV1`.

Profile state remains under `profileStateV1:<profileId>:<domain>` for:

- `history`
- `issueStates`
- `readIds`
- `seenIds`
- `cursor`
- `projectCache`
- `syncHealth`
- `desktopMappings`

Supporting profile keys remain `activeProfileV1`, `profileIndexV1`, `profileMigrationV1`, and `credentialBindingV1`. Retry metadata remains `notificationRetryV1`.

Optional diagnostics use local-only `diagnosticsEnabledV1` and `diagnosticEventsV1`. Disabling diagnostics removes retained events.

## Logging and diagnostic sink

Runtime code logs an event level, stable code, and allowlisted primitive metadata. API keys, URLs, server/profile identifiers, issue data, response bodies, and raw stacks are removed before output. Production defaults emit sanitized warning/error events only.

`SafeLogger` accepts `isDebugEnabled` and `eventSink` dependencies. When disabled, the sink receives nothing. When enabled, the sink receives only timestamped schema-versioned sanitized events. The diagnostic event store owns persistence and retention; the logger itself does not read or write storage. See [Safe diagnostics](DIAGNOSTICS.md) for the snapshot schema and support workflow.

## Testing boundaries

Fake Redmine integration imports `redmine-api.js` directly and supplies fetch/timer dependencies. Pure policy, repository, router, bootstrap, localization, and logging tests import their target modules without evaluating `background.js`. Chromium smoke testing validates the final packaged import order and listener composition.
