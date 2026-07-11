module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/scripts/**/*.integration.test.js'],
  collectCoverage: false,
  clearMocks: true,
  restoreMocks: true,
  maxWorkers: 1,
  testTimeout: 15000
};
