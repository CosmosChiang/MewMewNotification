## ADDED Requirements

### Requirement: Public listing describes desktop actions safely
Chrome Web Store copy and screenshots MUST distinguish local notification read state from Redmine issue mutation and MUST describe notification buttons as platform-dependent.

#### Scenario: Desktop action copy is validated
- **WHEN** localized listing metadata presents Open issue or Mark read actions
- **THEN** it states or clearly implies that Mark read changes only the extension's retained notification state and that buttons appear only where the platform supports them
