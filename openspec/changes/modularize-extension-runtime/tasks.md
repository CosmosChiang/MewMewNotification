## 1. Contract Characterization

- [x] 1.1 Inventory every background responsibility, Chrome listener, runtime action request, response field, storage key, and imported global before moving code.
- [x] 1.2 Add characterization tests for runtime routing, service-worker listener registration, synchronization results, issue actions, desktop actions, and existing profile state.
- [x] 1.3 Add an import-side-effect test harness that fails on unexpected Chrome calls, fetches, timers, alarms, or instance construction.

## 2. Shared Localization and Safe Logging

- [x] 2.1 Implement context-neutral `I18nManager` dependency injection, `globalThis`/CommonJS exports, bounded English fallback, substitution, and optional document language updates.
- [x] 2.2 Migrate background, Options, and Popup to the shared manager and remove their duplicate locale loading and translation implementations.
- [x] 2.3 Implement `SafeLogger` with structured event codes, metadata allowlists, redaction, quiet defaults, and injected debug predicate/event sink.
- [x] 2.4 Replace free-form background, Options, and Popup logging with safe events and remove raw response bodies, URLs, issue data, and exception objects from logger calls.
- [x] 2.5 Add localization and logger tests covering every extension context, fallback failure, redaction, quiet defaults, and opt-in sink behavior.

## 3. Redmine Transport Extraction

- [x] 3.1 Extract `RedmineAPI` and its request, queue, timeout, retry, pagination, validation, discovery, and mutation behavior into `scripts/background/redmine-api.js`.
- [x] 3.2 Inject fetch, abort, timers, clock, and logger dependencies and verify that importing the transport module has no side effects.
- [x] 3.3 Refactor Fake Redmine integration tests to import the transport module directly and remove VM evaluation of the complete service worker.
- [x] 3.4 Assert clean integration output with no missing-Chrome, locale URL, bootstrap, timer, or unexpected console errors.

## 4. Policy and Persistence Extraction

- [x] 4.1 Extract issue snapshot normalization, change summaries, change classification, project rules, quiet hours, and bundling into pure notification-policy functions.
- [x] 4.2 Extract profile domain access, history retention, read/seen IDs, issue states, cursor, project cache, sync health, and desktop mappings into `ProfileStateRepository`.
- [x] 4.3 Add isolated positive, boundary, and failure-path tests for policy and repository modules without loading Chrome bootstrap.

## 5. Service, Router, and Bootstrap Extraction

- [x] 5.1 Extract single-flight synchronization and notification use cases into `NotificationService` using injected API, repository, policy, Chrome adapter, clock, i18n, and logger.
- [x] 5.2 Extract runtime action constants, request validation, safe error mapping, dispatch, and response envelopes into `RuntimeRouter`.
- [x] 5.3 Extract synchronous Chrome listener registration into `runtime-bootstrap.js` and verify every listener registers exactly once before asynchronous initialization.
- [x] 5.4 Reduce `background.js` to deterministic import order, one production composition root, synchronous registration, and allowed alarm-repair initialization.
- [x] 5.5 Run the complete unit suite after each extraction and confirm message, state, synchronization, notification, and issue-action compatibility.

## 6. Packaging, Coverage, and Documentation

- [x] 6.1 Update HTML/script import order, service-worker `importScripts`, and the package allowlist for every new runtime file.
- [x] 6.2 Configure per-module 90% line/function and 85% branch thresholds and raise all global coverage thresholds to 65%.
- [x] 6.3 Update architecture, testing, logging, and extension packaging documentation for the new module boundaries and diagnostic-sink contract.
- [x] 6.4 Run lint, locale parity, full Jest coverage, Fake Redmine integration, Chromium smoke, strict OpenSpec, package, version, checksum, and `git diff --check` validation.
