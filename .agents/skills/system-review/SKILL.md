---
name: system-review
description: Run weekly read-only audits of skills, MCP servers, hooks, agents, and Sprint Ledger. Produces prioritized [SYSTEM-REVIEW-REPORT] for human approval.
user-invocable: true
allowed-tools: "Read Bash Glob Grep"
---

# System Review

Run a structured audit of the engineering system and produce a [SYSTEM-REVIEW-REPORT]. This skill reads, analyzes, and proposes — it never edits files or commits changes. All proposed changes require human approval before implementation.

## When to Run

At the end of every fellowship week, or any time the system feels off.

## Step 1 — Gather System State

Read all of the following before forming any opinion:

```bash
# Recent work
cat SESSION_STATE.md

# Current rules and stack defaults
cat CLAUDE.md GEMINI.md

# Installed skills
ls skills/

# Configured MCP servers (static config + live connectivity/auth status per server)
cat .mcp.json
cat .gemini/settings.json
claude mcp list

# Active hooks (all of them — not just two)
cat .claude/hooks/*.sh

# Agent roster: full content, not just names — needed to compare against
# GEMINI.md's inline define_subagent blocks (Cross-Tool Parity, below)
cat .claude/agents/*.md

# Mechanical config-parity check (skill-copy file lists, MCP server names)
./.claude/hooks/check-config-parity.sh

# Recent git activity (last 2 weeks)
git log --oneline --since="2 weeks ago"

# Assignment directories (real work that has happened)
ls -d Week-*/  2>/dev/null || echo "No assignment directories yet"

# Any pyproject.toml files (ruff config in practice)
find . -name "pyproject.toml" -not -path "*/node_modules/*" 2>/dev/null

# Any package.json files (JS/TS stack in practice)
find . -name "package.json" -not -path "*/node_modules/*" 2>/dev/null
```

## Step 2 — Analyze Each Dimension

Work through each dimension below. For each one, note: (a) what you observed, (b) whether it's working, and (c) any specific proposed change. If a dimension has nothing to report, write "No signal yet."

### Skills
- Which skills were invoked in recent sessions (check SESSION_STATE.md and git log)?
- Which skills are installed but show no evidence of use?
- Are there skill triggers in CLAUDE.md/GEMINI.md that reference skills not installed?
- Do any installed skills overlap significantly in scope (duplication risk)?
- Is there a skill gap — a recurring task type that has no skill covering it?
- **Token-budget thresholds** (quantify bloat instead of eyeballing it): agent `description` frontmatter >30 words (taxes every Task-tool spawn), agent body >200 lines, skill body >400 lines, rule file >100 lines. Flag any file over threshold by name.
- **Skill-catalog routing tripwire**: count `skills/*/SKILL.md` (run `ls skills/*/SKILL.md | wc -l` at audit time). Practitioner-reported threshold (Kaggle/Google AI Agents Intensive, Day 3 — anecdotal, not benchmarked): flat-catalog routing reliability degrades around ~100 skills, driven by description-overlap distractors, not raw token count. Flag when count approaches 50-75 and recommend evaluating skill-description disambiguation or a hierarchical-routing layer — do not build a router pre-emptively below that count (Rule 8).

### MCP Servers
- Which servers were actively used (check SESSION_STATE.md)?
- Any servers configured but never referenced in recent work?
- Any server that's been needed but isn't configured?
- Any auth or connectivity issues mentioned in session history?
- **Live probes:** from the `claude mcp list` output, record each server's connection status. For any failed or misconfigured server, capture the error verbatim and check `wiki/Runbook.md` for a known remediation before proposing a new one.
- **Credentials:** confirm expected env keys exist by *name only* (e.g. `grep -oE '^[A-Z_]+' .env` — never echo values into the report) and flag obvious placeholders (docs-example URLs, malformed keys) as P1 issues before they burn a session.
- **Runbook:** does `wiki/Runbook.md` exist and cover the failures seen this period? For any diagnosis not yet recorded, propose a symptom → cause → fix entry in the report — the write lands via human approval (or Aspen), not this skill.

### Hooks
- Did the `post-edit-lint.sh` hook fire correctly on Python files? Any false positives or missed lints?
- Did the `stop-session-state.sh` hook fire correctly? Any sessions where it was skipped or misfired?
- Any new automation needs that a hook could cover (e.g., auto-run tests on edit, auto-format JS)?

### Agent Roster
- Were all nine agents (pine, birch, cedar, cypress, redwood, magnolia, banyan, aspen, willow) used as intended?
- Any agent that was called for work outside its role?
- Any role gap — a type of task that doesn't fit any current agent?

