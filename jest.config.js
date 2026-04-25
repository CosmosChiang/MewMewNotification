module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test-setup.js'],

  testMatch: ['<rootDir>/scripts/**/*.test.js'],
  collectCoverage: true,
  collectCoverageFrom: [
    'scripts/shared/**/*.js',
    '!scripts/**/*.test.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    'scripts/shared/config-manager.js': {
      branches: 90,
      functions: 100,
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
