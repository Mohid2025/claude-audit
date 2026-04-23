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
    // Pure-logic modules are held to a high bar: no network, no I/O,
    // deterministic outputs → easy to test thoroughly.
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
    // Sandboxed tool executors are mostly unit-testable — enforce a solid
    // bar but leave headroom for the large tool-definition schema block.
    'src/analyzers/ai/tools.ts': {
      branches: 60,
      functions: 80,
      lines: 80,
      statements: 75,
    },
    // The agent loop is 500+ lines of streaming SDK orchestration. The
    // pure helpers (hashToolCall, detectRepetition, buildInitialUserPrompt,
    // buildCategoriesFromFinal) are covered; the runAgentLoop fn itself
    // would need a full Anthropic mock to test meaningfully. Hold the
    // exported helpers to a reasonable bar without demanding integration
    // coverage for the orchestrator.
    'src/analyzers/ai/agent-loop.ts': {
      branches: 4,
      functions: 15,
      lines: 10,
      statements: 10,
    },
    // Global floor: catches any new file that's genuinely untested.
    global: {
      branches: 55,
      functions: 70,
      lines: 60,
      statements: 60,
    },
  },
};

export default config;
