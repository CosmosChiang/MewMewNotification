module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test-setup.js'],

  testMatch: ['<rootDir>/scripts/**/*.test.js'],
  testPathIgnorePatterns: ['<rootDir>/scripts/fake-redmine.integration.test.js'],
  collectCoverage: false,
  maxWorkers: 1,
  testTimeout: 5000,
  clearMocks: true,
  restoreMocks: true,
  verbose: false,
  coveragePathIgnorePatterns: ['/node_modules/', '/coverage/', '/test-setup.js']
};
