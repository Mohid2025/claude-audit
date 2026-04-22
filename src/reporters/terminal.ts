// ─────────────────────────────────────────────
//  claude-audit — Terminal Reporter
// ─────────────────────────────────────────────

import chalk from 'chalk';
import boxen from 'boxen';
import path from 'path';
import type { AuditReport, Finding, CategoryScore, Severity, AuditCategory } from '../core/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: VERSION } = require('../../package.json');

// ── Warm Amber Theme (Anthropic-inspired) ────────────────
// Brand palette built around Anthropic's signature coral/amber tones.
const AMBER = {
  primary:  '#D97757', // Anthropic coral — primary accent
  bright:   '#E8A87C', // Light amber — highlights
  deep:     '#B85C38', // Burnt amber — emphasis
  glow:     '#F4A261', // Warm glow — success-ish accents
  cream:    '#F4E5D3', // Cream — subtle text
  tan:      '#A67B5B', // Muted tan — dimmed text
  ember:    '#C44536', // Deep ember — critical warmth
};

const theme = {
  // Primary — golden amber, used for headings and key labels
  primary:   chalk.hex(AMBER.bright).bold,
  // Accent — coral, used for values / interactive numbers
  accent:    chalk.hex(AMBER.primary),
  accentBold:chalk.hex(AMBER.primary).bold,
  // Body & muted
  body:      chalk.hex(AMBER.cream),
  muted:     chalk.hex(AMBER.tan),
  // Legacy aliases (kept to minimise diff surface)
  bright:    chalk.hex(AMBER.bright),
  deep:      chalk.hex(AMBER.deep),
  glow:      chalk.hex(AMBER.glow),
  cream:     chalk.hex(AMBER.cream),
  tan:       chalk.hex(AMBER.tan),
  ember:     chalk.hex(AMBER.ember),
  dim:       chalk.hex(AMBER.tan),
};

/** Render a section heading with an accent bar + tan underline. */
function sectionHeader(title: string): string {
  const bar = theme.accent('▌');
  const head = theme.primary(title.toUpperCase());
  const rule = theme.tan('─'.repeat(Math.max(4, 60 - title.length)));
  return `\n  ${bar} ${head}  ${rule}\n`;
}

const CATEGORY_ICONS: Record<AuditCategory, string> = {
  security:      '🔒',
  quality:       '📊',
  performance:   '⚡',
  architecture:  '🏗️ ',
  dependencies:  '📦',
  testing:       '🧪',
  documentation: '📚',
};

const SEVERITY_COLOR: Record<Severity, chalk.Chalk> = {
  critical: chalk.bgHex(AMBER.ember).hex('#FFF5EC').bold,
  high:     chalk.hex(AMBER.ember).bold,
  medium:   chalk.hex(AMBER.deep).bold,
  low:      chalk.hex(AMBER.glow),
  info:     chalk.hex(AMBER.tan),
};

// A → F goes monotonically from lightest amber to darkest ember so the
// grade colour alone communicates severity at a glance.
const GRADE_COLOR: Record<string, chalk.Chalk> = {
  A: chalk.hex(AMBER.bright).bold,
  B: chalk.hex(AMBER.glow).bold,
  C: chalk.hex(AMBER.primary).bold,
  D: chalk.hex(AMBER.deep).bold,
  F: chalk.bgHex(AMBER.ember).hex('#FFF5EC').bold,
};

function scoreBar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color =
    score >= 80 ? chalk.hex(AMBER.bright)
    : score >= 60 ? chalk.hex(AMBER.primary)
    : chalk.hex(AMBER.ember);
  return color('█'.repeat(filled)) + chalk.hex(AMBER.tan)('░'.repeat(empty));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

