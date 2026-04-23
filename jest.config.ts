import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/reporters/**',
    // Pure SDK wrapper — exercised via integration only, would need a mock
    // Anthropic client to unit-test. Skipped from coverage on purpose.
    '!src/analyzers/ai/claude-analyzer.ts',
  ],
  coverageThreshold: {
    // Pure-logic modules held to the strictest bar (no network, no I/O).
    'src/analyzers/static/**/*.ts': {
      branches: 80,
      functions: 95,
      lines: 90,
      statements: 90,
    },
    'src/core/**/*.ts': {
      branches: 80,
      functions: 95,
      lines: 90,
      statements: 90,
    },
    // Sandboxed tool executors — deterministic once given a ToolContext.
    'src/analyzers/ai/tools.ts': {
      branches: 65,
      functions: 80,
      lines: 80,
      statements: 75,
    },
    // The agent loop is exercised via a mocked Anthropic SDK. Branches are
    // the hardest to cover because the SDK response shape has many
    // defensive guards; everything else is at parity with the rest of the
    // codebase.
    'src/analyzers/ai/agent-loop.ts': {
      branches: 50,
      functions: 70,
      lines: 80,
      statements: 80,
    },
    // Global floor — keeps aggregate healthy and catches genuinely
    // untested new files without hiding per-module regressions.
    global: {
      branches: 70,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
};

export default config;
