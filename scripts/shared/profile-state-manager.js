const PROFILE_SCHEMA_VERSION = 1;
const PROFILE_KEY_PREFIX = `profileStateV${PROFILE_SCHEMA_VERSION}`;
const ACTIVE_PROFILE_KEY = `activeProfileV${PROFILE_SCHEMA_VERSION}`;
const PROFILE_INDEX_KEY = `profileIndexV${PROFILE_SCHEMA_VERSION}`;
const PROFILE_MIGRATION_KEY = `profileMigrationV${PROFILE_SCHEMA_VERSION}`;
const CREDENTIAL_BINDING_KEY = `credentialBindingV${PROFILE_SCHEMA_VERSION}`;
const PROFILE_DOMAINS = Object.freeze([
  'history',
  'issueStates',
  'readIds',
  'seenIds',
  'cursor',
  'projectCache',
  'syncHealth',
  'desktopMappings'
]);
const LEGACY_LOCAL_KEYS = Object.freeze({
  notificationHistory: 'history',
  issueStates: 'issueStates',
  seenNotifications: 'seenIds',
  lastSyncTime: 'cursor',
  notificationProjectMetadataCache: 'projectCache'
});
const MAX_READ_IDS = 1000;
const MAX_READ_IDS_BYTES = 64 * 1024;
const MAX_RETAINED_PROFILES = 5;

class ProfileStateManager {
  constructor(storage = chrome.storage, cryptoApi = globalThis.crypto) {
    this.storage = storage;
    this.crypto = cryptoApi;
  }

  static normalizeServerScope(input) {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('invalidRedmineUrl');
    }

