const {
  createPeriodicAlarmEnsurer,
  registerRuntimeListeners
} = require('./runtime-bootstrap.js');

function event() {
  return { addListener: jest.fn() };
}

function createChrome() {
  return {
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
      openOptionsPage: jest.fn()
    },
    alarms: {
      onAlarm: event(),
      get: jest.fn((_name, callback) => callback(undefined)),
      clear: jest.fn((_name, callback) => callback(true)),
      create: jest.fn()
    },
    storage: {
      onChanged: event()
    },
    notifications: {
      onClicked: event(),
      onButtonClicked: event(),
      onClosed: event()
    }
  };
}

describe('runtime bootstrap', () => {
  test('registers every listener exactly once before invoking async work', () => {
    const chrome = createChrome();
    const service = {
      requestSync: jest.fn(),
      loadSettings: jest.fn().mockResolvedValue(undefined),
      loadLanguage: jest.fn(),
      clearRetryMetadata: jest.fn().mockResolvedValue(undefined),
      handleDesktopClick: jest.fn().mockResolvedValue(undefined),
      handleDesktopButton: jest.fn().mockResolvedValue(undefined),
      removeDesktopMapping: jest.fn().mockResolvedValue(undefined),
      profileState: null
    };
    const router = { handleMessage: jest.fn(() => true) };
    const ensurePeriodicAlarm = jest.fn().mockResolvedValue(undefined);
    const logger = { error: jest.fn() };

    registerRuntimeListeners({
      chrome,
      notificationService: service,
      router,
      ensurePeriodicAlarm,
      alarmName: 'check',
      retryAlarmName: 'retry',
      hostPermissionRecoveryNotificationId: 'recover',
      logger
    });

    const events = [
      chrome.runtime.onInstalled,
      chrome.runtime.onStartup,
      chrome.runtime.onMessage,
      chrome.alarms.onAlarm,
      chrome.storage.onChanged,
      chrome.notifications.onClicked,
      chrome.notifications.onButtonClicked,
      chrome.notifications.onClosed
    ];
    events.forEach(item => expect(item.addListener).toHaveBeenCalledTimes(1));
    expect(service.requestSync).not.toHaveBeenCalled();
    expect(ensurePeriodicAlarm).not.toHaveBeenCalled();
  });

  test('routes install, startup, alarms, messages, storage, and notification actions', async () => {
    const chrome = createChrome();
    const service = {
      activeProfile: {},
      requestSync: jest.fn().mockResolvedValue({ success: true }),
      loadSettings: jest.fn().mockResolvedValue(undefined),
      loadLanguage: jest.fn(),
      clearRetryMetadata: jest.fn().mockResolvedValue(undefined),
      handleDesktopClick: jest.fn().mockResolvedValue(undefined),
      handleDesktopButton: jest.fn().mockResolvedValue(undefined),
      removeDesktopMapping: jest.fn().mockResolvedValue(undefined),
      profileState: {
        rotateCredentialBinding: jest.fn().mockResolvedValue('binding')
      }
    };
    const router = { handleMessage: jest.fn(() => true) };
    const ensurePeriodicAlarm = jest.fn().mockResolvedValue(undefined);
    const logger = { error: jest.fn() };
    registerRuntimeListeners({
      chrome,
      notificationService: service,
      router,
      ensurePeriodicAlarm,
      alarmName: 'check',
      retryAlarmName: 'retry',
      hostPermissionRecoveryNotificationId: 'recover',
      logger
    });

    chrome.runtime.onInstalled.addListener.mock.calls[0][0]();
    chrome.runtime.onStartup.addListener.mock.calls[0][0]();
    chrome.alarms.onAlarm.addListener.mock.calls[0][0]({ name: 'check' });
    chrome.alarms.onAlarm.addListener.mock.calls[0][0]({ name: 'retry' });
    chrome.runtime.onMessage.addListener.mock.calls[0][0]({ action: 'x' }, {}, jest.fn());
    chrome.storage.onChanged.addListener.mock.calls[0][0]({
      checkInterval: { newValue: 5 },
      language: { newValue: 'ja' }
    }, 'sync');
    chrome.storage.onChanged.addListener.mock.calls[0][0]({
      apiKey: { oldValue: 'a', newValue: 'b' }
    }, 'local');
    chrome.notifications.onClicked.addListener.mock.calls[0][0]('recover');
    chrome.notifications.onClicked.addListener.mock.calls[0][0]('issue:1');
    chrome.notifications.onButtonClicked.addListener.mock.calls[0][0]('issue:1', 0);
    chrome.notifications.onClosed.addListener.mock.calls[0][0]('issue:1');
    await new Promise(resolve => setImmediate(resolve));

    expect(service.requestSync).toHaveBeenCalledWith('alarm');
    expect(service.requestSync).toHaveBeenCalledWith('retryAlarm');
    expect(service.loadLanguage).toHaveBeenCalled();
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
    expect(service.handleDesktopClick).toHaveBeenCalledWith('issue:1');
    expect(service.profileState.rotateCredentialBinding).toHaveBeenCalledWith('b');
  });

  test('keeps an unchanged alarm and replaces a changed alarm', async () => {
    const chrome = createChrome();
    const service = {
      settings: { checkInterval: 15 },
      loadSettings: jest.fn().mockResolvedValue(undefined)
    };
    const ensure = createPeriodicAlarmEnsurer({
      chrome,
      notificationService: service,
      alarmName: 'check'
    });

    chrome.alarms.get.mockImplementationOnce((_name, callback) => callback({ periodInMinutes: 15 }));
    await expect(ensure()).resolves.toEqual({
      changed: false,
      alarm: { periodInMinutes: 15 }
    });
    chrome.alarms.get.mockImplementationOnce((_name, callback) => callback({ periodInMinutes: 5 }));
    await expect(ensure()).resolves.toEqual({
      changed: true,
      periodInMinutes: 15
    });
    expect(chrome.alarms.clear).toHaveBeenCalledWith('check', expect.any(Function));
    expect(chrome.alarms.create).toHaveBeenCalledWith('check', { periodInMinutes: 15 });
  });

  test('maps bootstrap failures to safe logger events and tolerates optional APIs', async () => {
    const chrome = createChrome();
    delete chrome.notifications.onButtonClicked;
    delete chrome.notifications.onClosed;
    const service = {
      activeProfile: {},
      requestSync: jest.fn().mockRejectedValue(new Error('sync failed')),
      loadSettings: jest.fn().mockRejectedValue(new Error('storage failed')),
      loadLanguage: jest.fn(),
      clearRetryMetadata: jest.fn(),
      handleDesktopClick: jest.fn().mockRejectedValue(new Error('click failed')),
      profileState: {
        rotateCredentialBinding: jest.fn()
      }
    };
    const ensurePeriodicAlarm = jest.fn().mockRejectedValue(new Error('alarm failed'));
    const logger = { error: jest.fn() };
    registerRuntimeListeners({
      chrome,
      notificationService: service,
      router: { handleMessage: jest.fn() },
      ensurePeriodicAlarm,
      alarmName: 'check',
      retryAlarmName: 'retry',
      hostPermissionRecoveryNotificationId: 'recover',
      logger
    });

    chrome.runtime.onInstalled.addListener.mock.calls[0][0]();
    chrome.runtime.onStartup.addListener.mock.calls[0][0]();
    chrome.alarms.onAlarm.addListener.mock.calls[0][0]({ name: 'other' });
    chrome.storage.onChanged.addListener.mock.calls[0][0]({
      redmineUrl: { newValue: 'https://example.test' }
    }, 'sync');
    chrome.storage.onChanged.addListener.mock.calls[0][0]({
      apiKey: { oldValue: 'same', newValue: 'same' }
    }, 'local');
    chrome.notifications.onClicked.addListener.mock.calls[0][0]('issue:2');
    await new Promise(resolve => setImmediate(resolve));

    expect(logger.error).toHaveBeenCalledWith('install_sync_failed', {
      errorCode: 'installSyncFailed'
    });
    expect(logger.error).toHaveBeenCalledWith('startup_sync_failed', {
      errorCode: 'startupSyncFailed'
    });
    expect(logger.error).toHaveBeenCalledWith('settings_reload_failed', {
      errorCode: 'settingsReloadFailed'
    });
    expect(logger.error).toHaveBeenCalledWith('desktop_notification_click_failed', {
      errorCode: 'desktopClickFailed'
    });
    expect(service.profileState.rotateCredentialBinding).not.toHaveBeenCalled();
  });

  test('creates a missing periodic alarm without clearing one', async () => {
    const chrome = createChrome();
    const service = {
      settings: { checkInterval: 0 },
      loadSettings: jest.fn().mockResolvedValue(undefined)
    };
    const ensure = createPeriodicAlarmEnsurer({
      chrome,
      notificationService: service,
      alarmName: 'check'
    });

    await expect(ensure()).resolves.toEqual({
      changed: true,
      periodInMinutes: 15
    });
    expect(chrome.alarms.clear).not.toHaveBeenCalled();
  });
});
