module.exports = {
  displayName: 'Chester Bot Tests',
  testEnvironment: 'node',
  collectCoverageFrom: [
    'utils.js',
    'llm.js',
    'modelManager.js',
    'analytics.js',
    'analyticsReport.js',
    '!node_modules/**',
    '!__tests__/**'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],
  verbose: true
};
