(function initializeProfileStateRepository(root, factory) {
  const ProfileStateRepository = factory();

  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProfileStateRepository };
  } else {
    root.ProfileStateRepository = ProfileStateRepository;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createProfileStateRepository() {
  const PROFILE_STATE_SCHEMA_VERSION = 1;

  class ProfileStateRepository {
    constructor({ manager } = {}) {
      if (!manager) {
        throw new Error('profileStateManagerRequired');
      }
      this.manager = manager;
    }

    createBindingId() {
      return this.manager.createBindingId();
    }

    rotateCredentialBinding(apiKey) {
      return this.manager.rotateCredentialBinding(apiKey);
    }

    createProfileIdentity(redmineUrl, userId, apiKey) {
      return this.manager.createProfileIdentity(redmineUrl, userId, apiKey);
    }

    restoreActiveProfile(redmineUrl) {
      return this.manager.restoreActiveProfile(redmineUrl);
    }

    initializeAndActivate(identity) {
      return this.manager.initializeAndActivate(identity);
    }

    getActiveProfile() {
      return this.manager.getActiveProfile();
    }

    assertActiveProfile(profileId) {
      return this.manager.assertActiveProfile(profileId);
    }

    read(profileId, domain, fallback) {
      return this.manager.read(profileId, domain, fallback);
    }

    write(profileId, domain, value) {
      return this.manager.write(profileId, domain, value);
    }

    readHistory(profileId) {
      return this.read(profileId, 'history', []);
    }

    writeHistory(profileId, records) {
      return this.write(profileId, 'history', records);
    }

    readSyncHealth(profileId) {
      return this.read(profileId, 'syncHealth', null);
    }

    writeSyncHealth(profileId, health) {
      return this.write(profileId, 'syncHealth', health);
    }

    async getDiagnosticSummary() {
      const activeProfile = await this.getActiveProfile();
      if (!activeProfile?.profileId) {
        return {
          schemaVersion: PROFILE_STATE_SCHEMA_VERSION,
          active: false,
          bindingId: null,
          serverScope: null,
          syncHealth: null,
          counts: {
            history: 0,
            unread: 0,
            issueStates: 0,
            desktopMappings: 0
          }
        };
      }

      const [history, issueStates, syncHealth, desktopMappings] = await Promise.all([
        this.read(activeProfile.profileId, 'history', []),
        this.read(activeProfile.profileId, 'issueStates', {}),
        this.read(activeProfile.profileId, 'syncHealth', null),
        this.read(activeProfile.profileId, 'desktopMappings', [])
      ]);
      const normalizedHistory = Array.isArray(history) ? history : [];
      return {
        schemaVersion: PROFILE_STATE_SCHEMA_VERSION,
        active: true,
        bindingId: typeof activeProfile.bindingId === 'string' ? activeProfile.bindingId : null,
        serverScope: typeof activeProfile.serverScope === 'string' ? activeProfile.serverScope : null,
        syncHealth: syncHealth && typeof syncHealth === 'object' ? syncHealth : null,
        counts: {
          history: normalizedHistory.length,
          unread: normalizedHistory.filter(record => record?.read !== true).length,
          issueStates: issueStates && typeof issueStates === 'object' && !Array.isArray(issueStates)
            ? Object.keys(issueStates).length
            : 0,
          desktopMappings: Array.isArray(desktopMappings) ? desktopMappings.length : 0
        }
      };
    }
  }

  ProfileStateRepository.PROFILE_STATE_SCHEMA_VERSION = PROFILE_STATE_SCHEMA_VERSION;
  return ProfileStateRepository;
});
