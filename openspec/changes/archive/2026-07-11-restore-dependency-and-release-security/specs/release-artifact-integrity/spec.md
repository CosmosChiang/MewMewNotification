## ADDED Requirements

### Requirement: Release versions are consistent
Tag releases MUST verify that the Git tag equals `v` plus the manifest version and that package.json declares the same version before packaging or publishing.

#### Scenario: Version mismatch
- **WHEN** the tag, manifest version, or package version differs
- **THEN** the release job fails before creating a release artifact

#### Scenario: Versions match
- **WHEN** all three version sources match
- **THEN** packaging may proceed with that version as the release identity

### Requirement: Extension packaging uses one allowlist source
Local and CI packaging MUST use the same cross-platform implementation and versioned allowlist, and the resulting archive MUST contain only approved extension runtime files.

#### Scenario: Unexpected file enters staging
- **WHEN** ZIP inspection finds a file outside the allowlist
- **THEN** packaging fails and no release artifact is published

#### Scenario: Local and CI packaging run on same commit
- **WHEN** both environments build from the same commit and tool version
- **THEN** they produce the same approved file set

### Requirement: Published artifacts are verifiable
Every release ZIP MUST include a published SHA-256 checksum and MUST have build provenance or artifact attestation tied to its source commit and workflow.

#### Scenario: Release completes
- **WHEN** a versioned ZIP is attached to a release
- **THEN** its checksum and verifiable provenance are published with it

#### Scenario: Artifact verification fails
- **WHEN** the downloaded ZIP does not match its checksum or attestation
- **THEN** the artifact is treated as untrusted
