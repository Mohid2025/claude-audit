// ─────────────────────────────────────────────
//  claude-audit — Agent Logger (streaming tree view)
// ─────────────────────────────────────────────
//
// Replaces the static "Claude is thinking..." spinner with a live, readable
// timeline of the agent's investigation. One tool call = one permanent line.
// A spinner only shows during the genuinely-blocking API-wait phase of each
// turn, then clears as soon as Claude emits tool uses.
//
// Designed to match the warm amber terminal theme used elsewhere in the CLI.

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type {
  AgentTraceSummary,
  ToolCallRecord,
} from '../core/types';
import type {
  ToolCallMeta,
  TurnStartInfo,
  TurnEndInfo,
} from '../analyzers/ai/agent-loop';

// ── Theme (mirrors terminal.ts) ──────────────────
const AMBER = {
  primary: '#D97757',
  bright:  '#E8A87C',
  deep:    '#B85C38',
  glow:    '#F4A261',
  cream:   '#F4E5D3',
  tan:     '#A67B5B',
  ember:   '#C44536',
};

const c = {
  primary:    chalk.hex(AMBER.bright).bold,
  accent:     chalk.hex(AMBER.primary),
  accentBold: chalk.hex(AMBER.primary).bold,
  body:       chalk.hex(AMBER.cream),
  muted:      chalk.hex(AMBER.tan),
  tan:        chalk.hex(AMBER.tan),
  deep:       chalk.hex(AMBER.deep),
  glow:       chalk.hex(AMBER.glow),
  ember:      chalk.hex(AMBER.ember),
  success:    chalk.hex(AMBER.bright).bold,
  error:      chalk.hex(AMBER.ember).bold,
  warn:       chalk.hex(AMBER.deep).bold,
};

// ── Options ──────────────────────────────────────
export interface AgentLoggerOptions {
  /** Show per-turn token deltas, tool durations, result previews. */
  verbose?: boolean;
  /** Disable coloured output (e.g. when not a TTY). */
  noColor?: boolean;
  /** Where the logger writes. Defaults to process.stderr so stdout stays
   *  clean for `--json` consumers. */
  stream?: NodeJS.WriteStream;
}

export interface AgentLoggerHeader {
  model: string;
  maxTurns: number;
  maxBudgetTokens: number;
}

