## Why

The background service worker, Options controller, and Popup controller contain roughly 5,800 lines and duplicate API, localization, logging, storage, routing, and bootstrap concerns. This coupling makes tests load unrelated Chrome behavior, produces false integration-test errors, and raises the risk of changing synchronization or issue actions.

## What Changes

- Split the background runtime into independently testable Redmine API, notification policy, profile repository, notification service, runtime router, and Chrome bootstrap modules.
- Keep the classic Manifest V3 service worker and existing `importScripts` loading model; do not migrate to ESM.
- Make every extracted module side-effect free on import and reserve instance creation, asynchronous initialization, and Chrome listener registration for `background.js`.
- Replace duplicate Popup, Options, and background localization logic with one injectable `I18nManager`.
- Add a structured safe logger that redacts sensitive values, suppresses normal debug noise by default, and exposes a sanitized opt-in event sink for the diagnostics change.
- Make Fake Redmine integration tests load the Redmine API module directly without executing the service-worker bootstrap.
- Raise coverage expectations for extracted pure modules and the overall production surface.

## Capabilities

### New Capabilities

- `modular-extension-runtime`: Defines side-effect-free runtime module boundaries, dependency injection, bootstrap behavior, and stable routing contracts.
- `shared-localization-runtime`: Defines one injectable localization implementation shared across extension contexts.
- `safe-runtime-logging`: Defines structured, redacted default logging and the opt-in sanitized diagnostic-event interface.

### Modified Capabilities

- `unit-test-structure`: Requires isolated module tests, clean Fake Redmine integration output, new-module coverage thresholds, and a higher global coverage baseline.

## Impact

- Affects `background.js`, `scripts/options.js`, `scripts/popup.js`, shared scripts, service-worker import order, Jest tests and coverage, integration tests, package allowlist, and developer documentation.
- Preserves existing runtime message action names and user-visible synchronization, notification, issue-action, profile, and storage behavior.
- Introduces no runtime package dependency, new browser permission, ESM conversion, or diagnostics UI.
