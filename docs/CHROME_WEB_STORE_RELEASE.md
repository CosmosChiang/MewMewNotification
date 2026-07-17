# Chrome Web Store release runbook

The localized Chrome Web Store source is `docs/webstore-screenshots/source/listing-data.js`. It covers `en`, `zh_TW`, `zh_CN`, and `ja` and must stay aligned with `manifest.json` and `_locales/`.

## Regenerate and review

```powershell
npm run webstore:copy
npm run webstore:screenshots
npm run webstore:check
```

Review `docs/webstore-listing.md` and all five PNG files for each locale under `docs/webstore-screenshots/`. Every screenshot must be 1280x800. Also review the locale-neutral promotional images under `docs/webstore-promotional/`: `mewmewnotification-promo-small.png` must be 440x280 and `mewmewnotification-promo-marquee.png` must be 1400x560. Confirm that all edges and key artwork remain clear at reduced size.

## Upload checklist

- [ ] Developer Dashboard package version matches `manifest.json` and `package.json` (`1.5.0` for this update).
- [ ] Upload `dist/mewmew-notification-extension.zip` only after `npm run package:validate` succeeds.
- [ ] Short description, detailed description, release notes, and five captions are copied from the matching locale section in `docs/webstore-listing.md`.
- [ ] Five screenshots named `mewmewnotification-webstore-<locale>-1.png` through `-5.png` are uploaded to the matching localized listing.
- [ ] `mewmewnotification-promo-small.png` is uploaded as the required small promotional image.
- [ ] `mewmewnotification-promo-marquee.png` is uploaded as the optional marquee promotional image.
- [ ] Promotional images are uploaded once as shared locale-neutral artwork; they contain no locale-specific copy.
- [ ] English, Traditional Chinese, Simplified Chinese, and Japanese listings are all reviewed in the Dashboard preview.
- [ ] Privacy disclosure remains consistent with runtime behavior: no collection or sale of user data; API keys remain only in local extension storage and do not synchronize across devices.
- [ ] Public [privacy policy version 1](https://github.com/CosmosChiang/MewMewNotification/blob/main/PRIVACY.md) is linked in both READMEs and Options, and the Developer Dashboard uses the same URL.
- [ ] Permission justification covers storage, notifications, alarms, background service worker, and optional per-Redmine-origin host access; `activeTab` remains absent.
- [ ] Listing copy does not claim universal desktop notification buttons. Open issue and Mark read buttons are platform-dependent.
- [ ] Mark read is understood as changing retained extension notification state only; it does not mutate the Redmine issue.
- [ ] Batch notifications and unsupported button environments retain the Popup inbox fallback.
- [ ] Support URL, developer email, privacy policy, category, and language selections are current.
- [ ] Final Dashboard preview contains no obsolete `sync storage` API-key claim and no real host, credential, issue, or user data.
- [ ] Promotional image review status is checked after submission; a pending or rejected image is followed up in the Promotional Images section.

## Final verification

```powershell
npm run locale:check
npm run webstore:check
npm run package:validate
npm run lint
npm test -- --detectOpenHandles --silent
openspec validate --all --strict
```

Chrome Web Store submission and review remain manual external steps.
