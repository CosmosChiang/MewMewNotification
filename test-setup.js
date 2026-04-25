if (typeof global.window === 'undefined') {
  global.window = {};
}

// Mock Chrome Extension APIs
global.chrome = {
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    },
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    getURL: jest.fn((path) => `chrome-extension://test-id/${path}`)
  },
  notifications: {
    create: jest.fn(),
    clear: jest.fn(),
    getAll: jest.fn()
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    onAlarm: {
      addListener: jest.fn()
    }
  }
};

// Mock fetch API
global.fetch = jest.fn();
global.alert = jest.fn();
global.confirm = jest.fn(() => true);

// Mock DOM elements for tests that need them
const createMockElement = (tag = 'div') => {
  const element = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    click: jest.fn(),
    focus: jest.fn(),
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      contains: jest.fn(),
      toggle: jest.fn()
    },
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    tagName: tag.toUpperCase(),
    // Use getters/setters for properties that can be assigned
    _value: '',
    _textContent: '',
    _innerHTML: '',
    _scrollTop: 0,
    style: {}
  };

  // Define property getters and setters
  Object.defineProperty(element, 'value', {
    get: function() { return this._value; },
    set: function(val) { this._value = val; },
    enumerable: true
  });

  Object.defineProperty(element, 'textContent', {
    get: function() { return this._textContent; },
    set: function(val) { this._textContent = val; },
    enumerable: true
  });

  Object.defineProperty(element, 'innerHTML', {
    get: function() { return this._innerHTML; },
    set: function(val) { this._innerHTML = val; },
    enumerable: true
  });

  Object.defineProperty(element, 'scrollTop', {
    get: function() { return this._scrollTop; },
    set: function(val) { this._scrollTop = val; },
    enumerable: true
  });

  Object.defineProperty(element, 'scrollHeight', {
    get: function() { return 1000; },
    enumerable: true
  });

  Object.defineProperty(element, 'clientHeight', {
    get: function() { return 200; },
    enumerable: true
  });

  return element;
};

if (typeof global.document === 'undefined') {
  global.document = {
    getElementById: (id) => {
      const knownElements = {
        'test-element': createMockElement('div'),
        'redmine-url': createMockElement('input'),
        'api-key': createMockElement('input'),
        'check-interval': createMockElement('input'),
        'save-button': createMockElement('button'),
        'cancel-button': createMockElement('button'),
        'options-form': createMockElement('form'),
        'options-title': createMockElement('h1'),
        'refresh-button': createMockElement('button'),
        'notifications-container': createMockElement('div'),
        'empty-message': createMockElement('div')
      };

      return knownElements[id] || createMockElement('div');
    },
    querySelector: jest.fn(() => createMockElement('div')),
    querySelectorAll: jest.fn(() => [createMockElement('div')]),
    addEventListener: jest.fn(),
    createElement: jest.fn((tag) => createMockElement(tag)),
    createTextNode: jest.fn((value) => ({ textContent: value })),
    createDocumentFragment: jest.fn(() => ({ appendChild: jest.fn() }))
  };
}

Object.defineProperty(global.window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // Deprecated
    removeListener: jest.fn(), // Deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
