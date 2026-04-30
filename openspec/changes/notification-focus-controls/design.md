## Context

MewMewNotification now has a stronger downstream triage experience than upstream filtering: users can review inbox history, search notifications, inspect update digests, and take quick actions, but the extension still creates alerts with only coarse global preferences. That makes the next change cross-cutting because the decision about whether to surface an update now depends on project-specific rules, change classification, time windows, and bundling state before the existing inbox and desktop notification flows run.

This design intentionally limits scope to the first high-impact phase discussed during exploration:

1. per-project notification rules
2. change-type notification filters
3. quiet hours
4. short-window per-issue notification bundling

The goal is to reduce interruption cost without rewriting the notification inbox model that was added recently.

## Goals / Non-Goals

**Goals:**
- Let users include or exclude specific Redmine projects from extension-surfaced notifications.
- Let users choose which update categories are important enough to notify on, starting with status, assignee, priority, and comment/journal activity.
- Suppress user-facing alerts during configured quiet hours while preserving retained notification history for later review.
- Collapse repeated updates for the same issue within a short bundling window into one surfaced notification record.
- Keep the existing inbox, digest, badge, and quick-action architecture intact where possible.

**Non-Goals:**
- Mute or snooze controls at the issue level.
- Follow-up, starred, or remind-later workflows.
- Multi-Redmine or multi-account support.
- Rich journal diff rendering beyond the currently available issue snapshot fields.
- New external services, push infrastructure, or AI-based prioritization.

## Decisions

### Store focus controls as sync preferences and bundling state as local runtime data

Per-project rules, change-type filters, quiet-hours windows, and the bundling window are user preferences and SHOULD remain in `chrome.storage.sync` with the other notification settings. Any temporary state needed to merge repeated issue updates (for example, the last surfaced notification per issue within the active window) SHOULD stay local to existing notification history/runtime records.

This keeps user intent portable across browsers without syncing derived Redmine activity data.

Alternative considered: store all focus-control state in `chrome.storage.local`. That would simplify some data handling, but it would make user preferences device-specific without a strong product reason.

### Evaluate focus rules in the background notification pipeline before desktop surfacing

The background flow already fetches Redmine issues, detects updates, and builds notification records. Focus controls SHOULD be applied there in this order:

1. classify the issue update into supported change types
2. apply project allow/deny rules
3. apply change-type filters
4. apply quiet-hours suppression for user-facing alerts
5. merge or bundle repeated issue updates within the active window
6. persist the resulting history records and compute unread badge state

This lets the popup inbox continue reading a normalized notification list rather than duplicating business rules client-side.

Alternative considered: apply filters in the popup only. That would reduce background complexity, but it would not solve desktop alert fatigue and would still create noisy notifications behind the scenes.

### Model project rules as explicit include/exclude entries with predictable fallback

The first version SHOULD support a simple explicit rule model:

- no project rules configured -> fallback to current global behavior
- include rules present -> only included projects are eligible
- exclude rules present without includes -> all projects except excluded ones are eligible

The UI SHOULD avoid introducing a complex policy editor in phase 1. A flat project list with include/exclude state is easier to explain, test, and localize.

Alternative considered: nested boolean logic across project, tracker, and assignee. That is more flexible, but it is much harder to explain and validate before there is user evidence that the simpler model is insufficient.

### Use a small fixed set of change categories derived from available Redmine data

The first version SHOULD support only the change categories that can be inferred reliably from existing issue fetches or already-available comparison logic:

- status changed
- assignee changed
- priority changed
- comment/journal activity detected when Redmine returns enough signal to classify it, otherwise fall back to generic update behavior

If an update cannot be classified confidently, the system SHOULD treat it as a generic update and only surface it when generic updates remain enabled by the chosen filter configuration.

Alternative considered: fetch full journal history for every updated issue to classify every change precisely. That would increase API traffic and complexity too early.

### Quiet hours suppress interruptions, not retained work state

During quiet hours, desktop notifications, sounds, and other interruption-oriented surfaces SHOULD be suppressed, but qualifying updates SHOULD still be retained in notification history for later review. This preserves trust: users do not lose information just because they were in a focus window.

Alternative considered: skip creating notification records entirely during quiet hours. That reduces storage churn, but it makes users miss updates permanently and weakens the inbox model.

### Bundle repeated updates onto one retained issue notification within a configurable short window

Repeated updates for the same issue within a short period SHOULD merge into the most recent retained notification for that issue instead of creating several adjacent inbox entries. The merged notification SHOULD preserve the newest timestamp and accumulate any newly detected change-summary items needed for later review.

The first version SHOULD use a single global bundling window rather than project-specific bundling policies.

Alternative considered: no bundling, only quieter desktop delivery. That still leaves the inbox noisy and works against the product's triage value.

## Risks / Trade-offs

- **Rule complexity can confuse users** -> Keep the first UI narrow, with a fixed project-rule model and a small set of change categories.
- **Change classification may be imperfect** -> Only classify categories supported by current Redmine data and fall back to generic updates when certainty is low.
- **Bundling can hide useful chronology** -> Preserve latest timestamp and aggregated digest details so users still see that multiple things changed.
- **Quiet hours may create perceived missed alerts** -> Keep retained inbox history intact and make quiet-hours state explicit in settings copy.
- **Project lists may be large on big Redmine instances** -> Load and cache project metadata defensively and keep the first UI optimized for simple include/exclude actions.

## Migration Plan

1. Extend the settings schema and defaults with focus-control preferences.
2. Add options UI for project rules, change-type filters, quiet-hours configuration, and bundling window selection.
3. Update background notification classification and filtering before desktop alert creation.
4. Update retained notification merge logic so repeated issue updates can bundle cleanly.
5. Preserve backward compatibility by treating missing focus-control settings as current behavior.
6. Roll back by ignoring the new settings keys and reverting to the existing notification pipeline; retained notification history remains valid because the data model stays additive.

## Open Questions

- What is the safest MVP for project selection UX if a Redmine instance has hundreds of projects?
- Should generic updates be a visible toggle in phase 1, or should phase 1 only expose the four concrete change categories?
- What default quiet-hours behavior is least surprising: disabled by default, or prefilled but opt-in?
