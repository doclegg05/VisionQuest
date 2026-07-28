# VisionQuest — Team Instructions

## Agent Onboarding Rule
The primary agent MUST read this CLAUDE.md first, then follow the Documentation Context Map below to read only the docs relevant to the current task. Subagents should NOT read the entire project — the primary agent determines which specific files and context each subagent needs.

## Documentation Context Map

Agents should read docs based on what they are doing. Do not read everything — follow the routing below.

### Level 0: Always Read First
- **This file (CLAUDE.md)** — project overview, operating rules, production environment, design context
- **[.claude/MEMORY.md](./.claude/MEMORY.md)** — project state and handoff: current status, last session, open items, engineering decisions log, architecture notes, known issues (imported below, so it loads with this file)

### Level 1: Product-Shaping Work
Read before any change that affects what users see or how workflows behave.
- **[docs/PRODUCT_GUIDE.md](./docs/PRODUCT_GUIDE.md)** — mission, users, charter, JTBD, 90-day outcomes, current gaps, decision lens

### Level 2: Scope or Framework Questions
Read when deciding what to build, cut, simplify, or automate.
- **[docs/PRODUCT_DECISIONS.md](./docs/PRODUCT_DECISIONS.md)** — authoritative scope decisions, 5-step framework applied to VisionQuest, immediate action plan

### Level 3: Domain-Specific (read only when working in that area)
| Area | Document |
|------|----------|
| Goal/learning/evidence architecture | [docs/ACADEMIC_EFFECTIVENESS_ROADMAP.md](./docs/ACADEMIC_EFFECTIVENESS_ROADMAP.md) |
| Infrastructure & Supabase optimization | [docs/plans/supabase-optimization.md](./docs/plans/supabase-optimization.md) |
| Funding & vendor billing structure | [docs/plans/funding-options-monthly-subscriptions.md](./docs/plans/funding-options-monthly-subscriptions.md) |
| Local AI hosting & tunnel recommendation | [docs/plans/2026-04-15-local-ai-tunnel-recommendation.md](./docs/plans/2026-04-15-local-ai-tunnel-recommendation.md) |
| Frontend redesign implementation | [docs/superpowers/plans/2026-03-30-frontend-redesign.md](./docs/superpowers/plans/2026-03-30-frontend-redesign.md) |
| Job board implementation | [docs/superpowers/plans/2026-03-31-job-board.md](./docs/superpowers/plans/2026-03-31-job-board.md) |
| Deployment & hosting | [DEPLOY.md](./DEPLOY.md) |
| Developer setup & scripts | [README.md](./README.md) |
| SPOKES program knowledge (Sage grounding) | [catalog/index.md](./catalog/index.md) — git-tracked OKF layer; staff record logic in `src/lib/spokes.ts` |
| Recursive self-improving loop (Ouroboros) — **DRAFT** | [docs/plans/self-improving-loop-architecture.md](./docs/plans/self-improving-loop-architecture.md) |
| Org-knowledge catalog (OKF) + the two agent memory systems | [docs/superpowers/specs/2026-06-30-okf-catalog-codex-review.md](./docs/superpowers/specs/2026-06-30-okf-catalog-codex-review.md) |
| `<gate>-pipeline` command contracts (CI-enforced) | [docs/superpowers/specs/2026-07-22-ci-pipeline-command-design.md](./docs/superpowers/specs/2026-07-22-ci-pipeline-command-design.md) |

### Level 4: The dated plan/spec corpus — search it, don't enumerate it
`docs/plans/` and `docs/superpowers/{plans,specs}/` hold ~80 dated working documents. They are
deliberately NOT listed here — listing them would bloat every session — but they are load-bearing,
and an agent that doesn't know they exist will draw confident, incomplete conclusions.

- **Naming**: `YYYY-MM-DD-<slug>.md`. A `plans/` file and its `specs/` counterpart usually pair up.
- **Status**: point-in-time records, not current state. On any conflict, `.claude/MEMORY.md` and
  `docs/PRODUCT_DECISIONS.md` win. A doc may describe something planned, deferred, or since undone —
  verify against the code before treating it as fact.
- **Before architecture, memory, or AI-infrastructure work, grep the corpus first**:
  `grep -ril "<subject>" docs/plans docs/superpowers`
  Do not declare a survey of any such subject complete without running it. This rule exists because a
  2026-07-27 review of the memory system mapped six layers and called the map complete, having missed
  two more that were described only here (MemPalace, CodeGraph).

### Archived (do not read unless explicitly asked)
- `docs/archive/GAMIFICATION_BACKLOG.md` — frozen planning artifact
- `docs/archive/SETUP_WIZARD_PLAN.md` — frozen planning artifact

## Project Memory (state, handoff, engineering decisions)
The live handoff — current status, last session, open items, engineering decisions log, architecture notes, and known issues — is maintained in `.claude/MEMORY.md` and imported here so it loads with this file. Update it at the end of every session.

@.claude/MEMORY.md

## Project Overview
- **Name**: VisionQuest
- **Description**: AI-coach-driven program portal for SPOKES workforce development (adults on TANF/SNAP). AI coach named "Sage" guides students through goal-setting, orientation, certification tracking, portfolio building, and employability skills.
- **Tech stack**: Next.js 16 (App Router), TypeScript, Prisma 6, Supabase (PostgreSQL + Storage), Google Gemini 3.1 Flash Lite, Tailwind CSS 4, Sentry
- **Hosting**: Render.com (free tier)
- **Repo**: https://github.com/doclegg05/VisionQuest.git
- **Live URL**: https://visionquest.onrender.com

## Architecture Notes
Maintained in [.claude/MEMORY.md](./.claude/MEMORY.md) (imported above) — the single home for architecture notes.

## Production Environment
- **Render Start Command**: `npm run prisma:migrate:deploy && node .next/standalone/server.js`
- **Render Build Command**: `npm ci && npx prisma generate && npm run build`
- **TEACHER_KEY**: Stored in Render env vars and `.env.local` only (not tracked in git)

## Product Scope Authority
- **Authoritative doc**: `docs/PRODUCT_DECISIONS.md` — governs all product scope decisions (5-step framework: Question → Delete → Simplify → Accelerate → Automate)
- **Key decision (April 1, 2026, superseded June 10, 2026)**: Vision Board, Files, and Resources features are retained; the chat-first redesign (user-approved 2026-06-09) moved Resources into Learning and renamed Files to "Documents" in nav. See the 2026-06-10 entry in PRODUCT_DECISIONS.md.

## Key Decisions Log
Maintained in [.claude/MEMORY.md](./.claude/MEMORY.md) (imported above) — the single home for engineering decisions. Product **scope** decisions stay in `docs/PRODUCT_DECISIONS.md` per the Product Scope Authority section above.

## Known Issues
Maintained in [.claude/MEMORY.md](./.claude/MEMORY.md) (imported above) — the single home for known issues.

## Design Context
- **Full design context**: See [.impeccable.md](./.impeccable.md) for complete design principles, color system, typography, and accessibility requirements
- **Brand personality**: Bold, Supportive, Practical — direct, action-oriented ally
- **Emotional goals**: Confidence, Momentum, Safety, Pride
- **Reference**: Khan Academy — warm, educational, progress-focused, not childish
- **Accessibility**: WCAG AA + low literacy focus (plain language, visual cues, large touch targets, 6th-grade reading level)
- **Design principles**: (1) Clarity over cleverness (2) Progress is visible (3) Warm but not childish (4) Action-first surfaces (5) Inclusive by default
