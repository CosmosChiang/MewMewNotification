(function initializeRuntimeBootstrap(root, factory) {
  const exports = factory();

  /* istanbul ignore else -- browser export is verified by packaged Chromium smoke */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    Object.assign(root, exports);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntimeBootstrapExports() {
  function registerRuntimeListeners({
    chrome,
    notificationService,
    router,
    ensurePeriodicAlarm,
    alarmName,
    retryAlarmName,
    hostPermissionRecoveryNotificationId,
    diagnosticEventStore,
    logger
  }) {
    chrome.runtime.onInstalled.addListener(() => {
      ensurePeriodicAlarm()
        .then(() => notificationService.requestSync('installed'))
        .catch(() => logger.error('install_sync_failed', { errorCode: 'installSyncFailed' }));
    });

    chrome.runtime.onStartup.addListener(() => {
      ensurePeriodicAlarm()
        .then(() => notificationService.requestSync('startup'))
        .catch(() => logger.error('startup_sync_failed', { errorCode: 'startupSyncFailed' }));
    });

    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === alarmName) {
        notificationService.requestSync('alarm');
      } else if (alarm.name === retryAlarmName) {
        notificationService.requestSync('retryAlarm');
      }
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
      diagnosticEventStore?.handleStorageChanged(changes, namespace);

      if (namespace === 'sync') {
        const settingKeys = [
          'redmineUrl',
          'checkInterval',
          'enableNotifications',
          'enableSound',
          'maxNotifications',
          'onlyMyProjects',
          'includeWatchedIssues',
          'readNotifications',
          'notificationProjectRules',
          'notificationChangeFilters',
          'notificationQuietHours',
          'notificationBundling'
        ];
        if (Object.keys(changes).some(key => settingKeys.includes(key))) {
          notificationService.loadSettings().then(() => {
            if (changes.redmineUrl) {
              return notificationService.clearRetryMetadata();
            }
            return undefined;
          }).then(() => {
            if (changes.checkInterval) {
              return ensurePeriodicAlarm();
            }
            return undefined;
          }).catch(() => logger.error('settings_reload_failed', { errorCode: 'settingsReloadFailed' }));
        }
        if (changes.language) {
          notificationService.loadLanguage();
        }
      }

      if (namespace === 'local' && changes.apiKey) {
        const oldKey = changes.apiKey.oldValue;
        const newKey = changes.apiKey.newValue;
        const rotateBinding = notificationService.profileState && oldKey !== newKey
          ? notificationService.profileState.rotateCredentialBinding(newKey)
          : Promise.resolve();
        rotateBinding.then(() => {
          notificationService.activeProfile = null;
          return notificationService.clearRetryMetadata();
        }).then(() => notificationService.loadSettings())
          .catch(() => logger.error('credential_binding_rotate_failed', {
            errorCode: 'credentialBindingRotateFailed'
          }));
      }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => (
      router.handleMessage(request, sender, sendResponse)
    ));

    chrome.notifications.onClicked.addListener(notificationId => {
      if (
        notificationId === hostPermissionRecoveryNotificationId
        && chrome.runtime.openOptionsPage
      ) {
        chrome.runtime.openOptionsPage();
        return;
      }
      notificationService.handleDesktopClick(notificationId)
        .catch(() => logger.error('desktop_notification_click_failed', {
          errorCode: 'desktopClickFailed'
        }));
    });

    chrome.notifications.onButtonClicked?.addListener((notificationId, buttonIndex) => {
      notificationService.handleDesktopButton(notificationId, buttonIndex)
        .catch(() => logger.error('desktop_notification_button_failed', {
          errorCode: 'desktopButtonFailed'
        }));
    });

    chrome.notifications.onClosed?.addListener(notificationId => {
      notificationService.removeDesktopMapping(notificationId)
        .catch(() => logger.error('desktop_notification_cleanup_failed', {
          errorCode: 'desktopCleanupFailed'
        }));
    });
  }

  function createPeriodicAlarmEnsurer({ chrome, notificationService, alarmName }) {
    return async function ensurePeriodicAlarm() {
      await notificationService.loadSettings({ notifyPermissionRecovery: true });
      const intervalMinutes = notificationService.settings.checkInterval || 15;
      const currentAlarm = await new Promise(resolve => chrome.alarms.get(alarmName, resolve));
      if (currentAlarm && Number(currentAlarm.periodInMinutes) === Number(intervalMinutes)) {
        return { changed: false, alarm: currentAlarm };
      }
      if (currentAlarm) {
        await new Promise(resolve => chrome.alarms.clear(alarmName, () => resolve()));
      }
      chrome.alarms.create(alarmName, { periodInMinutes: intervalMinutes });
      return { changed: true, periodInMinutes: intervalMinutes };
    };
  }

  return {
    registerRuntimeListeners,
    createPeriodicAlarmEnsurer
  };
});
