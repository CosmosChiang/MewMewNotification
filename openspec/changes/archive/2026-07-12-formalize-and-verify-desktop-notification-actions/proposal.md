## Why

Desktop notification actions are implemented and archived, but their new capability was never promoted into the canonical OpenSpec tree, so strict validation cannot address it and the roadmap still presents the feature as pending. Notification mapping is also persisted before Chrome confirms notification creation, leaving an orphan mapping until retention cleanup when creation fails.

## What Changes

- Establish `desktop-notification-actions` as a canonical capability based on the completed archived behavior.
- Require failed desktop-notification creation to remove its newly-created mapping without disturbing other mappings.
- Extend OpenSpec validation to detect archived new capabilities that are missing from canonical specs.
- Update focused automated tests, operational documentation, and roadmap status.

## Capabilities

### New Capabilities

- `desktop-notification-actions`: Defines Profile-scoped desktop notification mappings, safe issue opening, explicit local mark-read, batch fallback, platform fallback, and creation-failure cleanup.

### Modified Capabilities

None.

## Impact

This affects desktop notification creation in `background.js`, Chrome API mocks and background tests, the repository OpenSpec validator, canonical OpenSpec specifications, and desktop notification/roadmap documentation. It introduces no Redmine mutation and no new runtime dependency or permission.
