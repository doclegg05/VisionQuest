# VisionQuest — Agent Briefing (pointer)

**Read `CLAUDE.md` in this directory first — it is canonical** for the project
overview, architecture, decision log, known issues, and the Documentation Context Map.
Where it says "Claude Code," apply the instruction to yourself and your own tooling.

Non-negotiables for ANY agent in this repo, even if you read nothing else:

- **FERPA — full zone.** Never open files, exports, or DB dumps containing real student
  records; no student-record contents to any cloud LLM; path-level observations only.
- **Follow `.claude/rules/`** (security, prisma-conventions, api-conventions,
  code-style, ui-patterns, testing) and read `.impeccable.md` before touching UI.
- **Secrets** live in `.env.local` / Render env vars only — never read or print values,
  never commit them.

> Converted from a full duplicate to a pointer 2026-07-28 (Documentation Sync Rule
> DQ-3). Historical copy:
> `Dev/docs/previews/2026-07-28-visionquest-agents-md-original-archive.md`.
> Keep this file thin — edit CLAUDE.md, not this pointer.
