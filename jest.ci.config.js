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
    'scripts/shared/**/*.js',
    '!scripts/**/*.test.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 55,
      lines: 55,
      statements: 55
    },
    'background.js': { branches: 50, functions: 60, lines: 55, statements: 55 },
    'scripts/options.js': { branches: 35, functions: 40, lines: 40, statements: 40 },
    'scripts/popup.js': { branches: 40, functions: 50, lines: 50, statements: 50 },
    'scripts/shared/config-manager.js': {
      branches: 90,
      functions: 100,
      lines: 90,
      statements: 90
    }
  },

  maxWorkers: 2,
  testTimeout: 10000,
  clearMocks: true,
  restoreMocks: true,
  verbose: true,

  coveragePathIgnorePatterns: ['/node_modules/', '/coverage/', '/test-setup.js']
};
