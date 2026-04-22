import { detectRepetition, hashToolCall } from '../../../src/analyzers/ai/agent-loop';

describe('hashToolCall', () => {
  it('produces stable hashes regardless of key order', () => {
    const h1 = hashToolCall('search_code', { pattern: 'eval', regex: false });
    const h2 = hashToolCall('search_code', { regex: false, pattern: 'eval' });
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different inputs', () => {
    const h1 = hashToolCall('search_code', { pattern: 'eval' });
    const h2 = hashToolCall('search_code', { pattern: 'exec' });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different tools with same input', () => {
    const h1 = hashToolCall('read_file', { path: 'x' });
    const h2 = hashToolCall('list_files', { path: 'x' });
    expect(h1).not.toBe(h2);
  });
});

describe('detectRepetition', () => {
  it('returns false for a varied call history', () => {
    const recent = ['a', 'b', 'c', 'd', 'e'];
    expect(detectRepetition(recent, 'f')).toBe(false);
  });

  it('returns true when the same hash appears 3+ times in the window', () => {
    const recent = ['a', 'b', 'a'];
    expect(detectRepetition(recent, 'a')).toBe(true);
  });

  it('respects the sliding window — old repeats fall off', () => {
    const recent = ['a', 'a', 'b', 'c', 'd', 'e'];
    expect(detectRepetition(recent, 'a')).toBe(false);
  });

  it('returns true on exact threshold count', () => {
    const recent = ['x', 'x'];
    expect(detectRepetition(recent, 'x')).toBe(true);
  });
});
