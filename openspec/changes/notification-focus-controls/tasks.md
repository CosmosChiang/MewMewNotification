## 1. Settings Model and Data Preparation

- [x] 1.1 Extend the notification settings schema, defaults, and sanitization rules for project rules, change-type filters, quiet hours, and bundling window preferences.
- [x] 1.2 Add background helpers to load and normalize the new focus-control settings without breaking existing users who have no new preferences saved.
- [x] 1.3 Add project metadata loading or caching needed to populate the settings UI with available Redmine projects.

## 2. Options UI

- [ ] 2.1 Add notification focus controls to `options.html` for per-project include/exclude rules.
- [ ] 2.2 Add controls for supported change-type filters and a predictable generic-update fallback option.
- [ ] 2.3 Add quiet-hours configuration inputs and bundling-window selection controls.
- [ ] 2.4 Update `scripts/options.js` to populate, validate, persist, and reset the new settings.
- [ ] 2.5 Add localized strings for all new focus-control labels, help text, validation errors, and status messages.

## 3. Background Filtering and Classification

- [ ] 3.1 Classify fetched Redmine issue updates into the supported change categories using available issue snapshot data.
- [ ] 3.2 Apply project allow/deny rules before surfacing extension notifications.
- [ ] 3.3 Apply change-type filters with consistent fallback behavior for unclassified updates.
- [ ] 3.4 Apply quiet-hours suppression so interruption-oriented alerts are skipped while retained history stays intact.

## 4. Notification Bundling

- [ ] 4.1 Add bundling logic that merges repeated eligible updates for the same issue within the configured window.
- [ ] 4.2 Preserve newest timestamps and accumulate digest details when a retained notification record is updated by bundling.
- [ ] 4.3 Keep updates outside the bundling window as separate retained notification records.

## 5. Popup and Runtime Consistency

- [ ] 5.1 Update popup rendering as needed so bundled notifications display consistently with existing inbox and digest behavior.
- [ ] 5.2 Ensure unread badge counts, mark-as-read flows, and retained history semantics continue to work with suppressed and bundled notifications.

## 6. Tests and Documentation

- [ ] 6.1 Add background tests for project-rule evaluation, change-type filtering, quiet-hours suppression, and bundling behavior.
- [ ] 6.2 Add options and popup tests for settings persistence, validation, and bundled-notification rendering.
- [ ] 6.3 Update README documentation to explain notification focus controls, quiet hours, and bundling behavior.