export function printBanner(): void {
  const banner = [
    theme.bright.bold('   ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗'),
    theme.bright.bold('  ██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝'),
    theme.bright.bold('  ██║     ██║     ███████║██║   ██║██║  ██║█████╗  '),
    theme.bright.bold('  ██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝  '),
    theme.bright.bold('  ╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗'),
    theme.bright.bold('   ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝'),
    '',
    theme.bright.bold('         ██████╗ ██╗   ██╗██████╗ ██╗████████╗'),
    theme.bright.bold('         ██╔══██╗██║   ██║██╔══██╗██║╚══██╔══╝'),
    theme.bright.bold('         ███████║██║   ██║██║  ██║██║   ██║   '),
    theme.bright.bold('         ██╔══██║██║   ██║██║  ██║██║   ██║   '),
    theme.bright.bold('         ██║  ██║╚██████╔╝██████╔╝██║   ██║   '),
    theme.bright.bold('         ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝   ╚═╝   '),
    '',
    theme.cream(`     AI-Powered Codebase Auditor  ·  v${VERSION}`),
    theme.tan('     github.com/itsmesherry/claude-audit'),
  ].join('\n');

  console.log(
    boxen(banner, {
      padding: 1,
      borderStyle: 'double',
      borderColor: AMBER.primary,
    }),
  );
  console.log();
}

