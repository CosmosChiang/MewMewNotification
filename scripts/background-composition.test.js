function event() {
  return { addListener: jest.fn() };
}

function createChrome() {
  return {
    storage: {
      sync: {
        get: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined)
      },
      local: {
        get: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined)
      },
      onChanged: event()
    },
    permissions: { contains: jest.fn().mockResolvedValue(true) },
    action: {
      setBadgeText: jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
      setTitle: jest.fn(),
      openPopup: jest.fn()
    },
    notifications: {
      create: jest.fn(),
      clear: jest.fn(),
      getAll: jest.fn(),
      onClicked: event(),
      onButtonClicked: event(),
      onClosed: event()
    },
    alarms: {
      create: jest.fn(),
      clear: jest.fn((_name, callback) => callback(true)),
      get: jest.fn((_name, callback) => callback(undefined)),
      onAlarm: event()
    },
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
      openOptionsPage: jest.fn()
    },
    tabs: { create: jest.fn() }
  };
}

describe('background composition root', () => {
  test('registers listeners synchronously before explicit initialization', async () => {
    jest.resetModules();
    global.chrome = createChrome();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({})
    });

    require('../background.js');

    [
      global.chrome.runtime.onInstalled,
      global.chrome.runtime.onStartup,
      global.chrome.runtime.onMessage,
      global.chrome.alarms.onAlarm,
      global.chrome.storage.onChanged,
      global.chrome.notifications.onClicked,
      global.chrome.notifications.onButtonClicked,
      global.chrome.notifications.onClosed
    ].forEach(item => expect(item.addListener).toHaveBeenCalledTimes(1));

    await new Promise(resolve => setImmediate(resolve));
    expect(global.chrome.alarms.create).toHaveBeenCalledWith(
      'redmine-notification-check',
      { periodInMinutes: 15 }
    );
  });
});
