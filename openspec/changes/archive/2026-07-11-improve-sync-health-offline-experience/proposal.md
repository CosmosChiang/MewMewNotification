## Why

The Popup currently waits for live sync after it opens, and if background sync fails it may still return success with stale history, so users cannot tell whether the data is current. Sound settings also do not actually take effect, variable-height cards do not match virtual scrolling, and keyboard and assistive technologies still lack full state semantics.

## What Changes

- Make the Popup cached-first and stale-while-revalidate: show local history first, then sync in the background.
- Show syncing, last success, stale, error code, and retry state, and make mark/open/action failures visible.
- Make the sound toggle actually control the silent behavior of desktop notifications; if the platform does not support it, degrade clearly.
- Fix the notification list listener lifecycle and variable-height rendering to avoid overlap, clipping, and handler buildup.
- Add keyboard behavior, ARIA live regions, focus management, and reduced motion support for the page language, tabs, cards, and advanced actions.

## Capabilities

### New Capabilities

- `sync-health-offline-experience`: Defines a cached-first inbox, data freshness, sync health status, and visible error/retry feedback.
- `extension-accessibility`: Defines the keyboard, semantics, focus, live region, language, and reduced-motion baseline for Popup and Options.
- `notification-delivery-preferences`: Defines consistency between the sound setting and the actual delivery options for desktop notifications, plus platform fallback behavior.

### Modified Capabilities

None.

## Impact

This primarily affects `scripts/popup.js`, `popup.html`, `styles/popup.css`, `scripts/options.js`, `options.html`, `styles/options.css`, the locales, and background runtime responses. This change depends on a stable `SyncResult`, but it does not include the lossless query engine itself.
