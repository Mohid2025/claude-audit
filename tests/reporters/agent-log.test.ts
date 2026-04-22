import { PassThrough } from 'stream';
import { AgentLogger } from '../../src/reporters/agent-log';
import type { ToolCallRecord } from '../../src/core/types';

/**
 * AgentLogger tests use a plain PassThrough as the output stream so we can
 * capture every line the logger writes. We also force `isTTY = false` so ora
 * skips rendering a spinner (which would otherwise open an interval timer
 * and leak across tests).
 */
function makeStream(): { stream: NodeJS.WriteStream; output: () => string } {
  const s = new PassThrough();
  // Impersonate a non-TTY WritableStream — ora + our colour branch both skip.
  (s as unknown as { isTTY: boolean }).isTTY = false;
  (s as unknown as { columns: number }).columns = 80;
  let buf = '';
  s.on('data', (chunk: Buffer) => { buf += chunk.toString('utf-8'); });
  return {
    stream: s as unknown as NodeJS.WriteStream,
    output: () => stripAnsi(buf),
  };
}

function stripAnsi(s: string): string {
  // Strip ANSI colour codes for stable assertions
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function record(
  name: string,
  opts: Partial<ToolCallRecord> = {},
): ToolCallRecord {
  return {
    turn: 1,
    toolUseId: 't1',
    name,
    input: {},
    outputPreview: '',
    outputBytes: 0,
    durationMs: 12,
    isError: false,
    timestamp: new Date('2025-01-01T00:00:00Z').toISOString(),
    ...opts,
  };
}

describe('AgentLogger', () => {
  it('prints a header with model + budget', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true });
    log.start({ model: 'claude-sonnet-4-6', maxTurns: 25, maxBudgetTokens: 500000 });
    const out = output();
    expect(out).toMatch(/Agentic audit/);
    expect(out).toMatch(/claude-sonnet-4-6/);
    expect(out).toMatch(/25 turns/);
    expect(out).toMatch(/500,000 tokens/);
  });

  it('marks verbose mode in the header when enabled', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true, verbose: true });
    log.start({ model: 'claude-sonnet-4-6', maxTurns: 10, maxBudgetTokens: 100000 });
    expect(output()).toMatch(/verbose/);
  });

  it('does not mention verbose in default mode', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true });
    log.start({ model: 'claude-sonnet-4-6', maxTurns: 10, maxBudgetTokens: 100000 });
    expect(output()).not.toMatch(/verbose/);
  });

  it('uses ├─ for non-final tool calls and └─ for the last one', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true });
    log.turnStart({ turn: 1, maxTurns: 5 });
    log.toolCall(
      record('list_files', { input: { pattern: '**/*.ts' } }),
      { indexInTurn: 0, totalInTurn: 3 },
    );
    log.toolCall(
      record('search_code', { input: { pattern: 'eval(' } }),
      { indexInTurn: 1, totalInTurn: 3 },
    );
    log.toolCall(
      record('finalize_audit', { input: {} }),
      { indexInTurn: 2, totalInTurn: 3 },
    );
    const lines = output().split('\n');
    const branches = lines.filter(l => l.includes('├─') || l.includes('└─'));
    expect(branches).toHaveLength(3);
    expect(branches[0]).toContain('├─');
    expect(branches[1]).toContain('├─');
    expect(branches[2]).toContain('└─');
  });

  it('includes the argument summary for each tool', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true });
    log.toolCall(
      record('read_file', { input: { path: 'src/index.ts', start_line: 1, end_line: 40 } }),
      { indexInTurn: 0, totalInTurn: 1 },
    );
    expect(output()).toMatch(/src\/index\.ts:1-40/);
  });

  it('renders an outcome hint from search_code output', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true });
    log.toolCall(
      record('search_code', {
        input: { pattern: 'eval(' },
        outputPreview: 'Found 7 matches for pattern "eval(" in 3 files',
        outputBytes: 2048,
      }),
      { indexInTurn: 0, totalInTurn: 1 },
    );
    expect(output()).toMatch(/7 matches/);
  });

  it('renders an error indicator when a tool call fails', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true });
    log.toolCall(
      record('read_file', {
        input: { path: '../bad' },
        outputPreview: 'Error: Path outside project root or invalid: ../bad',
        outputBytes: 55,
        isError: true,
      }),
      { indexInTurn: 0, totalInTurn: 1 },
    );
    expect(output()).toMatch(/Path outside project root/);
  });

  it('only prints the result-preview continuation line in verbose mode', () => {
    const verboseOut = (() => {
      const { stream, output } = makeStream();
      const log = new AgentLogger({ stream, noColor: true, verbose: true });
      log.toolCall(
        record('read_file', {
          input: { path: 'x.ts' },
          outputPreview: '// top-of-file comment\nimport foo from "foo";',
          outputBytes: 42,
        }),
        { indexInTurn: 0, totalInTurn: 1 },
      );
      return output();
    })();
    const plainOut = (() => {
      const { stream, output } = makeStream();
      const log = new AgentLogger({ stream, noColor: true });
      log.toolCall(
        record('read_file', {
          input: { path: 'x.ts' },
          outputPreview: '// top-of-file comment\nimport foo from "foo";',
          outputBytes: 42,
        }),
        { indexInTurn: 0, totalInTurn: 1 },
      );
      return output();
    })();

    expect(verboseOut).toMatch(/↳/);
    expect(verboseOut).toMatch(/top-of-file comment/);
    expect(plainOut).not.toMatch(/↳/);
  });

  it('prints the correct stop-reason marker in finish()', () => {
    const cases: Array<[
      'completed' | 'max_turns' | 'max_budget' | 'repetition' | 'error',
      RegExp,
    ]> = [
      ['completed',  /completed/],
      ['max_turns',  /max turns reached/],
      ['max_budget', /token budget exceeded/],
      ['repetition', /repetition detected/],
      ['error',      /error/],
    ];
    for (const [stopReason, pattern] of cases) {
      const { stream, output } = makeStream();
      const log = new AgentLogger({ stream, noColor: true });
      log.finish({
        turns: 3,
        toolCalls: 8,
        errors: 0,
        inputTokens: 1200,
        outputTokens: 400,
        cacheReadTokens: 300,
        cacheCreationTokens: 100,
        stopReason,
        stopDetail: stopReason === 'completed' ? undefined : 'some detail',
        durationMs: 4200,
        toolUsage: { list_files: 2, search_code: 6 },
      });
      expect(output()).toMatch(pattern);
    }
  });

  it('includes cache-hit percentage in the finish line', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true });
    log.finish({
      turns: 2,
      toolCalls: 3,
      errors: 0,
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 800,
      cacheCreationTokens: 0,
      stopReason: 'completed',
      durationMs: 1500,
      toolUsage: {},
    });
    expect(output()).toMatch(/80% cache/);
  });

  it('surfaces error count in the finish line when non-zero', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true });
    log.finish({
      turns: 5,
      toolCalls: 10,
      errors: 2,
      inputTokens: 500,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      stopReason: 'completed',
      durationMs: 3000,
      toolUsage: {},
    });
    expect(output()).toMatch(/2 errors/);
  });

  it('swallows the "Claude is reasoning" progress chatter', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true });
    log.progress('Claude is reasoning (turn 3/25, 4211 tokens used)...');
    log.progress('→ search_code("eval(")');
    expect(output()).toBe('');
  });

  it('prints warnings emitted via progress()', () => {
    const { stream, output } = makeStream();
    const log = new AgentLogger({ stream, noColor: true });
    log.progress('⚠ Claude API error on turn 4: rate limit');
    expect(output()).toMatch(/rate limit/);
  });
});
