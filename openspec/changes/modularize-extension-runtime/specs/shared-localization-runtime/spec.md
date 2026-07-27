## ADDED Requirements

### Requirement: Extension contexts share one localization implementation
Background, Options, and Popup MUST use the same `I18nManager` for language selection, locale loading, English fallback, parameter substitution, and missing-key behavior.

#### Scenario: Supported language is selected
- **WHEN** any extension context loads a supported locale
- **THEN** it resolves messages and substitutions through the shared manager with the same result

#### Scenario: Locale file cannot be loaded
- **WHEN** a selected non-English locale fails to load
- **THEN** the manager attempts English once and then returns a deterministic empty translation state with a safe error code if English also fails

### Requirement: Localization dependencies are injectable
`I18nManager` MUST accept storage, fetch, locale URL resolution, optional document root, and logger dependencies and MUST NOT require `window`.

#### Scenario: Service worker loads localization
- **WHEN** the manager runs without a DOM or `window`
- **THEN** it loads and translates messages without attempting document updates

#### Scenario: Extension page loads localization
- **WHEN** Popup or Options loads a language
- **THEN** the manager sets the provided document root language using a valid BCP 47 form

### Requirement: Controllers contain only presentation mappings
Popup and Options MUST delegate locale retrieval, fallback, and translation to `I18nManager` while retaining only their element-to-message mappings and context-specific UI updates.

#### Scenario: Translation behavior changes
- **WHEN** fallback or substitution behavior is updated
- **THEN** the change is made once in `I18nManager` and covered for all three extension contexts
