## MODIFIED Requirements

### Requirement: Users can control notification eligibility by project
The system MUST apply project-level notification rules consistently to baseline, paginated incremental, replayed, and reconciled issue events.

#### Scenario: No project rules configured
- **WHEN** the user has not configured per-project notification rules
- **THEN** all synchronization sources use the current global notification behavior

#### Scenario: Include list limits notification scope
- **WHEN** an event from any synchronization source belongs to a project outside the include list
- **THEN** the event is processed for state correctness but is not retained or delivered as an eligible notification

#### Scenario: Exclude list blocks a reconciled update
- **WHEN** reconciliation detects an update from an excluded project
- **THEN** the system suppresses the notification using the same rule as an incremental result

### Requirement: Users can filter notifications by supported change types
The system MUST apply supported change-type filters to baseline, incremental, replayed, and reconciled events after canonical change classification and before notification delivery.

#### Scenario: Status changes remain enabled
- **WHEN** a closed-issue reconciliation is classified as status change and status notifications are enabled
- **THEN** the system surfaces the update as eligible exactly once

#### Scenario: Disabled change types are suppressed
- **WHEN** an assignee, priority, or comment event is disabled regardless of synchronization source
- **THEN** the system suppresses its notification while preserving required sync state

#### Scenario: Uncertain update classification falls back predictably
- **WHEN** a replayed or unavailable event cannot be confidently classified
- **THEN** the system applies the configured generic-update fallback instead of guessing