// ── Formatting helpers ───────────────────────────
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatMs(n: number): string {
  if (n < 1000) return `${n}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  const m = Math.floor(n / 60_000);
  const s = Math.round((n % 60_000) / 1000);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/** Extract a one-line outcome hint from a tool_result preview. */
function outcomeHint(name: string, preview: string, isError: boolean, bytes: number): string {
  if (isError) {
    const firstLine = preview.split('\n')[0] ?? '';
    return c.ember(truncate(firstLine.replace(/^Error:\s*/, ''), 60));
  }
  // Parse tool-specific headers we control in tools.ts
  if (name === 'list_files') {
    const m = /Found\s+(\d+)\s+file/.exec(preview);
    if (m) return c.muted(`${m[1]} paths · ${formatBytes(bytes)}`);
  }
  if (name === 'search_code') {
    const m = /Found\s+(\d+)(\+?)\s+match/.exec(preview);
    if (m) return c.muted(`${m[1]}${m[2]} matches · ${formatBytes(bytes)}`);
    if (/No matches/.test(preview)) return c.muted('0 matches');
  }
  if (name === 'read_file') {
    const m = /\((\d+)\s+lines?/.exec(preview);
    if (m) return c.muted(`${m[1]} lines · ${formatBytes(bytes)}`);
  }
  if (name === 'finalize_audit') {
    return c.success('submitting report');
  }
  return c.muted(formatBytes(bytes));
}

/** Render a terse argument summary for a tool call (always shown). */
function argSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'list_files': {
      const p = typeof input['pattern'] === 'string' ? input['pattern'] : '**/*';
      return p;
    }
    case 'read_file': {
      const p = typeof input['path'] === 'string' ? input['path'] : '?';
      const s = input['start_line'];
      const e = input['end_line'];
      const range = (s || e) ? `:${s ?? 1}-${e ?? '∞'}` : '';
      return `${p}${range}`;
    }
    case 'search_code': {
      const p = typeof input['pattern'] === 'string' ? input['pattern'] : '?';
      const scope = typeof input['file_pattern'] === 'string' ? ` in ${input['file_pattern']}` : '';
      const regex = input['regex'] ? ' /rx/' : '';
      return `${JSON.stringify(p)}${regex}${scope}`;
    }
    default:
      return '';
  }
}

// ── The logger ───────────────────────────────────
export class AgentLogger {
  private readonly verbose: boolean;
  private readonly out: NodeJS.WriteStream;
  private readonly useColor: boolean;
  private spinner?: Ora;
  private currentTurnStart = 0;
  private startWallTime = 0;

  constructor(opts: AgentLoggerOptions = {}) {
    this.verbose = !!opts.verbose;
    this.out = opts.stream ?? process.stderr;
    this.useColor = !opts.noColor && this.out.isTTY === true;
    if (!this.useColor) chalk.level = 0;
  }

  private write(line: string): void {
    this.out.write(line + '\n');
  }

  private rule(): string {
    const width = Math.min(this.out.columns ?? 80, 76);
    return c.tan('━'.repeat(width));
  }

  // ── Public API ─────────────────────────────────

  start(header: AgentLoggerHeader): void {
    this.startWallTime = Date.now();
    this.write('');
    this.write(this.rule());
    this.write(
      `  ${c.primary('✦ Agentic audit')}  ${c.tan('·')}  ${c.accent(header.model)}`,
    );
    this.write(
      `  ${c.muted('budget')}  ${c.tan('·')}  ${c.body(String(header.maxTurns))} ${c.muted('turns')}  ${c.tan('/')}  ${c.body(header.maxBudgetTokens.toLocaleString())} ${c.muted('tokens')}` +
      (this.verbose ? `  ${c.tan('·')}  ${c.muted('verbose')}` : ''),
    );
    this.write(this.rule());
    this.write('');
  }

  turnStart(info: TurnStartInfo): void {
    this.currentTurnStart = Date.now();
    const header =
      `  ${c.primary(`turn ${info.turn}`)}${c.muted(`/${info.maxTurns}`)}`;
    // Print the header as a permanent line, then spawn a spinner below it
    // so the tree output appears beneath.
    this.write(header);
    this.startSpinner(`${c.muted('reasoning…')}`);
  }

  /**
   * Called right after Claude's response arrives. Stops the spinner so the
   * tool call lines can stream in cleanly.
   */
  apiResponse(info: { turn: number; toolCalls: number }): void {
    this.stopSpinner();
    // No output line here — the turn header was already printed on turnStart.
    // Tool calls will follow immediately.
    void info;
  }

  toolCall(record: ToolCallRecord, meta: ToolCallMeta): void {
    // In case the spinner is still alive (e.g. error path), kill it.
    this.stopSpinner();

    const isLast = meta.indexInTurn === meta.totalInTurn - 1;
    const connector = isLast ? '└─' : '├─';
    const branch = c.tan(connector);

    const name = record.isError
      ? c.ember(record.name.padEnd(26))
      : c.accent(record.name.padEnd(26));

    const args = argSummary(record.name, record.input);
    const argsCol = args ? c.body(truncate(args, 40)).padEnd(40 + (args ? 0 : 0)) : '';

    const hint = outcomeHint(
      record.name,
      record.outputPreview,
      record.isError,
      record.outputBytes,
    );
    const duration = this.verbose ? c.muted(formatMs(record.durationMs).padStart(6)) : '';

    // Compose: "  ├─ name                args                     hint · 42ms"
    const line = [
      `  ${branch} ${name}`,
      argsCol ? `${argsCol}` : '',
      hint,
      duration,
    ]
      .filter(Boolean)
      .join('  ');
    this.write(line);

    // Verbose: show a preview of the tool result on a continuation line.
    if (this.verbose && record.outputPreview) {
      const pipe = isLast ? ' ' : c.tan('│');
      const preview = truncate(record.outputPreview.replace(/\s+/g, ' ').trim(), 100);
      this.write(`  ${pipe}   ${c.tan('↳')} ${c.muted(preview)}`);
    }
  }

  turnEnd(info: TurnEndInfo): void {
    this.stopSpinner();
    if (!this.verbose) {
      // Blank line between turns keeps the tree view breathable.
      this.write('');
      return;
    }
    // Verbose: per-turn summary with cache hit % and latency
    const totalIn = info.turnInputTokens + info.turnCacheReadTokens;
    const cachePct = totalIn > 0
      ? Math.round((info.turnCacheReadTokens / totalIn) * 100)
      : 0;
    this.write(
      `     ${c.muted('✦')}  ${c.muted(
        `${formatTokens(info.turnInputTokens)} in · ${formatTokens(info.turnOutputTokens)} out · ${cachePct}% cache · ${formatMs(info.durationMs)}`,
      )}`,
    );
    this.write('');
  }

  /** Called for soft events (errors, retries, warnings). */
  progress(msg: string): void {
    // Ignore the generic "Claude is reasoning..." — the spinner already shows it.
    if (msg.startsWith('Claude is reasoning')) {
      if (this.spinner) this.spinner.text = c.muted('reasoning…');
      return;
    }
    // Ignore per-tool "→ name" chatter — tree view is authoritative.
    if (msg.startsWith('→ ')) return;

    this.stopSpinner();
    if (msg.startsWith('⚠')) {
      this.write(`  ${c.warn(msg)}`);
    } else {
      this.write(`  ${c.muted(msg)}`);
    }
  }

  finish(summary: AgentTraceSummary): void {
    this.stopSpinner();

    const elapsed = Date.now() - this.startWallTime;
    const marker =
      summary.stopReason === 'completed' ? c.success('✓ completed')
      : summary.stopReason === 'max_turns'   ? c.warn('⚠ max turns reached')
      : summary.stopReason === 'max_budget'  ? c.warn('⚠ token budget exceeded')
      : summary.stopReason === 'repetition'  ? c.warn('⚠ repetition detected')
      : c.error('✗ error');

    const totalIn = summary.inputTokens + summary.cacheReadTokens;
    const cachePct = totalIn > 0
      ? Math.round((summary.cacheReadTokens / totalIn) * 100)
      : 0;

    this.write('');
    this.write(this.rule());
    this.write(
      `  ${marker}  ${c.tan('·')}  ${c.body(String(summary.turns))} turns  ${c.tan('·')}  ${c.body(String(summary.toolCalls))} tool calls` +
      (summary.errors > 0 ? `  ${c.tan('·')}  ${c.ember(String(summary.errors) + ' errors')}` : '') +
      `  ${c.tan('·')}  ${c.body(formatTokens(summary.inputTokens + summary.outputTokens))} tokens` +
      `  ${c.tan('·')}  ${c.muted(`${cachePct}% cache`)}` +
      `  ${c.tan('·')}  ${c.muted(formatMs(elapsed))}`,
    );
    if (summary.stopDetail && summary.stopReason !== 'completed') {
      this.write(`  ${c.muted(summary.stopDetail)}`);
    }
    this.write(this.rule());
    this.write('');
  }

  // ── Spinner lifecycle (private) ────────────────
  private startSpinner(text: string): void {
    if (!this.useColor) return; // no TTY → no spinner (lines only)
    this.spinner = ora({
      text,
      spinner: 'dots',
      color: 'yellow',
      stream: this.out,
    }).start();
  }

  private stopSpinner(): void {
    if (this.spinner) {
      // ora.stop() clears its own line and resets the cursor, which leaves the
      // "turn N/M" header intact above and lets subsequent writes appear in
      // the spinner's slot — exactly what we want for the tree layout.
      this.spinner.stop();
      this.spinner = undefined;
    }
  }
}
