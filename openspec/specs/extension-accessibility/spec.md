## Purpose

Define accessible semantics, keyboard behavior, and reduced-motion support for extension interfaces.

## Requirements

### Requirement: Documents and dynamic status have accessible semantics
Popup and Options MUST expose the active language, semantic labels, and live status/error regions that update with localized text.

#### Scenario: Language changes
- **WHEN** the user selects a supported language
- **THEN** document `lang`, accessible names and visible messages update consistently

#### Scenario: Synchronization state changes
- **WHEN** loading changes to success, stale or error
- **THEN** the relevant polite or assertive live region announces the transition once

### Requirement: Tabs and notification actions are keyboard operable
All tabs, notification cards, advanced controls and destructive actions MUST be reachable and operable using standard keyboard interaction with visible focus.

#### Scenario: User navigates tabs with keyboard
- **WHEN** focus is on a tab and the user presses an arrow key, Home or End
- **THEN** focus and `aria-selected` move according to the tab pattern and the associated panel is activated

#### Scenario: User opens an issue card without a pointer
- **WHEN** an actionable card or control has keyboard focus and the user presses Enter or Space
- **THEN** the same safe action as pointer activation occurs

### Requirement: Motion respects user preference
Nonessential animations and transitions MUST be disabled or reduced when `prefers-reduced-motion: reduce` is active.

#### Scenario: Reduced motion is enabled
- **WHEN** the operating system requests reduced motion
- **THEN** spinners, rotation and decorative transitions avoid nonessential movement while preserving state visibility
