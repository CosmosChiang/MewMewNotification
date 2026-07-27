## ADDED Requirements

### Requirement: Public listing describes credential storage accurately
Chrome Web Store copy and screenshots MUST state that the Redmine API key is stored only in local extension storage and is not synchronized across devices.

#### Scenario: Credential storage copy is validated
- **WHEN** localized listing metadata is prepared for publication
- **THEN** every locale describes local-only credential storage and contains no claim that the API key is stored in synchronized storage