### Cross-Tool Parity (CLAUDE.md ↔ GEMINI.md)
CLAUDE.md and GEMINI.md are independent, standalone files (no longer symlinked to a shared
AGENTS.md) — same rules today, free to diverge, which means nothing but this audit and
`check-config-parity.sh` catches drift between them. This section is judgment-based, not
mechanical: the two files are structurally different by design (Gemini translates Claude's
hook-based mechanics into manual "Hooks Equivalent" disciplines), so a blind text diff would
read as ~100% different and be useless — read both and compare substance, not phrasing.
- Were any workflow rules violated or bent in recent sessions?
- Any rule that generated confusion or needed re-explanation?
- Any rule that feels too strict or too loose given actual assignment work?
- Does the Fellowship Stack section still reflect the actual stack used?
- **Rules distillation (quarterly):** has the same principle shown up independently in 2+ skills/agents without being promoted to a rule? If so, propose the one-sentence addition to CLAUDE.md/GEMINI.md rather than leaving it duplicated.
- **Workflow Rules parity:** same count (currently 11), same numbering/titles, equivalent
  substance in both files? Flag substantive gaps (a rule present in one but not the other),
  not tool-specific phrasing differences.
- **Team Roster parity:** same 9 agents, same roles, in both files' rosters?
- **Handoff Schemas parity:** the `## Handoff Schemas` blocks should be identical **except**
  each block's closing parenthetical, which correctly differs (`.claude/agents/*.md` files for
  Claude vs. inline system prompts for Gemini). Flag anything beyond that one expected
  difference per block.
- **Agent-definition parity:** does each `.claude/agents/*.md` file match its corresponding
  `define_subagent` block in GEMINI.md — same role description, same tool-equivalent
  restrictions, same assigned-skills list?
- **Hooks-equivalence parity:** does every script in `.claude/hooks/*.sh` (including
  `check-config-parity.sh`) have a documented, still-accurate manual equivalent under GEMINI.md's
  "Gemini Hooks Equivalent" section?
- **Mechanical config parity:** did `./.claude/hooks/check-config-parity.sh` (Step 1) report any
  drift? If so, that's a P1 — it means a skill-copy file list or the MCP server lists diverged
  without anyone noticing.

### Ruff / Lint Config
- Was Python code written in any assignment? If so:
  - Was ruff enforced? Any recurring lint categories that keep firing?
  - Is the `D` (pydocstyle/Google-style) rule causing friction or working well?
  - Any rule sets that should be added or relaxed for the actual project type?
- Was JS/TS code written? Is eslint configured and working?

### Sprint Ledger (SESSION_STATE.md)
- Any "Next Steps" item that has appeared in multiple sessions without progress?
- Any recurring blocker pattern?
- Is the Ledger being updated correctly at session end, or is the hook frequently reminding?

### Upcoming Phase Readiness
- What phase is next (L1/L2/L3)?
- Is the system ready for that phase's specific demands?
  - L1: solo MVPs, API integrations, "Build in Public" — any tooling gaps?
  - L2: PRD-first, paired work, industry-specific (finance/health/climate) — `prd-builder` skill ready?
  - L3: legacy codebase inheritance, multi-team, client briefs — any scaffolding needed?

## Step 3 — Produce the Report

Output this block verbatim, filled in:

```
[SYSTEM-REVIEW-REPORT]
- **Week**: <week number or date range>
- **Status**: GREEN | YELLOW | RED
  - GREEN: system working well, minor tweaks only
  - YELLOW: one or more issues worth fixing this week
  - RED: something actively broken or blocking assignment work

**Wins** (what's working — record these so they don't get second-guessed)
- <item>

**Issues** (prioritized)
| Priority | Dimension | Issue | Proposed fix |
|---|---|---|---|
| P0 | <dim> | <blocking issue> | <specific change> |
| P1 | <dim> | <worth fixing this week> | <specific change> |
| P2 | <dim> | <low-priority, log and revisit> | <specific change> |

**No-signal dimensions** (reviewed, nothing to report)
- <list dimensions with no findings>

**Defer list** (noticed but not worth acting on now — revisit next review)
- <item>
```

## Step 4 — Hand Off

Present the report to the human. For any P0 or P1 item, state clearly:

> "To implement [proposed fix]: [one sentence describing what file to change and how]. Should I do this now?"

Do not implement anything without explicit approval. Do not batch multiple changes without approval for each.

## Anti-Patterns

| Don't | Do instead |
|---|---|
| Propose sweeping rewrites of CLAUDE.md/GEMINI.md | Propose one targeted sentence change |
| Add skills speculatively ("might be useful") | Add skills only when a specific gap is evidenced |
| Flag PEP 8 style issues as system problems | Those are ruff's job — only escalate if ruff isn't catching them |
| Mark something RED because it's unfamiliar | RED means actively broken or blocking — not just suboptimal |
| Skip dimensions with no current signal | Write "No signal yet" — the absence of signal is itself information |
