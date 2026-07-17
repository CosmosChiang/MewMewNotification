describe('runtime module import side effects', () => {
  test('imports modules without Chrome, fetch, timer, or instance effects', () => {
    jest.resetModules();
    const fetchSpy = jest.fn();
    const timeoutSpy = jest.fn();
    const chromeSpy = jest.fn();
    const previousFetch = global.fetch;
    const previousChrome = global.chrome;
    const previousSetTimeout = global.setTimeout;
    global.fetch = fetchSpy;
    global.chrome = new Proxy({}, { get: chromeSpy });
    global.setTimeout = timeoutSpy;

    expect(() => {
      require('./redmine-api.js');
      require('../shared/diagnostic-event-store.js');
      require('./notification-policy.js');
      require('./profile-state-repository.js');
      require('./notification-service.js');
      require('./diagnostic-snapshot.js');
      require('./runtime-router.js');
      require('./runtime-bootstrap.js');
    }).not.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(chromeSpy).not.toHaveBeenCalled();
    global.fetch = previousFetch;
    global.chrome = previousChrome;
    global.setTimeout = previousSetTimeout;
  });
});