    const pathname = url.pathname.replace(/\/+$/, '').replace(/\/{2,}/g, '/') || '';
    return `${url.origin.toLowerCase()}${pathname}`;
  }

  static storageKey(profileId, domain) {
    if (!PROFILE_DOMAINS.includes(domain)) {
      throw new Error('invalidProfileDomain');
    }
    if (typeof profileId !== 'string' || !/^[a-f0-9]{64}$/.test(profileId)) {
      throw new Error('invalidProfileId');
    }
    return `${PROFILE_KEY_PREFIX}:${profileId}:${domain}`;
  }

  static trimReadIds(values, maxEntries = MAX_READ_IDS, maxBytes = MAX_READ_IDS_BYTES) {
    const unique = Array.from(new Set((Array.isArray(values) ? values : [])
      .filter(value => typeof value === 'string' && value.length > 0)));
    while (unique.length > maxEntries || new TextEncoder().encode(JSON.stringify(unique)).length > maxBytes) {
      unique.shift();
    }
    return unique;
  }

  async sha256(value) {
    if (!this.crypto?.subtle) {
      throw new Error('profileCryptoUnavailable');
    }
    const bytes = new TextEncoder().encode(value);
    const digest = await this.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  createBindingId() {
    if (typeof this.crypto?.randomUUID === 'function') {
      return this.crypto.randomUUID();
    }
    if (!this.crypto?.getRandomValues) {
      throw new Error('profileCryptoUnavailable');
    }
    const bytes = this.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async ensureCredentialBinding(apiKey) {
    const result = await this.storage.local.get([CREDENTIAL_BINDING_KEY]);
    const existing = result?.[CREDENTIAL_BINDING_KEY];
    if (existing && typeof existing.bindingId === 'string') {
      return existing.bindingId;
    }
    return this.rotateCredentialBinding(apiKey);
  }

  async rotateCredentialBinding(_apiKey) {
    const binding = {
      bindingId: this.createBindingId(),
      createdAt: Date.now()
    };
    await this.storage.local.set({ [CREDENTIAL_BINDING_KEY]: binding });
    return binding.bindingId;
  }

  async createProfileIdentity(redmineUrl, userId, apiKey) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
      throw new Error('invalidCurrentUser');
    }
    const serverScope = ProfileStateManager.normalizeServerScope(redmineUrl);
    const bindingId = await this.ensureCredentialBinding(apiKey);
    const profileId = await this.sha256(`${serverScope}\n${Number(userId)}\n${bindingId}`);
    return { profileId, serverScope, userId: Number(userId), bindingId };
  }

  async restoreActiveProfile(redmineUrl) {
    const [active, binding] = await Promise.all([
      this.getActiveProfile(),
      this.storage.local.get([CREDENTIAL_BINDING_KEY])
    ]);
    const bindingId = binding?.[CREDENTIAL_BINDING_KEY]?.bindingId;
    if (!active || active.serverScope !== ProfileStateManager.normalizeServerScope(redmineUrl) || active.bindingId !== bindingId) {
      return null;
    }
    return active;
  }

  async initializeAndActivate(identity) {
    const keys = PROFILE_DOMAINS.map(domain => ProfileStateManager.storageKey(identity.profileId, domain));
    const existing = await this.storage.local.get([...keys, PROFILE_INDEX_KEY]);
    const defaults = {
      history: [], issueStates: {}, readIds: [], seenIds: [], cursor: null,
      projectCache: null, syncHealth: { lastSuccessAt: null, lastErrorCode: null }, desktopMappings: []
    };
    const initialization = {};
    PROFILE_DOMAINS.forEach((domain, index) => {
      if (existing[keys[index]] === undefined) initialization[keys[index]] = defaults[domain];
    });
    const oldIndex = Array.isArray(existing[PROFILE_INDEX_KEY]) ? existing[PROFILE_INDEX_KEY] : [];
    const index = [
      { profileId: identity.profileId, serverScope: identity.serverScope, userId: identity.userId, lastUsedAt: Date.now() },
      ...oldIndex.filter(item => item?.profileId !== identity.profileId)
    ];
    await this.storage.local.set({ ...initialization, [PROFILE_INDEX_KEY]: index });
    await this.migrateLegacyState(identity.profileId);
    await this.storage.local.set({
      [ACTIVE_PROFILE_KEY]: { ...identity, activatedAt: Date.now() }
    });
    await this.cleanupOrphanProfiles(identity.profileId, index);
    return identity;
  }

  async getActiveProfile() {
    const result = await this.storage.local.get([ACTIVE_PROFILE_KEY]);
    return result?.[ACTIVE_PROFILE_KEY] || null;
  }

  async assertActiveProfile(profileId) {
    const active = await this.getActiveProfile();
    if (!active || !profileId || active.profileId !== profileId) {
      const error = new Error('profileMismatch');
      error.code = 'profileMismatch';
      throw error;
    }
    return active;
  }

  async read(profileId, domain, fallback) {
    await this.assertActiveProfile(profileId);
    const key = ProfileStateManager.storageKey(profileId, domain);
    const result = await this.storage.local.get([key]);
    return result[key] === undefined ? fallback : result[key];
  }

  async write(profileId, domain, value) {
    await this.assertActiveProfile(profileId);
    const normalizedValue = domain === 'readIds' ? ProfileStateManager.trimReadIds(value) : value;
    await this.storage.local.set({ [ProfileStateManager.storageKey(profileId, domain)]: normalizedValue });
    return normalizedValue;
  }

  async migrateLegacyState(profileId) {
    const markerResult = await this.storage.local.get([PROFILE_MIGRATION_KEY]);
    if (markerResult?.[PROFILE_MIGRATION_KEY]?.status === 'complete') return;
    const localKeys = Object.keys(LEGACY_LOCAL_KEYS);
    const [local, sync] = await Promise.all([
      this.storage.local.get(localKeys),
      this.storage.sync.get(['readNotifications'])
    ]);
    const writes = {};
    let outcome = 'none';
    try {
      for (const [legacyKey, domain] of Object.entries(LEGACY_LOCAL_KEYS)) {
        if (local[legacyKey] !== undefined) {
          const value = local[legacyKey];
          const valid = domain === 'history' || domain === 'seenIds'
            ? Array.isArray(value)
            : domain === 'issueStates' || domain === 'projectCache'
              ? value !== null && typeof value === 'object' && !Array.isArray(value)
              : domain === 'cursor'
                ? typeof value === 'string'
                : true;
          if (valid) {
            writes[ProfileStateManager.storageKey(profileId, domain)] = domain === 'history'
              ? value.filter(record => record && typeof record === 'object').map(record => ({ ...record, profileId }))
              : value;
            outcome = 'migrated';
          } else {
            outcome = 'clearedMalformed';
          }
        }
      }
      if (sync?.readNotifications !== undefined) {
        writes[ProfileStateManager.storageKey(profileId, 'readIds')] =
          ProfileStateManager.trimReadIds(sync.readNotifications);
        outcome = Array.isArray(sync.readNotifications) ? 'migrated' : 'clearedMalformed';
      }
      await this.storage.local.set({
        ...writes,
        [PROFILE_MIGRATION_KEY]: { status: 'complete', outcome, completedAt: Date.now() }
      });
      await Promise.all([
        this.storage.local.remove(localKeys),
        this.storage.sync.remove(['readNotifications'])
      ]);
    } catch (error) {
      await this.storage.local.set({
        [PROFILE_MIGRATION_KEY]: { status: 'retryRequired', outcome: 'storageFailure', updatedAt: Date.now() }
      });
      throw error;
    }
  }

  async cleanupOrphanProfiles(activeProfileId, index) {
    const retained = index.slice(0, MAX_RETAINED_PROFILES);
    const orphans = index.slice(MAX_RETAINED_PROFILES).filter(item => item?.profileId !== activeProfileId);
    const keys = orphans.flatMap(item => PROFILE_DOMAINS.map(domain =>
      ProfileStateManager.storageKey(item.profileId, domain)));
    if (keys.length) await this.storage.local.remove(keys);
    await this.storage.local.set({ [PROFILE_INDEX_KEY]: retained });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ProfileStateManager, PROFILE_DOMAINS, ACTIVE_PROFILE_KEY, CREDENTIAL_BINDING_KEY,
    PROFILE_MIGRATION_KEY, PROFILE_INDEX_KEY, MAX_READ_IDS, MAX_READ_IDS_BYTES
  };
} else {
  globalThis.ProfileStateManager = ProfileStateManager;
}
