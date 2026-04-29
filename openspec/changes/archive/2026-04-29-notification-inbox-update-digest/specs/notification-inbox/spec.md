## ADDED Requirements

### Requirement: Notification history is persisted locally
The extension MUST persist recent Redmine issue notifications in local extension storage so read notifications remain available after popup reloads, service worker restarts, and browser restarts.

#### Scenario: Persisting a new notification
- **WHEN** the background notification check discovers a new Redmine issue notification
- **THEN** the extension stores the notification in local notification history with issue identity, display metadata, read state, update timestamp, source type, and any available change summary

#### Scenario: Loading history after restart
- **WHEN** the extension service worker or popup starts after notifications have already been stored
- **THEN** the extension loads persisted local notification history instead of relying only on in-memory notifications

#### Scenario: Limiting history size
- **WHEN** stored notification history exceeds the configured retention limit
- **THEN** the extension removes the oldest history entries until the history is within the retention limit

### Requirement: Inbox exposes unread, read, and all views
The popup MUST provide inbox views for unread notifications, read notifications, and all retained notifications, while keeping unread notifications as the default view.

#### Scenario: Opening the popup
- **WHEN** the user opens the popup
- **THEN** the popup displays the unread inbox view by default

#### Scenario: Viewing read notifications
- **WHEN** the user selects the read inbox view
- **THEN** the popup displays retained notifications that have been marked read

#### Scenario: Viewing all notifications
- **WHEN** the user selects the all inbox view
- **THEN** the popup displays retained unread and read notifications sorted by most recent update first

#### Scenario: Updating the badge
- **WHEN** notifications are read, cleared, added, or updated
- **THEN** the toolbar badge reflects only the unread notification count

### Requirement: Marking notifications read preserves history
The extension MUST preserve retained notification history when a user marks one or more notifications as read.

#### Scenario: Marking one notification as read
- **WHEN** the user marks a notification as read
- **THEN** the notification is hidden from the unread view and remains visible in the read and all views

#### Scenario: Marking all notifications as read
- **WHEN** the user marks all notifications as read
- **THEN** all retained unread notifications become read and remain visible in the read and all views

### Requirement: Inbox supports lightweight search
The popup MUST allow users to filter retained notifications by issue id, title or subject, project, and assignee text.

#### Scenario: Searching by issue id
- **WHEN** the user enters an issue id in the inbox search field
- **THEN** the popup displays matching retained notifications across the currently selected inbox view

#### Scenario: Searching by text metadata
- **WHEN** the user enters text matching a notification title, project, or assignee
- **THEN** the popup displays matching retained notifications across the currently selected inbox view

#### Scenario: Clearing search
- **WHEN** the user clears the inbox search field
- **THEN** the popup restores the full notification list for the currently selected inbox view

### Requirement: Issue updates include a change digest
The extension MUST generate a lightweight change digest when a retained issue notification changes and comparable issue fields differ from the last stored state.

#### Scenario: Status changes
- **WHEN** a Redmine issue notification changes from one status to another
- **THEN** the notification history entry includes a change summary item for the status field with previous and current values

#### Scenario: Priority changes
- **WHEN** a Redmine issue notification changes from one priority to another
- **THEN** the notification history entry includes a change summary item for the priority field with previous and current values

#### Scenario: Assignee changes
- **WHEN** a Redmine issue notification changes from one assignee to another
- **THEN** the notification history entry includes a change summary item for the assignee field with previous and current values

#### Scenario: Subject changes
- **WHEN** a Redmine issue notification changes from one subject to another
- **THEN** the notification history entry includes a change summary item for the subject field with previous and current values

#### Scenario: No comparable field changes are available
- **WHEN** an issue update is detected but no tracked comparable fields changed or prior state is unavailable
- **THEN** the notification indicates that the issue was updated without showing misleading field-level changes

### Requirement: Clear behavior is explicit
The popup MUST distinguish between clearing the current inbox notifications and clearing retained notification history when both actions are available.

#### Scenario: Clearing active notifications
- **WHEN** the user clears active notifications without choosing to clear history
- **THEN** the extension removes the current active notification list according to the selected action and does not silently delete retained history

#### Scenario: Clearing notification history
- **WHEN** the user chooses to clear retained notification history and confirms the action
- **THEN** the extension deletes retained notification history and resets the unread badge to zero
