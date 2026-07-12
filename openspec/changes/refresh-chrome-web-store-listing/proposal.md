## Why

The public Chrome Web Store listing still presents version 1.4.1-era behavior and incorrectly states that API credentials use synchronized storage, while the repository is at version 1.5.0 with a richer notification inbox, focus controls, safer local credential storage, and hardened desktop-notification actions. The listing screenshots also cover only Traditional Chinese and English even though the extension supports four locales.

## What Changes

- Replace the existing five-scene store screenshot story with current 1.5.0 workflows: inbox management, change digests, issue actions, notification focus controls, and safe desktop-notification behavior.
- Make the screenshot source data-driven for English, Traditional Chinese, Simplified Chinese, and Japanese.
- Generate five 1280x800 PNG screenshots for every supported store locale and validate their dimensions and expected file set.
- Add localized Chrome Web Store short descriptions, detailed descriptions, screenshot captions, and 1.5.0 release notes.
- Add a repeatable generation and validation workflow plus an upload checklist that keeps version, privacy, permissions, packaged artifact, and localized media aligned.
- Add shared, text-light 440x280 small and 1400x560 marquee promotional images that emphasize the extension brand and notification workflow.

## Capabilities

### New Capabilities
- `localized-web-store-listing`: Defines the localized listing copy, screenshot scenes, generated media contract, and publication checklist for every supported extension locale.

### Modified Capabilities
- `secure-credential-storage`: Corrects the public-facing storage claim so API credentials are described as local-only and not synchronized across devices.
- `desktop-notification-actions`: Requires store-facing documentation to distinguish local mark-read behavior from Redmine mutations and to describe safe issue-opening behavior accurately.

## Impact

- Affects `docs/webstore-screenshots/`, `docs/webstore-promotional/`, their HTML sources, generated PNG media, and new localized listing-copy documentation.
- Adds repository tooling and package scripts for deterministic screenshot generation and media validation using the existing Playwright development dependency.
- Does not change extension runtime behavior, permissions, APIs, or packaged production files.
