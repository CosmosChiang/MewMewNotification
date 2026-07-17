## Why

The extension handles Redmine credentials and issue data but does not ship a complete privacy policy or require an explicit first-configuration disclosure. Its canonical OpenSpec baseline, declared permissions, and development dependency posture also drift from the behavior already shipped in version 1.5.0.

## What Changes

- Add a versioned privacy policy covering handled data, storage locations, Redmine communication, retention, deletion, and non-sharing behavior.
- Require an explicit, local-only privacy notice acknowledgement before Redmine settings can be saved for the first time or after the notice version changes.
- Link the same privacy policy from the README, Options About page, and Chrome Web Store release checklist.
- Remove the unused `activeTab` permission without changing issue-opening behavior.
- Restore every implemented archived capability to the canonical specification set and archive the completed Web Store listing change.
- Update `js-yaml`, `adm-zip`, and vulnerable transitive dependencies until the moderate-or-higher audit gate passes.
- Raise CI dependency validation from high to moderate severity.

## Capabilities

### New Capabilities

- `extension-privacy-disclosure`: Defines the privacy policy, in-product disclosure, versioned acknowledgement, and policy-link consistency required before Redmine data is handled.

### Modified Capabilities

- `extension-security-maintenance`: Requires removal of unused permissions, canonical specification completeness, and remediation or documented handling of moderate-or-higher dependency findings.
- `ci-cd-pipeline-enhancement`: Raises automated dependency auditing to the moderate severity threshold and keeps maintenance validation aligned with the canonical OpenSpec baseline.

## Impact

- Affects `manifest.json`, the Options UI and controller, localized messages, privacy and release documentation, OpenSpec artifacts, dependency manifests, and CI validation.
- Adds one local-only acknowledgement record, `privacyNoticeConsentV1`, with schema version and acceptance timestamp.
- Does not change Redmine transport policy, notification behavior, host-permission scope, or extension runtime dependencies.
