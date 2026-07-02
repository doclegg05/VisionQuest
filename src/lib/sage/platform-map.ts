// =============================================================================
// Platform Map — Sage's grounded knowledge of the VisionQuest platform itself.
//
// Pure data module: no Prisma import, no `server-only` import. This keeps it
// importable from unit tests, the CLI validator (scripts/platform/validate.mjs),
// and the system prompt builder without pulling in server-only runtime deps.
//
// Each PlatformFeature is a flat, hand-edited entry an operator can scan and
// adjust without touching the render logic below. `platform-map-validate.ts`
// checks these entries against the real route tree and tool registry so the
// map can't silently drift from the app it describes.
// =============================================================================

import type { PromptTier } from "@/lib/ai/types";

export type PlatformRole = "student" | "teacher" | "coordinator" | "admin";

export interface PlatformFeature {
  /** Stable id, unique across the whole map. */
  id: string;
  /** Human-readable feature name. */
  name: string;
  /** Which roles see/use this feature. */
  roles: PlatformRole[];
  /** App route this feature lives at, if it has a dedicated page. */
  route?: string;
  /** Full-tier one-line description of what the feature is/does. */
  summary: string;
  /** Optional compact-tier phrase — only entries with this appear in compact renders. */
  compact?: string;
  /** Optional full-tier sub-line with mechanics/behavioral detail. */
  mechanics?: string;
  /** Agent tool names (from src/lib/sage/agent/tools.ts) this feature exposes. */
  tools?: string[];
  /** Related feature ids, for operator cross-reference (not rendered). */
  seeAlso?: string[];
}

// ---------------------------------------------------------------------------
// Behavioral preambles — one per role, action-first stance. The student
// preamble is lifted verbatim from the old PLATFORM_KNOWLEDGE constant.
// ---------------------------------------------------------------------------

const STUDENT_PREAMBLE = `ABOUT THE VISIONQUEST PLATFORM:
Visionquest is the digital hub for the SPOKES (Skills, Preparation, Opportunities, Knowledge, Employment, Success) workforce training program under West Virginia Adult Education.

YOUR ROLE HERE: You are the student's hands-on guide INSIDE this platform — not a search engine and not a help article. When a student needs something here, help them actually get it done: open the form, track the certification, tidy the portfolio, find and apply for jobs, book the advising appointment. Move with them through the program; don't just describe where a button is.`;

const TEACHER_PREAMBLE = `ABOUT THE VISIONQUEST PLATFORM:
Visionquest is the digital hub for the SPOKES workforce training program under West Virginia Adult Education. Instructors use it to run their classroom: track student progress, review orientation and forms, and manage the roster.

YOUR ROLE HERE: You are the instructor's hands-on assistant INSIDE this platform — not a search engine and not a help article. When an instructor needs something here, help them actually get it done: pull up the intervention queue, open a student's record, review an orientation submission. Move with them through their workflow; don't just describe where a button is.`;

const COORDINATOR_PREAMBLE = `ABOUT THE VISIONQUEST PLATFORM:
Visionquest is the digital hub for the SPOKES workforce training program under West Virginia Adult Education. Regional coordinators use it to oversee program health across classrooms: grant/benchmark progress, instructor metrics, and funder-ready reporting.

YOUR ROLE HERE: You are the coordinator's hands-on assistant INSIDE this platform — not a search engine and not a help article. When a coordinator needs something here, help them actually get it done: pull up the regional rollup, check grant benchmark status, or prepare a funder export. Move with them through their workflow; don't just describe where a button is.`;

const ADMIN_PREAMBLE = `ABOUT THE VISIONQUEST PLATFORM:
Visionquest is the digital hub for the SPOKES workforce training program under West Virginia Adult Education. Administrators use it to configure the program, oversee usage, and analyze outcomes across the whole platform.

YOUR ROLE HERE: You are the admin's hands-on assistant INSIDE this platform — not a search engine and not a help article. When an admin needs something here, help them actually get it done: check AI provider configuration, review usage patterns, or pull outcome data. Move with them through their workflow; don't just describe where a button is.`;

const ROLE_PREAMBLES: Record<PlatformRole, string> = {
  student: STUDENT_PREAMBLE,
  teacher: TEACHER_PREAMBLE,
  coordinator: COORDINATOR_PREAMBLE,
  admin: ADMIN_PREAMBLE,
};

