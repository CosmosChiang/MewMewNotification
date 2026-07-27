## 1. Canonical OpenSpec Baseline

- [x] 1.1 Archive `refresh-chrome-web-store-listing` and confirm its localized listing requirement becomes canonical.
- [x] 1.2 Restore the latest shipped requirements for the eight archive-only capabilities with canonical `Purpose` and `Requirements` sections.
- [x] 1.3 Update canonical CI requirements to match Node 22/24, current quality/integration/package jobs, and tag-only release publication.
- [x] 1.4 Run strict validation and confirm no completed change remains active and no shipped capability depends exclusively on archive content.

## 2. Privacy Policy and Acknowledgement

- [x] 2.1 Add `PRIVACY.md` with version, handled data, storage, Redmine communication, retention, deletion, collection, sharing, and contact disclosures.
- [x] 2.2 Add localized Options disclosure, acknowledgement control, validation messages, and a link to the public policy.
- [x] 2.3 Implement local-only `privacyNoticeConsentV1` persistence and require the current version before first connection testing or Redmine-setting storage.
- [x] 2.4 Preserve existing configured background synchronization while requiring acknowledgement on the next relevant Options action.
- [x] 2.5 Link the policy from both READMEs and the Chrome Web Store release checklist and validate policy/version consistency.
- [x] 2.6 Add unit tests for missing consent, accepted consent, stale policy version, local-only storage, and existing-user behavior.

## 3. Permission Minimization

- [x] 3.1 Remove `activeTab` from the manifest and update permission documentation.
- [x] 3.2 Extend package or manifest validation to reject unexpected required permissions.
- [x] 3.3 Extend Chromium smoke coverage to verify popup and desktop issue links still open without `activeTab`.

## 4. Dependency and CI Hardening

- [x] 4.1 Upgrade `js-yaml` and `adm-zip` on the feature branch and refresh the lockfile from the supported Node toolchain.
- [x] 4.2 Remediate vulnerable transitive packages without `--force` or runtime dependencies and confirm zero moderate-or-higher findings.
- [x] 4.3 Replace the high-only audit command and CI step with `npm audit --audit-level=moderate`.
- [x] 4.4 Run workflow parsing, unit, integration, smoke, package, checksum, and reproducibility validation after dependency upgrades.
- [x] 4.5 Record Dependabot PRs #12 and #13 as superseded by this verified feature change for closure after merge.

## 5. Final Verification

- [x] 5.1 Run lint, locale parity, full Jest coverage, Fake Redmine integration, and Chromium smoke tests.
- [x] 5.2 Run strict OpenSpec, Web Store asset, version, package allowlist, checksum, and moderate audit validation.
- [x] 5.3 Run `git diff --check` and document privacy, permission, dependency, and canonical-spec outcomes in the implementation report.
