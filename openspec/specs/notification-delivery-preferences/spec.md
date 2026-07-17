## Purpose

Define sound delivery preference behavior and robust variable-height notification rendering.

## Requirements

### Requirement: Sound preference controls desktop notification delivery
The extension MUST apply `enableSound` to every desktop notification by setting the notification's silent option to the inverse value.

#### Scenario: Sound is disabled
- **WHEN** an eligible desktop notification is created and `enableSound` is false
- **THEN** its delivery options request silent presentation

#### Scenario: Sound is enabled
- **WHEN** an eligible desktop notification is created and `enableSound` is true
- **THEN** its delivery options do not request silent presentation

#### Scenario: Platform cannot honor sound preference
- **WHEN** the browser or operating system cannot honor the requested sound behavior
- **THEN** the extension continues displaying the notification and exposes a localized non-fatal limitation when relevant

### Requirement: Notification list rendering supports variable content height
The Popup MUST render bounded notification history without overlapping or clipping variable-height titles, change summaries, localization, or expanded content, and MUST NOT accumulate duplicate scroll handlers across rerenders.

#### Scenario: Long localized cards are rendered
- **WHEN** the inbox contains long titles and multi-row change summaries
- **THEN** every card occupies its natural height without overlap or clipping

#### Scenario: Inbox rerenders repeatedly
- **WHEN** search, read state and refresh cause repeated rendering
- **THEN** event handler counts remain bounded and each user action is handled once
