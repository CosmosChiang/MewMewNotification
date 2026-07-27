module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test-setup.js'],

  testMatch: ['<rootDir>/scripts/**/*.test.js'],
  testPathIgnorePatterns: ['\\.integration\\.test\\.js$'],
  collectCoverage: true,
  collectCoverageFrom: [
    'background.js',
    'scripts/options.js',
    'scripts/popup.js',
    'scripts/background/**/*.js',
    'scripts/shared/**/*.js',
    '!scripts/**/*.test.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 65,
      functions: 65,
      lines: 65,
      statements: 65
    },
    'background.js': { branches: 50, functions: 60, lines: 55, statements: 55 },
    'scripts/options.js': { branches: 35, functions: 40, lines: 40, statements: 40 },
    'scripts/popup.js': { branches: 40, functions: 50, lines: 50, statements: 50 },
    'scripts/shared/config-manager.js': {
      branches: 90,
      functions: 100,
      lines: 90,
      statements: 90
    },
    'scripts/background/notification-policy.js': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'scripts/background/diagnostic-snapshot.js': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    // Stateful transport/orchestration modules use regression floors while the
    // extracted deterministic modules below carry the strict 90/85 contract.
    'scripts/background/redmine-api.js': {
      branches: 45,
      functions: 50,
      lines: 60,
      statements: 60
    },
    'scripts/background/notification-service.js': {
      branches: 60,
      functions: 80,
      lines: 75,
      statements: 75
    },
    'scripts/background/profile-state-repository.js': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'scripts/background/runtime-bootstrap.js': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'scripts/background/runtime-router.js': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'scripts/shared/i18n.js': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'scripts/shared/diagnostic-event-store.js': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'scripts/shared/safe-logger.js': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },

  clearMocks: true,
  restoreMocks: true,
  maxWorkers: 1,
  testTimeout: 10000,
  verbose: false
};
