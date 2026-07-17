const {
  PRIVACY_NOTICE_VERSION,
  PRIVACY_CONSENT_STORAGE_KEY,
  isCurrentPrivacyConsent,
  readPrivacyConsent,
  writePrivacyConsent
} = require('./privacy-consent.js');

describe('privacy consent', () => {
  test('rejects missing and stale consent records', () => {
    expect(isCurrentPrivacyConsent(null)).toBe(false);
    expect(isCurrentPrivacyConsent({
      version: PRIVACY_NOTICE_VERSION - 1,
      acceptedAt: 123
    })).toBe(false);
    expect(isCurrentPrivacyConsent({
      version: PRIVACY_NOTICE_VERSION,
      acceptedAt: 123
    })).toBe(true);
  });

  test('writes only the version and timestamp to the provided local storage area', async () => {
    const localStorage = {
      set: jest.fn().mockResolvedValue(undefined)
    };
    const syncStorage = {
      set: jest.fn()
    };

    const consent = await writePrivacyConsent(localStorage, 1700000000000);

    expect(consent).toEqual({
      version: PRIVACY_NOTICE_VERSION,
      acceptedAt: 1700000000000
    });
    expect(localStorage.set).toHaveBeenCalledWith({
      [PRIVACY_CONSENT_STORAGE_KEY]: consent
    });
    expect(syncStorage.set).not.toHaveBeenCalled();
  });

  test('reads the acknowledgement without accepting malformed records', async () => {
    const storage = {
      get: jest.fn().mockResolvedValue({
        [PRIVACY_CONSENT_STORAGE_KEY]: {
          version: PRIVACY_NOTICE_VERSION,
          acceptedAt: 0
        }
      })
    };

    const consent = await readPrivacyConsent(storage);

    expect(storage.get).toHaveBeenCalledWith([PRIVACY_CONSENT_STORAGE_KEY]);
    expect(isCurrentPrivacyConsent(consent)).toBe(false);
  });

  test('handles unavailable storage dependencies safely', async () => {
    await expect(readPrivacyConsent()).resolves.toBeNull();
    await expect(writePrivacyConsent()).rejects.toThrow('privacyConsentStorageUnavailable');
    expect(isCurrentPrivacyConsent({
      version: PRIVACY_NOTICE_VERSION,
      acceptedAt: Number.NaN
    })).toBe(false);
  });
});
