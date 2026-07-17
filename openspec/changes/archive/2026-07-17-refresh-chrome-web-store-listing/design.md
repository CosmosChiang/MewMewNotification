## Context

The repository currently keeps ten generated 1280x800 screenshots beside one HTML source that contains Traditional Chinese markup and a partial English override. The public listing remains on 1.4.1, while the current extension and documentation describe 1.5.0 behavior across four locales. Store media and copy need a single reviewable source so localized claims do not drift from runtime behavior.

## Goals / Non-Goals

**Goals:**

- Keep all localized screenshot copy and listing metadata in version-controlled, reviewable files.
- Generate exactly five deterministic 1280x800 screenshots for each manifest locale.
- Generate one shared 440x280 small promotional image and one shared 1400x560 marquee image.
- Present current user-visible capabilities without exposing real credentials, hosts, users, or issue data.
- Validate the generated file matrix, dimensions, locale coverage, and prohibited obsolete claims.
- Provide a practical Chrome Web Store upload checklist.

**Non-Goals:**

- Automating submission to the Chrome Web Store Developer Dashboard.
- Changing extension runtime behavior, manifest permissions, or version.
- Claiming that desktop notification buttons appear on every operating system.
- Capturing a live Redmine server or real user data.

## Decisions

### Use one static HTML renderer with locale dictionaries

The screenshot source will expose five stable scenes and select copy with `locale=<manifest-locale>`. A complete dictionary is preferred over separate HTML files because layout changes remain consistent across all locales. Missing keys will be treated as generation errors rather than silently falling back.

### Generate media with the existing Playwright dependency

A Node script will open the local HTML file at a fixed 1280x800 viewport, select each locale and scene, wait for fonts and images, and write predictable PNG filenames. Reusing Playwright avoids adding a new rendering dependency and makes generation suitable for local and CI execution.

### Separate listing metadata from rendered screenshot implementation

Localized short descriptions, detailed descriptions, screenshot captions, and release notes will live in a machine-readable JSON source. A generated Markdown preview will make the content easy to review and copy into the Developer Dashboard. Screenshot headline/body copy will be stored in the same locale records so terminology stays aligned.

### Treat generated PNGs as committed release assets

The PNGs will remain committed because they are manually uploaded outside the packaged extension. Validation will confirm the 20-file matrix and dimensions; reviewers can compare source and generated output in one change.

### Use representative mock data only

Scenes will use `redmine.example.com`, generic projects and assignees, and synthetic issue numbers. Security claims will be limited to behavior backed by canonical specs: local-only API key storage, host permission validation, profile-scoped mappings, and safe local mark-read behavior.

### Keep promotional images locale-neutral and brand-led

Promotional images will use the extension icon, saturated brand colors, and abstract notification/change-digest cards with no locale-dependent copy. This follows the store constraint that promotional images are shared across locales and preserves readability when the small tile is reduced.

## Risks / Trade-offs

- **Localized strings overflow at 1280x800** → Keep locale-specific typography sizing available and visually inspect every generated PNG.
- **Browser or font rendering varies slightly by host** → Fix viewport, hide animation, wait for fonts, and validate dimensions rather than binary hashes.
- **Marketing copy overstates platform button support** → Use conditional wording such as “when supported” and keep primary-click/inbox fallback visible in the checklist.
- **The store listing drifts after future releases** → Provide generation, validation, and upload-check commands in the repository and include version/privacy checks in the checklist.
- **Twenty committed PNGs increase repository size** → Limit the set to the five Chrome Web Store scenes per supported locale and avoid redundant variants.
- **Promotional art is rejected or unreadable at reduced size** → Avoid body copy, fill the full canvas, keep strong edge contrast, and visually inspect both required dimensions.

## Migration Plan

1. Add localized listing data, renderer updates, and generator/validator scripts.
2. Generate and visually review all twenty screenshots plus the small and marquee promotional images.
3. Run locale, media, package, OpenSpec, and full test validation.
4. Upload the four localized listing records and their five matching screenshots in the Developer Dashboard.
5. Upload the already validated 1.5.0 extension package and complete the privacy/version checklist before submission.

Rollback consists of restoring the previous listing copy and screenshot set in the Developer Dashboard; no extension runtime rollback is required.

## Open Questions

- Chrome Web Store review and platform-specific screenshot rendering remain external manual verification steps.
