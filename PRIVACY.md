# MewMewNotification Privacy Policy

Privacy notice version: 1
Effective date: 2026-07-17

MewMewNotification is a Chrome extension that connects directly from your browser to a Redmine server that you configure. This policy describes the data handled by version 1.5.0 and later versions that declare privacy notice version 1.

## Data handled

The extension handles the Redmine server URL and API key that you enter, the verified Redmine user and project metadata returned by that server, and issue data needed to provide notifications and issue actions. Issue data can include issue identifiers, subjects, projects, assignees, statuses, priorities, update timestamps, notification history, read state, and change summaries.

The extension also stores operational preferences and local state such as language, check interval, notification filters, quiet hours, synchronization health, cursors, and a privacy acknowledgement record.

## Storage

- The Redmine API key is stored only in Chrome extension local storage on the current browser profile. It is not written to synchronized storage.
- Notification history, issue state, profile-scoped synchronization data, health data, and the privacy acknowledgement are stored in local extension storage.
- Non-sensitive preferences, including the configured Redmine URL and notification preferences, can be stored in Chrome synchronized extension storage.

The privacy acknowledgement contains only its notice version and acceptance timestamp. It does not contain credentials, server responses, or issue data.

## Optional diagnostics

Detailed diagnostics are disabled by default. If you explicitly enable them in Options, the extension stores only sanitized structured events in local extension storage. Each event contains a timestamp, level, stable event code, and allowlisted operational metadata. At most 100 events are retained, and events older than seven days are removed.

You can clear retained diagnostic events without disabling future capture, or disable diagnostics to immediately delete all retained events. The extension does not automatically upload diagnostic data and has no telemetry or diagnostic backend.

You can create a diagnostic JSON export even while event retention is disabled. The exported health snapshot can include the extension and schema versions, configuration booleans, transport scheme, permission and alarm state, synchronization timestamps and safe error codes, aggregate record counts, diagnostic settings, and a locally bound irreversible server fingerprint. It does not include API keys, full URLs or hostnames, server scope, binding or profile identifiers, issue identifiers or titles, comments, project or user names, request headers, response bodies, raw errors, or stacks.

An export leaves the device only when you explicitly download it. Review the JSON before deciding whether to share it with another person.

## Communication

The extension sends requests directly from your browser to the Redmine server URL that you configure. Requests include the API key required by Redmine and the minimum parameters needed for issue synchronization or an action you request.

MewMewNotification does not operate an intermediary service and does not transmit Redmine data to the extension developer. HTTPS is recommended. If you explicitly configure an HTTP server, the connection is not protected by HTTPS and the extension displays a warning.

## Collection and sharing

The extension developer does not collect, sell, rent, or share your API key, Redmine data, notification history, or usage data. The extension does not include advertising, analytics, or telemetry services.

Chrome and your configured Redmine server may process data under their own policies. Their operation is outside this extension's control.

## Retention and deletion

Data remains in extension storage until it is replaced by newer state, removed by retention limits, cleared through extension controls, removed by Chrome, or deleted when the extension is uninstalled. You can clear retained notification history from the Popup, clear or disable optional diagnostics from Options, and reset extension settings from Options. You can also remove all extension data by uninstalling the extension or clearing its site/extension storage in Chrome.

Removing a Redmine configuration or extension data does not delete data from the Redmine server. Use Redmine's own controls for server-side data.

## Changes

If this policy changes in a way that requires a new acknowledgement, the privacy notice version will increase and Options will ask you to acknowledge the updated notice before the next Redmine connection test or settings change. Existing configured background synchronization is not disabled solely because an updated notice has not yet been acknowledged.

## Contact

Questions or privacy concerns can be submitted through the project's public issue tracker:
https://github.com/CosmosChiang/MewMewNotification/issues
