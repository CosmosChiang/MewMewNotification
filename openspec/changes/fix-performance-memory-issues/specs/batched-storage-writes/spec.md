## ADDED Requirements

### Requirement: Issue state persistence is batched after all issues are processed
The extension's notification check loop SHALL accumulate all issue state changes in memory during iteration and perform a single `chrome.storage.local.set()` call after the loop completes. Individual per-issue `persistIssueState()` calls inside the loop MUST NOT be made.

#### Scenario: Multiple issues processed in one check cycle
- **WHEN** the notification check cycle processes N issues (N > 1)
- **THEN** exactly one `chrome.storage.local.set()` call is made for issue states after all N issues are processed

#### Scenario: Single issue processed in one check cycle
- **WHEN** the notification check cycle processes exactly one issue
- **THEN** exactly one `chrome.storage.local.set()` call is made for issue states

#### Scenario: Storage write failure does not lose all state updates
- **WHEN** the batched `chrome.storage.local.set()` call fails
- **THEN** the error is caught and logged; the next check cycle will attempt to persist the current state again