export function printReport(report: AuditReport): void {
  const { project, overallScore, overallGrade, categories, allFindings } = report;

  // ── Header ────────────────────────────────────────────
  const gradeColor = GRADE_COLOR[overallGrade] ?? theme.cream;
  const scoreColor =
    overallScore >= 80 ? theme.bright
    : overallScore >= 60 ? theme.accent
    : theme.ember;

  const label = theme.primary;
  const dot = theme.tan('·');

  const headerContent = [
    `  ${label('Project')}     ${theme.accent.bold(project.name)}`,
    `  ${label('Path')}        ${theme.tan(path.relative(process.cwd(), project.path) || '.')}`,
    `  ${label('Scanned')}     ${theme.accent(project.totalFiles + ' files')} ${dot} ${theme.accent(project.totalLines.toLocaleString() + ' lines')}`,
    `  ${label('Stack')}       ${theme.accent(Object.keys(project.languages).join(', ') || 'Unknown')}`,
    project.frameworks.length > 0
      ? `  ${label('Frameworks')}  ${theme.accent(project.frameworks.join(', '))}`
      : '',
    '',
    `  ${theme.tan('━'.repeat(52))}`,
    `  ${label('OVERALL')}   ${scoreColor.bold(overallScore + '/100')}   ${label('GRADE')}   ${gradeColor(' ' + overallGrade + ' ')}`,
    `  ${theme.tan('━'.repeat(52))}`,
    '',
    `  ${report.aiPowered
      ? theme.primary('✦ AI-Powered Analysis (Claude)')
      : theme.primary('⚡ Static Analysis Mode')}`,
    `  ${label('Duration')}    ${theme.tan(`${formatDuration(report.durationMs)} · ${new Date(report.timestamp).toLocaleString()}`)}`,
  ].filter(l => l !== '').join('\n');

  const headerBorder =
    overallScore >= 80 ? AMBER.bright
    : overallScore >= 60 ? AMBER.primary
    : AMBER.ember;

  console.log(boxen(headerContent, {
    padding: { top: 0, bottom: 0, left: 1, right: 2 },
    borderStyle: 'round',
    borderColor: headerBorder,
    title: ' AUDIT REPORT ',
    titleAlignment: 'center',
  }));

  console.log();

  // ── Category Scores ───────────────────────────────────
  console.log(sectionHeader('Category Scores'));

  for (const cat of categories) {
    const icon = CATEGORY_ICONS[cat.category] ?? '  ';
    const grade = GRADE_COLOR[cat.grade]?.(` ${cat.grade} `) ?? ` ${cat.grade} `;
    const bar = scoreBar(cat.score);
    const scoreStr = cat.score >= 80
      ? theme.bright.bold(`${String(cat.score).padStart(3)}/100`)
      : cat.score >= 60
      ? theme.accent.bold(`${String(cat.score).padStart(3)}/100`)
      : theme.ember.bold(`${String(cat.score).padStart(3)}/100`);

    const issueCount = cat.findings.length;
    const issueStr = issueCount > 0
      ? theme.tan(` · ${issueCount} issue${issueCount === 1 ? '' : 's'}`)
      : theme.tan(' · Clean');

    const catLabel = (cat.category.charAt(0).toUpperCase() + cat.category.slice(1)).padEnd(14);
    console.log(
      `  ${icon}  ${theme.primary(catLabel)}  ${bar}  ${scoreStr}  ${grade}${issueStr}`,
    );
  }

  // ── Summary Stats ─────────────────────────────────────
  console.log(sectionHeader('Findings Summary'));

  const stats: { label: string; count: number; color: chalk.Chalk }[] = [
    { label: 'Critical', count: report.criticalCount, color: theme.ember.bold },
    { label: 'High',     count: report.highCount,     color: theme.deep.bold  },
    { label: 'Medium',   count: report.mediumCount,   color: theme.glow.bold  },
    { label: 'Low',      count: report.lowCount,      color: theme.bright.bold },
  ];

  const statLine = stats
    .map(s => `  ${theme.primary(s.label.padEnd(8))} ${s.color(String(s.count).padStart(3))}`)
    .join(theme.tan('  │'));
  console.log(statLine);

  // ── Findings ──────────────────────────────────────────
  if (allFindings.length === 0) {
    console.log();
    console.log(`  ${theme.primary('✓')}  ${theme.primary('No issues found — excellent codebase.')}`);
  } else {
    const grouped = groupBySeverity(allFindings);

    for (const [severity, findings] of grouped) {
      if (findings.length === 0) continue;
      const color = SEVERITY_COLOR[severity] ?? theme.cream;
      const icon = severity === 'critical' ? '🚨' : severity === 'high' ? '⚠️ ' : severity === 'medium' ? '📋' : '💡';

      console.log();
      console.log(`  ${icon} ${color(' ' + severity.toUpperCase() + ' ')} ${theme.primary('ISSUES')} ${theme.tan(`(${findings.length})`)}`);
      console.log(`  ${theme.tan('─'.repeat(70))}`);

      for (const finding of findings.slice(0, 20)) { // max 20 shown per severity
        printFinding(finding);
      }

      if (findings.length > 20) {
        console.log(`  ${theme.tan(`… and ${findings.length - 20} more. See full report in audit-report.md`)}`);
      }
    }
  }

  // ── Category AI Summaries ─────────────────────────────
  const summaries = categories.filter(c => c.summary && c.summary.length > 10);
  if (summaries.length > 0) {
    console.log(sectionHeader('AI Insights'));
    for (const cat of summaries) {
      const icon = CATEGORY_ICONS[cat.category] ?? '';
      console.log(`  ${icon}  ${theme.primary(cat.category.toUpperCase())}`);
      console.log(`     ${theme.cream(cat.summary)}`);
      console.log();
    }
  }

  // ── Footer ────────────────────────────────────────────
  console.log();
  console.log(`  ${theme.tan('━'.repeat(70))}`);
  console.log();

  if (report.criticalCount > 0) {
    console.log(`  ${theme.ember.bold('⛔')}  ${theme.ember.bold(report.criticalCount + ' CRITICAL issue(s) require immediate attention.')}`);
  } else if (overallScore >= 90) {
    console.log(`  ${theme.primary('✦')}  ${theme.primary('Excellent — your codebase is in great shape.')}`);
  } else if (overallScore >= 70) {
    console.log(`  ${theme.accent.bold('→')}  ${theme.primary('Good codebase. Address the flagged issues to level up.')}`);
  } else {
    console.log(`  ${theme.ember.bold('!')}  ${theme.deep.bold('Significant work needed. Start with critical and high severity.')}`);
  }
  console.log();
}

function printFinding(f: Finding): void {
  const icon = CATEGORY_ICONS[f.category] ?? '';
  console.log();
  console.log(`    ${icon} ${theme.primary(f.title)}`);
  console.log(`       ${theme.cream(truncate(f.description, 100))}`);

  if (f.file) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`       ${theme.tan('File')}  ${theme.accent(loc)}`);
  }

  if (f.snippet) {
    console.log(`       ${theme.tan('Code')}  ${theme.tan.italic(truncate(f.snippet, 90))}`);
  }

  if (f.fix) {
    console.log(`       ${theme.tan('Fix')}   ${theme.bright(truncate(f.fix, 100))}`);
  }
}

function groupBySeverity(findings: Finding[]): Map<Severity, Finding[]> {
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  const map = new Map<Severity, Finding[]>();
  for (const sev of order) map.set(sev, []);
  for (const f of findings) {
    map.get(f.severity)?.push(f);
  }
  return map;
}
