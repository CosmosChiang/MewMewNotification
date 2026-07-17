if (typeof importScripts === 'function') {
  importScripts(
    'scripts/shared/safe-logger.js',
    'scripts/shared/diagnostic-event-store.js',
    'scripts/shared/i18n.js',
    'scripts/shared/config-manager.js',
    'scripts/shared/profile-state-manager.js',
    'scripts/background/redmine-api.js',
    'scripts/background/notification-policy.js',
    'scripts/background/profile-state-repository.js',
    'scripts/background/notification-service.js',
    'scripts/background/diagnostic-snapshot.js',
    'scripts/background/runtime-router.js',
    'scripts/background/runtime-bootstrap.js'
  );
}

const nodeModules = typeof require === 'function' ? {
  ...require('./scripts/shared/safe-logger.js'),
  ...require('./scripts/shared/diagnostic-event-store.js'),
  I18nManager: require('./scripts/shared/i18n.js'),
  ...require('./scripts/shared/config-manager.js'),
  ...require('./scripts/shared/profile-state-manager.js'),
  ...require('./scripts/background/redmine-api.js'),
  NotificationPolicy: require('./scripts/background/notification-policy.js'),
  ...require('./scripts/background/profile-state-repository.js'),
  ...require('./scripts/background/notification-service.js'),
  ...require('./scripts/background/diagnostic-snapshot.js'),
  ...require('./scripts/background/runtime-router.js'),
  ...require('./scripts/background/runtime-bootstrap.js')
} : {};
const runtimeExports = { ...nodeModules, ...globalThis };
const SafeLoggerClass = runtimeExports.SafeLogger;
const DiagnosticEventStoreClass = runtimeExports.DiagnosticEventStore;
const I18nManagerClass = runtimeExports.I18nManager;
const ConfigManagerClass = runtimeExports.ConfigManager;
const ProfileStateManagerClass = runtimeExports.ProfileStateManager;
const ProfileStateRepositoryClass = runtimeExports.ProfileStateRepository;
const RedmineAPI = runtimeExports.RedmineAPI;
const NotificationPolicy = runtimeExports.NotificationPolicy;
const NotificationService = runtimeExports.NotificationService;
const DiagnosticSnapshotBuilderClass = runtimeExports.DiagnosticSnapshotBuilder;
const RuntimeRouterClass = runtimeExports.RuntimeRouter;
const registerRuntimeListeners = runtimeExports.registerRuntimeListeners;
const createPeriodicAlarmEnsurer = runtimeExports.createPeriodicAlarmEnsurer;

const HOST_PERMISSION_RECOVERY_NOTIFICATION_ID = 'host-permission-recovery';
const RETRY_ALARM_NAME = 'redmine-notification-retry';
const ALARM_NAME = 'redmine-notification-check';

const diagnosticEventStore = new DiagnosticEventStoreClass({
  storageArea: chrome.storage.local
});
const logger = new SafeLoggerClass({
  isDebugEnabled: () => diagnosticEventStore.isEnabled(),
  eventSink: event => diagnosticEventStore.append(event)
});
const i18n = new I18nManagerClass({
  storage: chrome.storage.sync,
  fetch: typeof fetch === 'function' ? fetch : undefined,
  localeUrlResolver: language => `_locales/${language}/messages.json`,
  logger
});
const profileManager = new ProfileStateManagerClass(chrome.storage);
const profileState = new ProfileStateRepositoryClass({ manager: profileManager });
const notificationManager = new NotificationService({
  chrome,
  logger,
  i18n,
  profileState,
  RedmineAPIClass: RedmineAPI,
  policy: NotificationPolicy,
  ConfigManagerClass
});
const ensurePeriodicAlarm = createPeriodicAlarmEnsurer({
  chrome,
  notificationService: notificationManager,
  alarmName: ALARM_NAME
});
const diagnosticSnapshotBuilder = new DiagnosticSnapshotBuilderClass({
  chrome,
  notificationService: notificationManager,
  profileRepository: profileState,
  eventStore: diagnosticEventStore,
  periodicAlarmName: ALARM_NAME,
  retryAlarmName: RETRY_ALARM_NAME
});
const runtimeRouter = new RuntimeRouterClass({
  notificationService: notificationManager,
  RedmineAPIClass: RedmineAPI,
  chrome,
  alarmName: ALARM_NAME,
  logger,
  diagnosticSnapshotBuilder,
  apiDependencies: {
    fetch: typeof fetch === 'function' ? fetch : undefined,
    AbortController: typeof AbortController !== 'undefined' ? AbortController : undefined,
    setTimeout: typeof setTimeout === 'function' ? setTimeout : undefined,
    clearTimeout: typeof clearTimeout === 'function' ? clearTimeout : undefined,
    ConfigManagerClass,
    logger
  }
});

registerRuntimeListeners({
  chrome,
  notificationService: notificationManager,
  router: runtimeRouter,
  ensurePeriodicAlarm,
  alarmName: ALARM_NAME,
  retryAlarmName: RETRY_ALARM_NAME,
  hostPermissionRecoveryNotificationId: HOST_PERMISSION_RECOVERY_NOTIFICATION_ID,
  diagnosticEventStore,
  logger
});

Promise.all([
  diagnosticEventStore.initialize(),
  notificationManager.initialize()
])
  .then(() => ensurePeriodicAlarm())
  .catch(() => logger.error('runtime_initialize_failed', { errorCode: 'runtimeInitializeFailed' }));
