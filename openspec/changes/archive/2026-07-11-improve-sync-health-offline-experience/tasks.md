## 1. Prerequisite Contract and Localization

- [x] 1.1 Confirm the stable SyncResult contract from notification sync lifecycle is implemented
- [x] 1.2 Add versioned sync-health fields and safe localized status/error mappings
- [x] 1.3 Restore locale key parity and update document language when locale changes

## 2. Cached-First Popup and Visible Health

- [x] 2.1 Load retained history and freshness before starting background revalidation
- [x] 2.2 Render syncing, last success, stale, error, and retry-scheduled states without hiding cached history
- [x] 2.3 Surface mark-read, mark-all, open, refresh, and issue-action failures with safe retry behavior

## 3. Delivery and Rendering Correctness

- [x] 3.1 Apply `silent: !enableSound` to every desktop notification and test supported platform options
- [x] 3.2 Remove fixed-height virtualization and duplicate scroll-listener paths for the bounded history list
- [x] 3.3 Measure and test up to 100 long, localized, multi-summary cards without clipping or duplicate handlers

## 4. Accessibility

- [x] 4.1 Implement full tablist/tab/panel semantics and arrow/Home/End keyboard navigation in Popup and Options
- [x] 4.2 Make cards, advanced actions, destructive controls, and retry paths keyboard operable with visible focus
- [x] 4.3 Add appropriate live regions, focus restoration, accessible names, and localized error announcements
- [x] 4.4 Add reduced-motion CSS and ensure state remains visible without decorative animation

## 5. Verification and Documentation

- [x] 5.1 Test online cached-first, offline stale, retry scheduled, and action failure flows
- [x] 5.2 Add keyboard, ARIA-state, document-lang, reduced-motion, sound, and variable-height tests
- [x] 5.3 Update user documentation for freshness, offline behavior, sound, and accessibility
- [x] 5.4 Run unit, browser smoke, locale parity, accessibility checks, and strict OpenSpec validation
