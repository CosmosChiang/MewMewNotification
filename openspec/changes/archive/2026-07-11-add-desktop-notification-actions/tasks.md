## 1. Prerequisite and Mapping Model

- [x] 1.1 Confirm Profile state isolation is implemented and notification records have profileId
- [x] 1.2 Define opaque desktop notification IDs and bounded Profile-scoped mapping storage with expiry
- [x] 1.3 Add mapping cleanup for notification close, expiry, Profile removal, and retention overflow

## 2. Notification Creation and Actions

- [x] 2.1 Create deterministic single and batch notification IDs with safe mapping metadata
- [x] 2.2 Add localized Open issue and Mark read buttons to supported single-item notifications
- [x] 2.3 Implement onClicked behavior: validated single issue opens directly and batch opens Popup inbox
- [x] 2.4 Implement onButtonClicked behavior with platform-safe fallback when buttons are unavailable

## 3. Security and State Consistency

- [x] 3.1 Validate mapping expiry, active profile, record ownership, and URL base before opening or mutating state
- [x] 3.2 Make desktop mark-read idempotent and keep retained history, badge, and system notification consistent
- [x] 3.3 Handle unknown, legacy, stale, and cross-Profile notification IDs without Redmine requests or unsafe URLs
- [x] 3.4 Preserve mapping and report a safe error when mark-read persistence fails

## 4. Verification and Documentation

- [x] 4.1 Test single click, batch click, both buttons, repeated mark-read, close cleanup, and mapping expiry
- [x] 4.2 Test cross-Profile, unknown-ID, invalid-URL, storage-failure, and worker-restart cases
- [x] 4.3 Update notification behavior/localization documentation and manual platform test checklist
- [x] 4.4 Run unit, Chrome notification integration, browser smoke, and strict OpenSpec validation
