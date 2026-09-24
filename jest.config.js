/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: [
    'src/**/*.ts',
    // Process bootstrap and the PostgreSQL adapter are covered by the integration
    // test (tests/postgres.int.test.ts, runs when TEST_DATABASE_URL is set).
    '!src/index.ts',
    '!src/db/**',
    '!src/repositories/postgresBaseRepository.ts'
  ],
  coverageThreshold: { global: { statements: 80, branches: 80, functions: 80, lines: 80 } }
};
