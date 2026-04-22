# claude-audit — TODO

## 1. Fix theme mismatch between HTML report and terminal output
- `.claude-audit/audit-report.html` does not match the warm amber palette used in the terminal reporter (`src/reporters/terminal.ts`).
- Align the HTML report's colours, typography, and section styling with the terminal theme (amber primary `#D97757`, bright `#E8A87C`, deep `#B85C38`, glow `#F4A261`, cream `#F4E5D3`, tan `#A67B5B`, ember `#C44536`).
- Ensure consistent visual language across terminal, markdown, and HTML outputs.

## 2. Self-audit: run claude-audit on this codebase and fix what it flags
- Run the agentic audit against the repo itself: `node dist/index.js . --verbose`.
- Triage findings by severity (critical → high → medium → low).
- Fix legitimate issues; document intentional exceptions in code or README.
- Re-run to confirm the score improves and no new regressions are introduced.

## 3. Enhance the HTML report UI
- Current `.claude-audit/audit-report.html` looks dated/ugly — redesign for a polished, modern aesthetic.
- Improvements to consider:
  - Proper typography scale, spacing rhythm, and visual hierarchy.
  - Clean cards for each category with severity-coded accents.
  - Sticky summary header with overall score + grade ring.
  - Collapsible finding details with code snippets (syntax highlighted).
  - Agent-trace panel when `agentTrace` is present (turns, tool usage, cache %).
  - Responsive layout (mobile-friendly).
  - Dark-mode friendly by default, matching the amber terminal theme.
