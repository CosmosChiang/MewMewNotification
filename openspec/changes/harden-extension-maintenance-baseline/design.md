## Context

Version 1.5.0 stores the Redmine API key locally, retains issue and notification data in profile-scoped local storage, and communicates directly with the configured Redmine server. The repository documents parts of this behavior but has no complete public privacy policy or versioned in-product acknowledgement. The manifest also declares `activeTab` even though runtime code only creates new tabs, and the current dependency audit reports moderate findings.

OpenSpec validation passes because archived changes remain valid in place, but eight shipped capabilities have no canonical specification under `openspec/specs/`. The completed `refresh-chrome-web-store-listing` change is also still active.

## Goals / Non-Goals

**Goals:**

- Publish one versioned privacy policy and require a local acknowledgement before an unconfigured user tests or saves Redmine credentials.
- Minimize declared permissions without changing user-visible issue-opening behavior.
- Make canonical OpenSpec specifications represent all shipped behavior.
- Eliminate moderate-or-higher dependency findings and enforce that threshold in CI.

**Non-Goals:**

- Changing the policy for HTTP Redmine servers.
- Changing notification synchronization, profile behavior, or Redmine API features.
- Publishing a new Chrome Web Store version.
- Refactoring the runtime controllers or adding diagnostics; separate changes cover those concerns.

## Decisions

### Use a repository privacy policy plus an in-product summary

`PRIVACY.md` is the public, version-controlled source used by README and the Chrome Web Store release checklist. Options presents a localized concise disclosure and links to the public policy. This avoids embedding a second full policy copy that could drift.

Alternative considered: package a separate `privacy.html`. This would work offline but would duplicate policy content and require another packaged surface, so it is not selected.

### Store versioned acknowledgement locally

Options writes `privacyNoticeConsentV1` to `chrome.storage.local` as `{ version: 1, acceptedAt: <epoch milliseconds> }`. Testing a connection or saving Redmine settings requires the current version. A future policy version invalidates the previous acknowledgement automatically.

Existing configured installations continue background operation to avoid silently disabling notifications after an update. On the next Options visit, the disclosure is shown and connection tests or Redmine-setting changes remain blocked until acknowledgement.

Alternative considered: synchronize acknowledgement. Consent is device-specific and should not silently authorize another browser, so sync storage is not used.

### Remove only proven-unused permissions

`activeTab` is removed because the extension does not inspect, inject into, or capture the active tab. `chrome.tabs.create()` remains available without it. Existing `storage`, `notifications`, `alarms`, `background`, and optional host permissions remain unchanged in this change.

### Repair canonical specifications before adding more changes

Archive `refresh-chrome-web-store-listing` so its completed delta becomes canonical. Restore the eight shipped capabilities that currently exist only in archived changes:

- `extension-accessibility`
- `lossless-notification-sync`
- `notification-delivery-preferences`
- `notification-inbox`
- `notification-sync-lifecycle`
- `redmine-profile-state-isolation`
- `release-artifact-integrity`
- `sync-health-offline-experience`

The restored files retain the shipped requirements and add the required `Purpose` and `Requirements` structure. The existing CI specification is updated to reflect Node 22/24, current job boundaries, tag-based release behavior, and the moderate audit gate.

### Apply dependency upgrades on the feature branch

Update `js-yaml`, `adm-zip`, and the lockfile on the implementation branch, then close Dependabot PRs #12 and #13 as superseded after the feature PR lands. This avoids merging stale PR bases independently while preserving their intended upgrades.

CI runs `npm audit --audit-level=moderate`. A future unfixable finding requires a documented, time-bounded exception; this change itself is accepted only with zero moderate-or-higher findings.

## Risks / Trade-offs

- [Existing users have not acknowledged immediately after update] → Preserve service continuity, but require acknowledgement on the next Options interaction and keep the public policy available from README and the store listing workflow.
- [Privacy policy and implementation drift] → Validate policy links and storage claims in tests and the release checklist.
- [Dependency major upgrades change tool behavior] → Run workflow parsing, packaging, smoke, unit, integration, and reproducibility checks before acceptance.
- [Restoring specifications introduces duplicate or conflicting requirements] → Compare archived sources by capability, select the latest shipped requirement set, and run strict validation over base and active artifacts.

## Migration Plan

1. Archive the completed Web Store listing change and restore missing canonical capabilities.
2. Add privacy policy, localized disclosure, and local acknowledgement gating.
3. Remove `activeTab` and verify issue links still open in Chromium smoke tests.
4. Upgrade development dependencies and raise the CI audit threshold.
5. Run all quality, OpenSpec, packaging, and audit gates.
6. After the feature PR merges, close Dependabot PRs #12 and #13 as superseded.

Rollback consists of reverting the feature commits. The acknowledgement record is harmless if left behind because no older version reads it.

## Open Questions

None.
