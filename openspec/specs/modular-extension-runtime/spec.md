## Purpose

Define side-effect-free runtime module boundaries, dependency injection, synchronous Chrome event registration, and compatibility requirements for the extension service worker.

## Requirements

### Requirement: Runtime modules have explicit responsibilities
The background runtime MUST separate Redmine transport, notification policy, profile persistence, synchronization orchestration, runtime routing, and Chrome event bootstrap into independently loadable modules.

#### Scenario: Developer changes notification policy
- **WHEN** project eligibility, change classification, quiet hours, or bundling logic is modified
- **THEN** the change can be implemented and unit tested without loading Chrome events, storage, or Redmine transport

#### Scenario: Developer changes Redmine transport
- **WHEN** request, timeout, retry, pagination, or mutation logic is modified
- **THEN** the Redmine API module can be loaded and integration tested without executing the service-worker bootstrap

### Requirement: Module loading is side-effect free
Loading an extracted runtime module MUST NOT create runtime instances, read or write Chrome storage, register Chrome listeners, create alarms, start timers, or issue network requests.

#### Scenario: Module is loaded under Jest
- **WHEN** a test imports any extracted module
- **THEN** no Chrome API, timer, or fetch mock is called until the test explicitly invokes exported behavior

### Requirement: Background composition registers listeners synchronously
`background.js` MUST compose one production runtime and synchronously register all required Chrome listeners during service-worker evaluation before starting asynchronous initialization.

#### Scenario: Service worker starts
- **WHEN** Chrome evaluates the packaged service worker
- **THEN** install, startup, alarm, storage, runtime-message, and notification listeners are registered synchronously exactly once

#### Scenario: Module initialization follows registration
- **WHEN** listener registration completes
- **THEN** permitted asynchronous initialization such as alarm repair may run without starting an unconditional synchronization

### Requirement: Environmental dependencies are injectable
Runtime modules MUST receive browser APIs, transport functions, timers, clock, persistence, localization, and logging dependencies through constructors or factories instead of reading unrelated globals from domain logic.

#### Scenario: Deterministic test is created
- **WHEN** a unit or integration test supplies fake dependencies
- **THEN** the module uses those fakes without requiring a complete global Chrome environment

### Requirement: Existing runtime contracts remain compatible
The modularized runtime MUST preserve existing message action names, successful response fields, stable error codes, profile and storage schemas, synchronization behavior, desktop actions, and issue-action behavior.

#### Scenario: Existing Popup sends an action
- **WHEN** Popup or Options sends a currently supported runtime message
- **THEN** the modular router validates and dispatches it while returning a response compatible with the existing caller

#### Scenario: Existing persisted state is loaded
- **WHEN** the modular runtime starts with version 1.5.0 profile state
- **THEN** it reads and updates that state without a migration or key rename
