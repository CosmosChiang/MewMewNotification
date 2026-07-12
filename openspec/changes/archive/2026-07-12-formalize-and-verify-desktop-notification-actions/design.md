## Context

The extension already creates opaque, Profile-scoped desktop notification mappings and supports safe issue opening and local mark-read actions. The completed change was archived without creating `openspec/specs/desktop-notification-actions/spec.md`, while the repository validator only enumerates canonical specs and therefore reports success despite the omission. Notification creation currently writes the mapping before calling callback-based `chrome.notifications.create`; a runtime error leaves an orphan mapping until expiry.

## Goals / Non-Goals

**Goals:**

- Make the implemented desktop action contract canonical and strictly validated.
- Roll back only the mapping created for a notification when Chrome rejects creation.
- Preserve safe Profile, record, expiry and URL validation behavior.
- Record the completed roadmap status and provide repeatable automated and manual verification.

**Non-Goals:**

- No automatic mark-read on primary click.
- No Redmine-side mutation from a desktop notification.
- No change to the two-button ordering or batch-notification behavior.
- No new browser permission, dependency or multi-Profile UI.

## Decisions

### D1: Reintroduce the capability through a new additive delta

Use the archived specification as the behavioral baseline and add creation-failure cleanup as a normative requirement. Archiving this change will create the missing canonical capability through the normal OpenSpec merge path. Directly adding a canonical file before archiving was rejected because it would bypass change provenance.

### D2: Treat notification creation as a small compensating transaction

Keep mapping creation before the Chrome API call so the event can resolve immediately once the system notification exists. If `chrome.runtime.lastError` is present in the creation callback, remove exactly that desktop ID's mapping. A callback success leaves the mapping unchanged. Moving persistence after the callback was rejected because a click could theoretically arrive before durable resolution exists.

### D3: Detect archive/canonical drift in repository validation

The validator will collect capability directories declared beneath archived changes and fail when a capability has no canonical spec. Capabilities already canonical remain unaffected. This repository-level invariant is preferable to a one-off existence assertion because it prevents the same archival omission for future changes.

### D4: Keep OS presentation verification manual

Unit tests cover Chrome API option construction and callbacks; the existing manual platform checklist covers Windows notification-center presentation, which cannot be established by Jest mocks.

## Risks / Trade-offs

- [Risk] Removing a mapping in an asynchronous callback can race with Profile changes → route cleanup through Profile-scoped mapping data captured at creation or make cleanup explicitly target the originating Profile.
- [Risk] Historical archives may contain capabilities intentionally absent from canonical specs → constrain validation to valid capability spec paths and report the exact archive source for review.
- [Risk] A Chrome callback may provide an empty ID without `lastError` → treat absence of `lastError` as API success, matching Chrome callback semantics.

## Migration Plan

No storage migration is required. Deploy the callback rollback and validator, archive the new change to promote the canonical spec, then run strict OpenSpec and full project verification. Rollback can restore the previous callback behavior and validator; existing mappings remain bounded and expire normally.

## Open Questions

None. Opening an issue continues to leave the system notification visible; explicit Mark read is the only action that clears it.
