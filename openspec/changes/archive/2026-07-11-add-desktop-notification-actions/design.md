## Context

Chrome notifications are currently created without deterministic IDs. Their click handler cannot resolve a single issue and always opens the Popup. Direct actions require a durable, Profile-scoped mapping that remains safe across service-worker restarts and profile changes.

## Goals / Non-Goals

**Goals:**

- Open the exact issue from a valid single-item desktop notification.
- Allow marking that notification read from the desktop notification.
- Preserve safe batch fallback, Profile isolation and idempotent state updates.

**Non-Goals:**

- No quick reply/status/assignee mutation from OS notifications.
- No more than the platform-supported two buttons.
- No action against a non-active Profile.

## Decisions

### D1: Use explicit opaque notification IDs plus local mapping

Create bounded IDs such as `issue:<opaque-token>` and persist token metadata containing profileId, recordId, issue URL, type and expiry in local Profile storage. Do not embed full URLs, titles or credentials in the Chrome notification ID.

### D2: Single and batch notifications have different behavior

Clicking a valid single notification opens its mapped HTTPS/allowed-loopback issue URL and marks the record read only when explicitly requested. Batch click opens the Popup inbox. Buttons are ordered as Open issue and Mark read; unsupported buttons degrade to click behavior and Popup state.

### D3: Validate mapping at action time

On click/button, load the mapping, verify expiry and active profile, revalidate the URL against the active Redmine base, then execute. Unknown, expired or mismatched mappings never open a URL or mutate read state; they may safely open the Popup with a localized status.

### D4: Mapping retention follows notification lifecycle

Remove mapping after notification close/expiry and cap stored entries. Mark-read is idempotent and updates history/badge before clearing the system notification when possible.

## Risks / Trade-offs

- [Risk] OS platforms present buttons differently → test option construction and keep safe primary-click fallback.
- [Risk] Mapping disappears before click → open Popup without performing an issue action.
- [Risk] Stale URL points at changed Profile → active-profile and base URL validation blocks it.

## Migration Plan

No legacy mapping exists. Add mapping storage and listeners, then switch new notifications to explicit IDs. Old auto-generated notification IDs continue using the safe Popup fallback until closed.

## Open Questions

- Automatic mark-read on primary click is intentionally excluded; only the explicit Mark read action changes state.
