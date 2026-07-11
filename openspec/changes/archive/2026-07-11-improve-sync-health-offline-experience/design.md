## Context

Popup initialization blocks on live refresh even when local history exists. Background failures are flattened into logs/storage and callers can receive stale records with an unconditional success. The same UI also carries an unused sound preference, fixed-height virtualization for variable cards, and incomplete keyboard/ARIA behavior.

## Goals / Non-Goals

**Goals:**

- Make retained notifications immediately usable offline and accurately label freshness.
- Surface safe synchronization/action status and retry information.
- Make sound preference, rendering and accessibility behavior match the UI contract.

**Non-Goals:**

- This change does not implement pagination/cursor correctness or new desktop buttons.
- It does not introduce remote telemetry or automatically upload diagnostics.

## Decisions

### D1: Popup uses cached-first stale-while-revalidate

Initialization requests retained history and sync health first, renders immediately, then requests background refresh. The lifecycle change's SyncResult updates the status region and records freshness. Stale threshold is derived from the configured interval with a conservative minimum, not a fixed network timeout.

### D2: Sync and action states use stable codes

UI maps stable error/status codes to localized messages and never displays raw response bodies. Syncing, stale, retry scheduled, last success and action failure are separate states. Retained history remains visible during failure.

### D3: Remove fixed-height virtualization at current retention scale

Because retained history is bounded to 100 items, render the visible filtered list with event delegation and throttled search, eliminating fixed 80px assumptions and repeated scroll listeners. Reintroducing virtualization requires measured variable-height support and a separate performance case.

### D4: Sound preference maps to notification `silent`

Desktop notification options set `silent: !enableSound`. Unsupported platform behavior keeps the preference but surfaces a localized limitation; no custom audio or offscreen document is introduced.

### D5: Accessibility is behavior not decoration

Set document lang dynamically, implement complete tab semantics/keyboard movement, make actionable cards/buttons reachable, announce loading/status/errors through live regions, restore focus after panel changes, and disable nonessential motion under reduced-motion preference.

## Risks / Trade-offs

- [Risk] Rendering up to 100 cards may cost more than virtual rendering → measure render time; bounded size and simpler DOM lifecycle are preferred unless evidence shows regression.
- [Risk] OS notification sounds vary → test option construction deterministically and document platform behavior.
- [Risk] Too many status announcements become noisy → only announce state transitions, not every retained record update.

## Migration Plan

No storage migration beyond versioned sync-health fields. Ship cached-first/status contract first, then rendering, sound and accessibility changes. Rollback ignores new health fields and returns to existing rendering.

## Open Questions

- A user-exportable diagnostic bundle remains a later change; this design only exposes safe local status.
