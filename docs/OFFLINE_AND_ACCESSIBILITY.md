# Offline, Freshness, Sound, and Accessibility

The popup uses cached-first loading. Saved notification history is rendered immediately, followed by one background revalidation. If Redmine is unavailable, saved cards stay visible and the live status region identifies the data as stale with a safe error code and a retry control.

Sync status distinguishes syncing, successful refresh with the last-success time, stale data, failure, and scheduled retry. Mark-read, mark-all, open, refresh, and issue-action failures are announced without replacing retained history or exposing server response bodies.

The notification sound preference maps to Chrome's `silent` delivery option. Browser and operating-system notification settings may still override sound behavior.

Popup history is bounded to 100 natural-height cards; fixed-height virtualization and rerendered scroll listeners are not used. Popup and Options tabs support Arrow Left/Right, Home, and End, expose tab/tabpanel relationships, update the document language, and use live regions for dynamic status. Interactive content has visible keyboard focus. Nonessential transitions and animations are reduced when `prefers-reduced-motion: reduce` is active.
