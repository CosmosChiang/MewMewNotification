## ADDED Requirements

### Requirement: A complete public privacy policy describes handled data
The project MUST publish a versioned privacy policy that describes the Redmine credentials and issue data handled by the extension, their local or synchronized storage locations, direct communication with the configured Redmine server, retention and deletion behavior, and whether data is collected, sold, or shared by the extension developer.

#### Scenario: User reviews data handling
- **WHEN** a user opens the privacy policy from a project or release surface
- **THEN** the policy accurately describes the current runtime data flow without claiming that the API key is synchronized

### Requirement: Redmine configuration requires current privacy acknowledgement
An unconfigured installation MUST require an explicit acknowledgement of the current privacy notice before testing a Redmine connection or saving Redmine credentials.

#### Scenario: First-time user has not acknowledged
- **WHEN** the user attempts to test or save Redmine credentials without accepting the current notice
- **THEN** the extension sends no Redmine request, stores no credentials, and presents the disclosure and acknowledgement control

#### Scenario: User accepts the current notice
- **WHEN** the user explicitly accepts the displayed notice
- **THEN** the extension records the current notice version locally and permits the requested configuration action

#### Scenario: Privacy notice version changes
- **WHEN** the stored acknowledgement version differs from the current notice version
- **THEN** connection tests and Redmine-setting changes require a new explicit acknowledgement

### Requirement: Privacy acknowledgement remains device local
The extension MUST store privacy acknowledgement only in local extension storage as a version and acceptance timestamp and MUST NOT synchronize it or include credentials in the record.

#### Scenario: Acknowledgement is persisted
- **WHEN** the user accepts the privacy notice
- **THEN** `privacyNoticeConsentV1` is written to local storage as `{ version, acceptedAt }` and no acknowledgement value is written to sync storage

### Requirement: Existing configured installations remain operational
An extension update MUST NOT disable existing background synchronization solely because the current device has no privacy acknowledgement, but the Options interface MUST require acknowledgement before the next connection test or Redmine-setting change.

#### Scenario: Existing user receives the update
- **WHEN** valid Redmine settings already exist and the extension starts after updating
- **THEN** scheduled synchronization continues and the next relevant Options action presents the current notice before proceeding

### Requirement: Policy links remain consistent
The README, Options About surface, and Chrome Web Store release checklist MUST link to the same current public privacy policy.

#### Scenario: Release validation runs
- **WHEN** repository and Web Store assets are validated
- **THEN** every required privacy link resolves to the designated policy and its documented version matches the in-product notice version