// ---------------------------------------------------------------------------
// PLATFORM_MAP — flat array of feature entries, grouped by role for
// scannability. An entry with multiple roles appears once and is filtered
// into every relevant role's render.
// ---------------------------------------------------------------------------

export const PLATFORM_MAP: PlatformFeature[] = [
  // ─── Student ────────────────────────────────────────────────────────────
  {
    id: "career-discovery",
    name: "Career Discovery",
    roles: ["student"],
    summary:
      "A conversational career assessment (inside Chat) that surfaces interests, transferable skills, and work values without ever naming RIASEC/Holland codes to the student.",
    compact: "career discovery (chat-based interest/skills assessment)",
    mechanics:
      "Runs as the discovery conversation stage. Produces a Career Profile with a Holland Interest Profile, transferable skills, work values, and top career clusters.",
    seeAlso: ["career-profile"],
  },
  {
    id: "career-profile",
    name: "Career Profile (Career DNA)",
    roles: ["student"],
    route: "/career",
    summary:
      "The student's results from Career Discovery — Holland code, transferable skills, work values, and top career clusters — reviewed together with Sage.",
    compact: "career profile results review",
    mechanics: "Bridges into goal-setting: Sage connects clusters to concrete SPOKES certifications.",
    seeAlso: ["career-discovery", "goals"],
  },
  {
    id: "goals",
    name: "Goal Setting",
    roles: ["student"],
    route: "/goals",
    summary:
      "Conversation-based goal system: BHAG (Big Hairy Audacious Goal) broken into monthly, weekly, daily goals and tasks.",
    compact: "goals (BHAG -> monthly -> weekly -> daily -> tasks, Sage proposes + you confirm)",
    mechanics:
      "Hierarchy is BHAG -> monthly -> weekly -> daily -> task. Sage proposes goals during conversation; the student confirms them before they're recorded — this is the wager/goal-proposal-confirmation mechanic. Sage tracks its own proposal hit rate (how often proposed goals get confirmed) to calibrate how confidently it proposes future goals.",
    tools: ["update_goal_status"],
    seeAlso: ["vision-board", "career-profile"],
  },
  {
    id: "vision-board",
    name: "Vision Board",
    roles: ["student"],
    route: "/vision-board",
    summary: "A visual board where students keep their BHAG and dream imagery visible as motivation.",
    compact: "vision board (visual BHAG reminder)",
    tools: ["open_resource"],
  },
  {
    id: "orientation",
    name: "Orientation",
    roles: ["student"],
    route: "/orientation",
    summary:
      "New-student onboarding: required forms and a walkthrough of what the SPOKES program offers and expects.",
    compact: "orientation (onboarding forms + program intro)",
    mechanics:
      "Covers Student Profile, Personal Attendance Contract, Rights and Responsibilities, Dress Code Policy, Release of Information, Media Release, Technology Acceptable Use Policy, Employment Portfolio Checklist, Learning Needs Screening, CTE Learning Styles Assessment, and the Non-Discrimination Notice.",
    seeAlso: ["forms"],
  },
  {
    id: "forms",
    name: "Forms Hub",
    roles: ["student"],
    route: "/forms",
    summary: "Central place to find, fill, and submit every SPOKES program form.",
    compact: "forms hub",
    tools: ["present_form", "search_forms", "submit_form"],
  },
  {
    id: "learning",
    name: "Learning (LMS + Certifications)",
    roles: ["student"],
    route: "/learning",
    summary:
      "Merged Courses + Certifications surface: links to 11 external learning platforms (GMetrix, Edgenuity, Khan Academy, Burlington English, etc.) plus the Ready-to-Work certification tracker.",
    compact: "learning hub (11 external LMS platforms + cert tracker)",
    mechanics:
      "Certification progress can be self-reported by the student or verified by an instructor — some items need instructor sign-off before they count as complete.",
    tools: ["find_certification", "lookup_cert_progress", "mark_certification_complete"],
    seeAlso: ["portfolio"],
  },
  {
    id: "portfolio",
    name: "Portfolio Builder",
    roles: ["student"],
    route: "/portfolio",
    summary:
      "Where students collect certifications, build a resume, and showcase work — can be shared as a public credential page.",
    compact: "portfolio builder (resume + credentials + public page)",
    tools: [
      "review_portfolio",
      "add_portfolio_item",
      "edit_portfolio_item",
      "delete_portfolio_item",
      "propose_resume_edit",
    ],
    seeAlso: ["learning"],
  },
  {
    id: "jobs",
    name: "Career / Job Search",
    roles: ["student"],
    route: "/jobs",
    summary:
      "Job board and application pipeline: save jobs, analyze fit against the student's real profile, prep for interviews, and draft cover letters.",
    compact: "job search (save, match, interview prep, cover letters)",
    tools: [
      "save_job",
      "lookup_saved_jobs",
      "analyze_job_match",
      "prepare_for_interview",
      "generate_cover_letter",
      "update_application_status",
    ],
  },
  {
    id: "chat",
    name: "Chat with Sage",
    roles: ["student"],
    route: "/chat",
    summary: "The student's main conversation surface with Sage — goal-setting, coaching, and every agent tool above.",
    compact: "chat with Sage",
  },
  {
    id: "appointments",
    name: "Appointments / Advising",
    roles: ["student"],
    route: "/appointments",
    summary: "Book and view advising check-ins with SPOKES staff.",
    compact: "appointments (book advising check-ins)",
    tools: ["lookup_appointment", "find_appointment_slots", "book_appointment"],
  },
  {
    id: "files",
    name: "Files / Documents",
    roles: ["student"],
    route: "/files",
    summary: "Uploaded files and documents — certificates, IDs, receipts — that Sage can classify and file for the student.",
    compact: "files/documents (upload + auto-classify)",
    tools: ["classify_attachment", "file_document"],
  },
  {
    id: "resources",
    name: "Resources",
    roles: ["student"],
    route: "/resources",
    summary: "Reference material: dress code, attendance policy, and the student handbook.",
    compact: "resources (policies + handbook)",
    tools: ["open_resource"],
  },
  {
    id: "dashboard",
    name: "Progress Dashboard",
    roles: ["student"],
    route: "/dashboard",
    summary: "Shows XP, streaks, achievements, and progress across every module.",
    compact: "dashboard (XP, streaks, achievements)",
  },

  // ─── Teacher ────────────────────────────────────────────────────────────
  {
    id: "teacher-intervention-queue",
    name: "Intervention Queue",
    roles: ["teacher"],
    route: "/teacher",
    summary:
      "Urgency-scored list of which students most need a check-in right now, with plain-language reasons (stalled goals, overdue tasks, low activity, open alerts).",
    compact: "intervention queue (who needs attention, urgency-scored)",
    mechanics: "This is the primary teacher dashboard surface — it ranks students, not just lists them.",
    tools: ["list_students_needing_attention"],
  },
  {
    id: "teacher-classes",
    name: "Roster / Classes",
    roles: ["teacher"],
    route: "/teacher/classes",
    summary: "The instructor's classes and rosters.",
    compact: "roster/classes",
  },
  {
    id: "teacher-student-record",
    name: "Student Record",
    roles: ["teacher"],
    route: "/teacher/students/[id]",
    summary: "Full per-student detail view: overview, goals & plan, progress, and operations tabs.",
    compact: "per-student record (overview, goals, progress, operations)",
    seeAlso: ["teacher-student-spokes"],
  },
  {
    id: "teacher-student-spokes",
    name: "Student SPOKES Tab",
    roles: ["teacher"],
    route: "/teacher/students/[id]/spokes",
    summary: "SPOKES-specific workspace for a single student, integrated into the student record.",
    compact: "student SPOKES tab",
    seeAlso: ["teacher-student-record"],
  },
  {
    id: "teacher-orientation-review",
    name: "Orientation Review",
    roles: ["teacher"],
    route: "/teacher/orientation",
    summary: "Review and approve student orientation form submissions.",
    compact: "orientation review (approve student submissions)",
  },
  {
    id: "teacher-manage",
    name: "Manage",
    roles: ["teacher"],
    route: "/teacher/manage",
    summary: "Classroom management and administrative settings for the instructor's classes.",
    compact: "manage (classroom admin settings)",
  },
  {
    id: "teacher-library",
    name: "Library",
    roles: ["teacher"],
    route: "/teacher/library",
    summary: "Program document library curated for instructor reference and Sage grounding.",
    compact: "library (program documents)",
  },
  {
    id: "teacher-chat",
    name: "Teacher Chat",
    roles: ["teacher"],
    route: "/teacher/chat",
    summary: "The instructor's own conversation with Sage — program knowledge, student advising, and operational help.",
    compact: "teacher chat with Sage",
  },

  // ─── Coordinator ────────────────────────────────────────────────────────
  {
    id: "coordinator-rollups",
    name: "Regional Rollups",
    roles: ["coordinator"],
    route: "/coordinator",
    summary: "Aggregate program health across every classroom in the coordinator's assigned regions.",
    compact: "regional rollups (program health by region)",
  },
  {
    id: "coordinator-grant-progress",
    name: "Grant / Benchmark Progress",
    roles: ["coordinator"],
    route: "/coordinator",
    summary: "Tracks progress against grant goals and program benchmarks for the coordinator's regions.",
    compact: "grant/benchmark progress tracking",
  },
  {
    id: "coordinator-instructor-metrics",
    name: "Instructor Metrics",
    roles: ["coordinator"],
    route: "/coordinator",
    summary: "Aggregate performance metrics for instructors across the coordinator's assigned regions.",
    compact: "instructor metrics (aggregate, by region)",
  },
  {
    id: "coordinator-exports",
    name: "Funder-Ready Exports",
    roles: ["coordinator"],
    route: "/coordinator",
    summary: "Export program data formatted for grant funders and compliance reporting.",
    compact: "funder-ready exports",
  },

  // ─── Admin ──────────────────────────────────────────────────────────────
  {
    id: "admin-program-setup",
    name: "Program Setup",
    roles: ["admin"],
    route: "/admin",
    summary:
      "Platform-wide configuration, including AI provider setup (which model/provider serves every student) and secrets management.",
    compact: "program setup (incl. AI provider config)",
    mechanics: "Secrets (API keys, Cloudflare credentials) are never readable or settable through chat — only through this UI.",
    tools: ["get_system_status", "set_system_config"],
  },
  {
    id: "admin-library",
    name: "Admin Library",
    roles: ["admin"],
    route: "/admin/library",
    summary: "Program document library at the admin level — the source material Sage's RAG grounding draws from.",
    compact: "admin library (RAG grounding documents)",
  },
  {
    id: "admin-chat",
    name: "Admin Chat",
    roles: ["admin"],
    route: "/admin/chat",
    summary: "The admin's own conversation with Sage — operational questions, program knowledge, and outcome analysis.",
    compact: "admin chat with Sage",
  },
  {
    id: "admin-outcome-analysis",
    name: "Outcome / Usage Analysis",
    roles: ["admin"],
    summary:
      "Platform usage patterns and student outcome trends, surfaced through admin chat and reporting — supports analysis, never predicts outcomes.",
    compact: "outcome/usage analysis",
  },

  // ─── Utility pages (student) — intentionally thin/no entry needed for chat ───
  // profile, settings, and the legacy classic dashboard are plain account
  // utility pages with no coaching surface. They are listed in ROUTE_IGNORE
  // in platform-map-validate.ts rather than given feature entries here.
];

// ---------------------------------------------------------------------------
// buildPlatformKnowledge — renders the role-filtered block injected into the
// Sage system prompt.
// ---------------------------------------------------------------------------

const COMPACT_CHAR_LIMIT = 650;

export function buildPlatformKnowledge(role: PlatformRole, tier: PromptTier): string {
  const entries = PLATFORM_MAP.filter((entry) => entry.roles.includes(role));

  if (tier === "compact") {
    const compactEntries = entries.filter((entry) => Boolean(entry.compact));
    if (compactEntries.length === 0) return "";
    return `VISIONQUEST PLATFORM: ${compactEntries.map((entry) => entry.compact).join("; ")}.`;
  }

  const lines = entries.map((entry) => {
    const routePart = entry.route ? ` (${entry.route})` : "";
    const header = `- ${entry.name}${routePart}: ${entry.summary}`;
    return entry.mechanics ? `${header}\n  ${entry.mechanics}` : header;
  });

  return [ROLE_PREAMBLES[role], "", "PLATFORM MODULES:", ...lines].join("\n");
}

export { COMPACT_CHAR_LIMIT };
