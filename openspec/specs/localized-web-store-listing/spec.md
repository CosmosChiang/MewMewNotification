# localized-web-store-listing Specification

## Purpose
TBD - created by archiving change refresh-chrome-web-store-listing. Update Purpose after archive.
## Requirements
### Requirement: Listing metadata covers every supported locale
The repository SHALL provide Chrome Web Store short descriptions, detailed descriptions, screenshot captions, and release notes for every locale declared by the extension.

#### Scenario: Locale coverage is validated
- **WHEN** listing assets are validated
- **THEN** English, Traditional Chinese, Simplified Chinese, and Japanese each have complete non-empty metadata without fallback copy

### Requirement: Screenshots represent current user workflows
The repository SHALL define five store screenshot scenes covering notification inbox management, issue change digests, direct issue actions, notification focus controls, and safe desktop notification behavior.

#### Scenario: A locale screenshot set is generated
- **WHEN** the screenshot generator runs for a supported locale
- **THEN** it produces one screenshot for each of the five required workflow scenes

### Requirement: Generated store media has a deterministic contract
The screenshot workflow MUST generate exactly five PNG files per supported locale at 1280x800 pixels using predictable locale and scene filenames.

#### Scenario: Generated media is validated
- **WHEN** the media validator examines the output directory
- **THEN** all twenty expected PNG files exist, have the required dimensions, and no expected locale or scene is missing

### Requirement: Store assets use safe representative data
Store screenshots and listing copy MUST NOT contain real Redmine credentials, private hosts, personal user data, or claims unsupported by canonical extension specifications.

#### Scenario: Mock screens are rendered
- **WHEN** a screenshot displays a Redmine host, issue, project, or assignee
- **THEN** it uses synthetic example data suitable for public distribution

### Requirement: Promotional images follow the Chrome Web Store media contract
The repository SHALL provide one locale-neutral small promotional PNG at 440x280 pixels and one locale-neutral marquee promotional PNG at 1400x560 pixels using brand-led, text-light artwork.

#### Scenario: Promotional media is generated
- **WHEN** the Web Store media generator runs
- **THEN** it produces the small and marquee promotional images at their exact required dimensions without locale-specific copy

#### Scenario: Promotional media is validated
- **WHEN** the media validator examines promotional assets
- **THEN** both expected PNG files exist, match their required dimensions, and contain no unexpected legacy promotional files

### Requirement: Publication is repeatable and reviewable
The repository SHALL document commands to generate and validate localized assets and SHALL provide an upload checklist covering version, package, privacy, permissions, locale copy, and screenshot selection.

#### Scenario: Maintainer prepares a store update
- **WHEN** the maintainer follows the publication documentation
- **THEN** they can regenerate the media, review localized copy, validate the artifact set, and identify every manual Developer Dashboard step
