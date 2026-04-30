## ADDED Requirements

### Requirement: Users can control notification eligibility by project
The system MUST let users configure project-level notification rules that determine whether updates from a Redmine project are eligible to become extension notifications.

#### Scenario: No project rules configured
- **WHEN** the user has not configured any per-project notification rules
- **THEN** the system continues using the current global notification behavior without excluding projects by default

#### Scenario: Include list limits notification scope
- **WHEN** the user configures one or more projects as included for notifications
- **THEN** the system only surfaces eligible issue updates from those included projects

#### Scenario: Exclude list blocks a noisy project
- **WHEN** the user excludes a project from notifications and an otherwise eligible update arrives from that project
- **THEN** the system MUST suppress the extension notification for that update

### Requirement: Users can filter notifications by supported change types
The system MUST let users choose which supported change categories can generate extension notifications, using categories that can be derived from available Redmine issue data.

#### Scenario: Status changes remain enabled
- **WHEN** status-change notifications are enabled and an issue update is classified as a status change
- **THEN** the system surfaces the update as an eligible notification

#### Scenario: Disabled change types are suppressed
- **WHEN** assignee, priority, or comment-change notifications are disabled and an update is classified into one of those disabled categories
- **THEN** the system MUST suppress the extension notification for that update

#### Scenario: Uncertain update classification falls back predictably
- **WHEN** the system cannot confidently classify an update into a supported change category
- **THEN** the system MUST apply a consistent generic-update fallback behavior instead of guessing a category

### Requirement: Quiet hours suppress interruptions without losing retained history
The system MUST support user-configured quiet hours that suppress interruption-oriented notification delivery while preserving qualifying updates in retained notification history.

#### Scenario: Quiet hours suppress desktop-facing alerts
- **WHEN** an eligible update arrives during the user's configured quiet-hours window
- **THEN** the system MUST not trigger desktop notification sound or popup-facing interruption behavior for that update

#### Scenario: Quiet-hours updates remain available later
- **WHEN** an eligible update is suppressed because quiet hours are active
- **THEN** the system MUST retain the update in notification history so the user can review it after the quiet-hours window ends

### Requirement: Repeated updates for the same issue are bundled within a short window
The system MUST support bundling repeated updates for the same issue within a configurable short time window so bursty activity becomes one surfaced notification record.

#### Scenario: Repeated updates merge into one notification record
- **WHEN** multiple eligible updates for the same issue arrive within the active bundling window
- **THEN** the system MUST merge them into a single retained notification record instead of creating separate adjacent notifications

#### Scenario: Bundled notification reflects the newest update
- **WHEN** an existing notification record is updated by bundling a newer issue update
- **THEN** the retained notification MUST keep the newest timestamp and preserve relevant accumulated digest details needed for later review

#### Scenario: Updates outside the bundling window remain separate
- **WHEN** a new eligible update for the same issue arrives after the bundling window has expired
- **THEN** the system MAY create a new notification record instead of merging it into the older one
