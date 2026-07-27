(function initializePrivacyConsent(root, factory) {
  const api = factory();

  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PrivacyConsent = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPrivacyConsentApi() {
  const PRIVACY_NOTICE_VERSION = 1;
  const PRIVACY_CONSENT_STORAGE_KEY = 'privacyNoticeConsentV1';

  function isCurrentPrivacyConsent(consent) {
    return Boolean(
      consent
      && consent.version === PRIVACY_NOTICE_VERSION
      && Number.isFinite(consent.acceptedAt)
      && consent.acceptedAt > 0
    );
  }

  async function readPrivacyConsent(storageArea) {
    if (!storageArea?.get) {
      return null;
    }

    const result = await storageArea.get([PRIVACY_CONSENT_STORAGE_KEY]);
    return result?.[PRIVACY_CONSENT_STORAGE_KEY] || null;
  }

  async function writePrivacyConsent(storageArea, now = Date.now()) {
    if (!storageArea?.set) {
      throw new Error('privacyConsentStorageUnavailable');
    }

    const consent = {
      version: PRIVACY_NOTICE_VERSION,
      acceptedAt: now
    };

    await storageArea.set({
      [PRIVACY_CONSENT_STORAGE_KEY]: consent
    });
    return consent;
  }

  return {
    PRIVACY_NOTICE_VERSION,
    PRIVACY_CONSENT_STORAGE_KEY,
    isCurrentPrivacyConsent,
    readPrivacyConsent,
    writePrivacyConsent
  };
});
