# Packaging and Release Runbook

Use Node 24 and install with `npm ci --ignore-scripts`.

```powershell
npm run quality
npm run test:integration -- --silent
npm run openspec:check
npm run audit:moderate
npm run package
npm run package:validate
npm run test:smoke
```

The ZIP and checksum are written to `dist/mewmew-notification-extension.zip` and `.sha256`. Verify a prospective tag with:

```powershell
$env:RELEASE_TAG = 'v1.5.0'
npm run version:check
```

CI uploads temporary artifacts for non-tag builds. Only a matching `v*` tag with all gates passing creates a GitHub release. Chrome Web Store publication remains a separately approved manual operation.
