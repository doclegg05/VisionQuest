#!/usr/bin/env node

/**
 * Sage living-agent freshness eval.
 *
 * Proves whether a NATIVE app change (a DB write made through the same lib
 * helpers the real routes use — not a chat message) shows up in Sage's very
 * next context assembly. "Context assembly" here is exactly what the student
 * chat path composes per request (src/app/api/chat/send/route.ts:504-530):
 *
 *   assembleStudentContextBundle(studentId, { viewer: "sage",
 *     includeChatPromptContext: true })   — src/lib/sage/context-bundle.ts
 *   + getSituationalSnapshot(studentId)   — src/lib/sage/situational-snapshot.ts
 *
 * Two case groups:
 *
 *   GROUP A — cold-context visibility (gates; must PASS today).
 *     Make the change, flush the chat:* cache, assemble, assert the change is
 *     visible. This proves the DB→context read plane end to end.
 *
 *   GROUP B — post-cache staleness (red baseline; expected to FAIL today).
 *     Assemble once (warming chat:base-context:* TTL 300s and chat:snapshot:*
 *     TTL 180s), make the change, assemble again WITHOUT flushing, assert the
 *     change is visible. No write anywhere invalidates those chat:* keys
 *     today, so these cases document the staleness window that Phase 3's
 *     write-through invalidation will close. Each case also re-asserts on a
 *     flushed third assembly so a broken write can never masquerade as
 *     staleness (that third check is a hard gate).
 *
 * Change types deliberately TRIMMED (the context assembly genuinely does not
 * surface them — verified against the source):
 *   - application-status-changed: context-bundle.ts hardcodes
 *     applicationCount: 0 and nothing else in the assembly reads Application.
 *   - sage-memory-row-stored (SageMemory): memories reach Sage through
 *     getMemoryContext/retrieveMemories in the chat route (route.ts:601), a
 *     separate retrieval path — not through the bundle or snapshot. The
 *     bundle's memory-like surface is SageInsight, covered by the
 *     sage-insight-recorded case.
 *
 * Hermetic-friendly AND environment-independent: runs against DATABASE_URL
 * as-is; needs no LLM key and no pre-seeded data, and produces identical
 * verdicts on an empty hermetic DB and on a populated shared dev DB. Two
 * rules keep it that way:
 *   1. The cert case ALWAYS seeds its own marker CertTemplates under a
 *      unique marker certType — never the real ready-to-work templates,
 *      whose shape (needsFile/needsVerify mix) varies by environment.
 *      Safe by construction: every production CertTemplate read is scoped
 *      to certType "ready-to-work", and syncCertificationRequirements
 *      filters templates by the certification's OWN certType, so a marker
 *      certType can never appear in another student's sync (verified
 *      2026-08-19 across all 8 certTemplate callsites).
 *   2. Assertions never depend on an aggregate line's absolute shape —
 *      formatList() in student-status.ts truncates lists at 4 entries
 *      ("…and N more"), which swallows marker labels on a populated DB.
 *      Aggregate surfaces are asserted as DELTAS from a same-run baseline
 *      (e.g. the "X/Y complete" checklist counts), and entity presence is
 *      asserted on untruncated structured arrays or student-scoped lines.
 * Every seeded row is marker-prefixed and deleted in a finally block; a
 * zero-count proof runs at the end. On a shared dev DB the two marker
 * orientation items transiently raise the global item total for the
 * duration of the run (~seconds) — they are removed in cleanup.
 *
 * Usage:
 *   npm run sage:freshness:eval             # Group A gates; Group B reports
 *   npm run sage:freshness:eval -- --strict # Group B staleness also gates
 *   npm run sage:freshness:eval -- --keep   # skip cleanup (debugging)
 */

import { loadEnvFile } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const RUN_ID = Date.now().toString(36);
const ID_PREFIX = "fresheval-";
const MARKER_PREFIX = "[FRESHEVAL"; // orientation items / cert templates / content markers
const STUDENT_ID = `${ID_PREFIX}student-${RUN_ID}`;
const TEACHER_ID = `${ID_PREFIX}teacher-${RUN_ID}`;
const CONVERSATION_ID = `${ID_PREFIX}conv-${RUN_ID}`;
const CERT_TYPE_MARKER = `${ID_PREFIX}cert-${RUN_ID}`;
const STRICT = process.argv.includes("--strict");
const KEEP = process.argv.includes("--keep");

const BASE_CONTEXT_TTL_SECONDS = 300; // chat:base-context:* (src/lib/chat/context.ts)
const SNAPSHOT_TTL_SECONDS = 180; // chat:snapshot:* (src/lib/sage/situational-snapshot.ts)

/** Unique per-case content marker. */
function mk(tag) {
  return `${MARKER_PREFIX}-${RUN_ID}-${tag}]`;
}

function snippet(text, marker, radius = 60) {
  if (typeof text !== "string") return String(text);
  const i = text.indexOf(marker);
  if (i === -1) return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  return text.slice(Math.max(0, i - radius), i + marker.length + radius);
}

async function main() {
  const { prisma } = await import("../src/lib/db.ts");
  const { invalidatePrefix } = await import("../src/lib/cache.ts");
  const { assembleStudentContextBundle } = await import("../src/lib/sage/context-bundle.ts");
  const { getSituationalSnapshot } = await import("../src/lib/sage/situational-snapshot.ts");
  const { proposeGoal } = await import("../src/lib/sage/propose-goal.ts");
  const { recordInsight } = await import("../src/lib/sage/record-insight.ts");
  const { applyStudentOrientationCompletion } = await import("../src/lib/orientation-completion.ts");
  const { recomputeCertificationStatus } = await import("../src/lib/certification-service.ts");
  const { awardEvent } = await import("../src/lib/progression/events.ts");
  const { FORMS } = await import("../src/lib/spokes/forms.ts");

  // ---------------------------------------------------------------------
  // The exact per-request composition of the student chat path.
  // flush=true clears every chat:* cache key first (Group A / write-plane
  // checks); flush=false replays the cached path (Group B staleness probe).
  // ---------------------------------------------------------------------
  async function assembleContext({ flush }) {
    if (flush) invalidatePrefix("chat:");
    const bundle = await assembleStudentContextBundle(STUDENT_ID, {
      viewer: "sage",
      conversationId: CONVERSATION_ID,
      conversationStage: "discovery",
      includeChatPromptContext: true,
    });
    const snapshot = await getSituationalSnapshot(STUDENT_ID);
    return { bundle, ctx: bundle.chatPromptContext, snapshot };
  }

  // ---------------------------------------------------------------------
  // Cleanup. Order matters: the student cascade removes goals/appointments/
  // certs before the teacher and marker templates can be deleted safely.
  // ---------------------------------------------------------------------
  async function cleanup(label) {
    await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: ID_PREFIX } } });
    await prisma.student.deleteMany({ where: { id: { startsWith: `${ID_PREFIX}student-` } } });
    await prisma.student.deleteMany({ where: { id: { startsWith: `${ID_PREFIX}teacher-` } } });
    await prisma.orientationItem.deleteMany({ where: { label: { startsWith: MARKER_PREFIX } } });
    await prisma.certTemplate.deleteMany({ where: { label: { startsWith: MARKER_PREFIX } } });
    if (label) console.log(`(${label})`);
  }

  // Self-heal leftovers from any earlier crashed run before seeding.
  await cleanup("pre-run sweep of any fresheval leftovers");

  // ---------------------------------------------------------------------
  // Seed the disposable fixture (all marker-prefixed, removed in finally).
  // ---------------------------------------------------------------------
  await prisma.student.create({
    data: {
      id: STUDENT_ID,
      studentId: `FRESHEVAL-${RUN_ID}-S`,
      displayName: `Freshness Eval Student ${RUN_ID}`,
      role: "student",
    },
  });
  await prisma.student.create({
    data: {
      id: TEACHER_ID,
      studentId: `FRESHEVAL-${RUN_ID}-T`,
      displayName: `Freshness Eval Teacher ${RUN_ID}`,
      role: "teacher",
    },
  });

  // Two required orientation items (A-case + B-case). Their labels map to no
  // wizard forms, so the student path records an honor-system claim and the
  // instructor confirm completes it — the full two-step native flow.
  const itemA = await prisma.orientationItem.create({
    data: { label: `${mk("item-A")} Safety basics review`, required: true, sortOrder: 9000 },
  });
  const itemB = await prisma.orientationItem.create({
    data: { label: `${mk("item-B")} Workplace tour sign-in`, required: true, sortOrder: 9001 },
  });

  // One file to attach to form submissions (FormSubmission.fileId is required;
  // mirrors the placeholder file the sign route creates).
  const file = await prisma.fileUpload.create({
    data: {
      studentId: STUDENT_ID,
      filename: `${mk("file")} signature.png`,
      mimeType: "image/png",
      sizeBytes: 1,
      storageKey: `fresheval/${RUN_ID}/signature.png`,
      category: "signature",
    },
  });

  // Two required onboarding forms from the static catalog — the same filter
  // REQUIRED_ONBOARDING_FORMS applies in src/lib/student-status.ts.
  const requiredForms = FORMS.filter(
    (f) =>
      f.category === "onboarding" &&
      f.required &&
      f.acceptsSubmission &&
      (f.audience === "student" || f.audience === "both"),
  ).sort((l, r) => l.sortOrder - r.sortOrder);
  if (requiredForms.length < 2) {
    throw new Error("Fixture needs >= 2 required onboarding forms in src/lib/spokes/forms.ts");
  }
  const [formX, formY] = requiredForms;

  // Cert templates: ALWAYS seed marker templates under a unique marker
  // certType so the case never depends on the real ready-to-work template
  // table's shape (its needsFile/needsVerify mix varies by environment).
  // Safe: every production CertTemplate read filters certType
  // "ready-to-work", and requirement sync filters by the cert's own
  // certType, so these rows are invisible to real students and staff.
  // The pair deliberately exercises both satisfaction axes of
  // isRequirementSatisfied: one needsVerify template, one needsFile.
  await prisma.certTemplate.createMany({
    data: [
      { certType: CERT_TYPE_MARKER, label: `${mk("tpl-1")} Attendance module`, required: true, needsVerify: true, needsFile: false, sortOrder: 9000 },
      { certType: CERT_TYPE_MARKER, label: `${mk("tpl-2")} Mock interview`, required: true, needsVerify: false, needsFile: true, sortOrder: 9001 },
    ],
  });

  const results = { A: [], B: [] };

  function reportA(id, pass, evidence) {
    results.A.push({ id, pass, evidence });
    console.log(`  [A] ${pass ? "PASS" : "FAIL"} ${id}${evidence ? ` — ${evidence}` : ""}`);
  }

  // Shared helper for the two-step orientation completion (student claim via
  // the shared lib helper, then the instructor confirm exactly as
  // completeAsStaff writes it in src/app/api/orientation/route.ts).
  async function completeOrientationItem(item) {
    const claim = await applyStudentOrientationCompletion(STUDENT_ID, item.id);
    if (claim.outcome !== "pending_verification" && claim.outcome !== "completed") {
      throw new Error(`orientation claim unexpected outcome: ${claim.outcome}`);
    }
    if (claim.outcome === "pending_verification") {
      const now = new Date();
      await prisma.orientationProgress.upsert({
        where: { studentId_itemId: { studentId: STUDENT_ID, itemId: item.id } },
        update: { completed: true, completedAt: now, verificationStatus: "verified", verifiedBy: TEACHER_ID, verifiedAt: now },
        create: { studentId: STUDENT_ID, itemId: item.id, completed: true, completedAt: now, verificationStatus: "verified", verifiedBy: TEACHER_ID, verifiedAt: now },
      });
    }
    return claim.outcome;
  }

  // Mirrors the FormSubmission upsert in src/app/api/forms/sign/route.ts.
  async function recordFormSubmission(form) {
    await prisma.formSubmission.upsert({
      where: { studentId_formId: { studentId: STUDENT_ID, formId: form.id } },
      create: { studentId: STUDENT_ID, formId: form.id, fileId: file.id, signatureFileId: file.id, status: "pending" },
      update: { signatureFileId: file.id, status: "pending", reviewedBy: null, reviewedAt: null, notes: null },
    });
  }

  function awaitingReviewLine(ctx) {
    return (ctx.studentStatusSummary ?? "")
      .split("\n")
      .find((l) => l.startsWith("Submitted forms awaiting instructor review"));
  }

  // The one aggregate line in studentStatusSummary that is delta-assertable
  // regardless of how many real orientation items an environment has.
  // (Label-presence checks on the "still incomplete" list are NOT reliable:
  // formatList truncates it at 4 entries and marker items sort last.)
  function parseChecklistLine(ctx) {
    const m = (ctx.studentStatusSummary ?? "").match(
      /Required orientation checklist steps: (\d+)\/(\d+) complete\./,
    );
    return m ? { completed: Number(m[1]), total: Number(m[2]) } : null;
  }

  try {
    // Baseline sanity: the fixture assembles cleanly before any change.
    const baseline = await assembleContext({ flush: true });
    if (!baseline.ctx) throw new Error("baseline assembly returned no chatPromptContext");
    if (baseline.snapshot === null) throw new Error("baseline situational snapshot returned null");
    console.log(
      `Baseline assembled: orientation ${baseline.bundle.orientation.progress.completed}/${baseline.bundle.orientation.progress.total}, ` +
        `${baseline.bundle.goals.active.length} active goals, snapshot ${baseline.snapshot.length} chars`,
    );

    // =====================================================================
    // GROUP A — cold-context visibility (must PASS today)
    // =====================================================================
    console.log("\nGROUP A — cold-context visibility (change → flush → assemble → assert)");

    // A1. Goal proposed by Sage (lib helper: proposeGoal).
    {
      const marker = mk("goal-proposed");
      const res = await proposeGoal({
        studentId: STUDENT_ID,
        level: "weekly",
        content: `${marker} practice interview questions twice`,
        sourceMessageId: `${ID_PREFIX}msg-1-${RUN_ID}`,
        invokedBy: STUDENT_ID,
      });
      if (res.status !== "created") throw new Error(`proposeGoal: ${JSON.stringify(res)}`);
      const { bundle } = await assembleContext({ flush: true });
      const hit = bundle.goals.proposedAwaitingConfirmation.find((g) => g.content.includes(marker));
      reportA("goal-proposed-by-sage → bundle.goals.proposedAwaitingConfirmation", Boolean(hit), hit ? `"${snippet(hit.content, marker, 0)}"` : "marker absent");
      results.proposedGoalId = res.goalId;
    }

    // A2. Goal created active by the student (mirrors POST /api/goals).
    {
      const marker = mk("goal-active");
      const goal = await prisma.goal.create({
        data: { studentId: STUDENT_ID, level: "daily", content: `${marker} review one resume bullet`, status: "active" },
      });
      results.activeGoalId = goal.id;
      const { bundle, ctx } = await assembleContext({ flush: true });
      const inSummary = ctx.goalsSummary.includes(marker);
      const inActive = bundle.goals.active.some((g) => g.content.includes(marker));
      reportA(
        "goal-created-active → chatPromptContext.goalsSummary + bundle.goals.active",
        inSummary && inActive,
        `goalsSummary=${inSummary}, activeBucket=${inActive}; "${snippet(ctx.goalsSummary, marker)}"`,
      );
    }

    // A3. Goal confirmed by teacher (mirrors PATCH /api/teacher/students/[id]/goals/[goalId]).
    {
      const marker = mk("goal-proposed");
      await prisma.goal.update({
        where: { id: results.proposedGoalId },
        data: { status: "confirmed", confirmedAt: new Date(), confirmedBy: TEACHER_ID },
      });
      const { ctx } = await assembleContext({ flush: true });
      const pass = ctx.goalsSummary.includes(marker); // proposed goals are NOT in goalsSummary; confirmed ones are
      reportA("goal-confirmed-by-teacher → chatPromptContext.goalsSummary", pass, `"${snippet(ctx.goalsSummary, marker)}"`);
    }

    // A4. Goal status updated by teacher (active → abandoned; same route mirror).
    {
      const marker = mk("goal-active");
      await prisma.goal.update({ where: { id: results.activeGoalId }, data: { status: "abandoned" } });
      const { bundle, ctx } = await assembleContext({ flush: true });
      const goneFromSummary = !ctx.goalsSummary.includes(marker);
      const goneFromActive = !bundle.goals.active.some((g) => g.content.includes(marker));
      reportA(
        "goal-status-updated-by-teacher (abandoned) → removed from goalsSummary + active bucket",
        goneFromSummary && goneFromActive,
        `goneFromSummary=${goneFromSummary}, goneFromActive=${goneFromActive}`,
      );
    }

    // A5. Orientation item completed (student claim via applyStudentOrientationCompletion
    //     + instructor confirm as completeAsStaff writes it).
    {
      const outcome = await completeOrientationItem(itemA);
      const { bundle, ctx } = await assembleContext({ flush: true });
      // incompleteRequired is a structured (untruncated) label array — safe
      // for presence checks on any environment; the summary text is asserted
      // as a delta on its counting line, never on label presence.
      const labelGone = !bundle.orientation.incompleteRequired.includes(itemA.label);
      const counted = bundle.orientation.progress.completed === baseline.bundle.orientation.progress.completed + 1;
      const checklistNow = parseChecklistLine(ctx);
      const checklistBase = parseChecklistLine(baseline.ctx);
      const summaryDelta = Boolean(
        checklistNow && checklistBase && checklistNow.completed === checklistBase.completed + 1,
      );
      reportA(
        "orientation-item-completed → bundle.orientation + studentStatusSummary checklist delta",
        labelGone && counted && summaryDelta,
        `claim=${outcome}, incompleteRequired cleared=${labelGone}, completed ${bundle.orientation.progress.completed}/${bundle.orientation.progress.total} (baseline +1=${counted}), checklist line ${checklistBase?.completed}/${checklistBase?.total} → ${checklistNow?.completed}/${checklistNow?.total}`,
      );
    }

    // A6. Certification completed + verified. Uses the marker-certType
    //     templates seeded above (never the environment's ready-to-work
    //     shape). The cert auto-create mirrors ensureStudentCertification's
    //     create (cert-actions.ts) parameterized by certType — that helper
    //     hardcodes "ready-to-work", so it can't be called directly. Every
    //     requirement is then completed + verified + file-attached exactly
    //     as the teacher requirement-level verify writes it, and the status
    //     flip runs through the real lib helper recomputeCertificationStatus.
    {
      const templates = await prisma.certTemplate.findMany({
        where: { certType: CERT_TYPE_MARKER },
        orderBy: { sortOrder: "asc" },
      });
      const cert = await prisma.certification.create({
        data: {
          studentId: STUDENT_ID,
          certType: CERT_TYPE_MARKER,
          requirements: { create: templates.map((t) => ({ templateId: t.id })) },
        },
      });
      const now = new Date();
      await prisma.certRequirement.updateMany({
        where: { certificationId: cert.id },
        data: { completed: true, completedAt: now, verifiedBy: TEACHER_ID, verifiedAt: now, fileId: file.id },
      });
      const updated = await recomputeCertificationStatus(cert.id, CERT_TYPE_MARKER);
      const { bundle, snapshot } = await assembleContext({ flush: true });
      const statusDone = bundle.certifications.some((c) => c.certType === CERT_TYPE_MARKER && c.status === "completed");
      // "Certifications earned" counts status="completed" certs for THIS
      // student only — the fixture student has exactly one, on any DB.
      const inSnapshot = typeof snapshot === "string" && snapshot.includes("Certifications earned: 1");
      reportA(
        "certification-completed → bundle.certifications.status + snapshot certs line",
        statusDone && inSnapshot,
        `recompute=${updated.status}, bundle status completed=${statusDone}, snapshot line=${inSnapshot}`,
      );
    }

    // A7. CareerDiscovery completed (mirrors the upsert in src/lib/chat/post-response.ts).
    {
      const marker = mk("discovery");
      await prisma.careerDiscovery.upsert({
        where: { studentId: STUDENT_ID },
        create: {
          studentId: STUDENT_ID,
          status: "complete",
          sageSummary: `${marker} hands-on learner drawn to healthcare support roles`,
          topClusters: ["Health Science"],
          completedAt: new Date(),
        },
        update: {
          status: "complete",
          sageSummary: `${marker} hands-on learner drawn to healthcare support roles`,
          topClusters: ["Health Science"],
          completedAt: new Date(),
        },
      });
      const { ctx } = await assembleContext({ flush: true });
      const pass = Boolean(ctx.discoverySummary && ctx.discoverySummary.includes(marker));
      reportA("career-discovery-updated → chatPromptContext.discoverySummary", pass, `"${snippet(ctx.discoverySummary ?? "(undefined)", marker)}"`);
    }

    // A8. Form submission recorded (mirrors the upsert in /api/forms/sign).
    {
      await recordFormSubmission(formX);
      const { bundle, ctx } = await assembleContext({ flush: true });
      const leftMissing = !bundle.orientation.missingForms.includes(formX.id);
      const line = awaitingReviewLine(ctx);
      const inReviewLine = Boolean(line && line.includes(formX.title));
      reportA(
        "form-submission-recorded → orientation.missingForms + studentStatusSummary review line",
        leftMissing && inReviewLine,
        `left missingForms=${leftMissing}; "${line ?? "(no review line)"}"`,
      );
    }

    // A9. Sage insight recorded (lib helper: recordInsight — the store path the
    //     context assembly actually surfaces; SageMemory is a separate retrieval
    //     path, see header).
    {
      const marker = mk("insight");
      const res = await recordInsight({
        studentId: STUDENT_ID,
        category: "context",
        content: `${marker} prefers evening study sessions`,
        invokedBy: STUDENT_ID,
      });
      if (res.status !== "created") throw new Error(`recordInsight: ${JSON.stringify(res)}`);
      const { bundle } = await assembleContext({ flush: true });
      const hit = bundle.insights.find((i) => i.content.includes(marker));
      reportA("sage-insight-recorded → bundle.insights", Boolean(hit), hit ? `"${snippet(hit.content, marker, 0)}"` : "marker absent");
    }

    // A10. Appointment scheduled (mirrors the create in /api/appointments/book).
    {
      const marker = mk("appt-later");
      const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      await prisma.appointment.create({
        data: {
          studentId: STUDENT_ID,
          advisorId: TEACHER_ID,
          title: `${marker} advising check-in`,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
          status: "scheduled",
          locationType: "virtual",
          bookingSource: "student",
        },
      });
      const { snapshot } = await assembleContext({ flush: true });
      const pass = typeof snapshot === "string" && snapshot.includes(marker);
      reportA("appointment-scheduled → snapshot next-appointment line", pass, pass ? `"${snippet(snapshot, marker)}"` : "marker absent from snapshot");
    }

    // A11. XP event awarded (lib helper: awardEvent — same call the routes make).
    {
      await awardEvent({
        studentId: STUDENT_ID,
        eventType: "chat_session",
        sourceType: "conversation",
        sourceId: CONVERSATION_ID,
        xp: 10,
      });
      const { bundle } = await assembleContext({ flush: true });
      const hit = bundle.recentEvents.find((e) => e.eventType === "chat_session");
      reportA("xp-event-awarded → bundle.recentEvents", Boolean(hit), hit ? `eventType=${hit.eventType} xp=${hit.xp}` : "event absent");
    }

    // =====================================================================
    // GROUP B — post-cache staleness (red baseline; Phase 3 turns these green)
    // =====================================================================
    console.log("\nGROUP B — post-cache staleness (warm → change → assemble WITHOUT flush → assert)");

    // assert(view, warm) receives the pre-change warm assembly so cases can
    // assert environment-independent DELTAS against it instead of absolute
    // aggregate shapes. The warm sanity call passes warm as both args: a
    // correct delta/marker assertion must be false against its own baseline.
    async function runGroupB(id, ttl, change, assert) {
      invalidatePrefix("chat:");
      const warm = await assembleContext({ flush: false }); // warms the cache
      if (assert(warm, warm).pass) {
        results.B.push({ id, verdict: "INVALID", evidence: "assertion passes before the change — case bug" });
        console.log(`  [B] INVALID ${id} — assertion passes before the change`);
        return;
      }
      await change();
      const stale = await assembleContext({ flush: false });
      const staleCheck = assert(stale, warm);
      const fresh = await assembleContext({ flush: true });
      const freshCheck = assert(fresh, warm);

      if (!freshCheck.pass) {
        results.B.push({ id, verdict: "WRITE-PLANE FAIL", evidence: `change invisible even after flush — ${freshCheck.evidence}` });
        console.log(`  [B] WRITE-PLANE FAIL ${id} — change invisible even after flush`);
      } else if (staleCheck.pass) {
        results.B.push({ id, verdict: "FRESH", evidence: staleCheck.evidence });
        console.log(`  [B] FRESH ${id} — visible without a flush (write-through invalidation working)`);
      } else {
        results.B.push({ id, verdict: "STALE", ttl, evidence: `stale until TTL expiry (${ttl}s); flushed assembly shows it — ${freshCheck.evidence}` });
        console.log(`  [B] STALE ${id} — invisible without a flush; visible with one (staleness window ${ttl}s)`);
      }
    }

    // B1. New active goal → goalsSummary (chat:base-context, 300s).
    {
      const marker = mk("b1-goal");
      await runGroupB(
        "goal-created → chatPromptContext.goalsSummary",
        BASE_CONTEXT_TTL_SECONDS,
        () => prisma.goal.create({ data: { studentId: STUDENT_ID, level: "monthly", content: `${marker} finish two Khan Academy math units`, status: "active" } }),
        ({ ctx }) => ({ pass: ctx.goalsSummary.includes(marker), evidence: `"${snippet(ctx.goalsSummary, marker)}"` }),
      );
    }

    // B2. Orientation item completed → studentStatusSummary checklist counts
    //     (chat:base-context, 300s). Asserted as a +1 delta on the cached
    //     "X/Y complete" line vs the warm assembly — label presence in the
    //     "still incomplete" list is formatList-truncated on populated DBs.
    await runGroupB(
      "orientation-item-completed → chatPromptContext.studentStatusSummary checklist delta",
      BASE_CONTEXT_TTL_SECONDS,
      () => completeOrientationItem(itemB),
      ({ ctx }, warm) => {
        const now = parseChecklistLine(ctx);
        const base = parseChecklistLine(warm.ctx);
        return {
          pass: Boolean(now && base && now.completed === base.completed + 1),
          evidence: `checklist line ${base ? `${base.completed}/${base.total}` : "(unparsed)"} → ${now ? `${now.completed}/${now.total}` : "(unparsed)"}`,
        };
      },
    );

    // B3. CareerDiscovery summary updated → discoverySummary (chat:base-context, 300s).
    {
      const marker = mk("b3-discovery");
      await runGroupB(
        "career-discovery-updated → chatPromptContext.discoverySummary",
        BASE_CONTEXT_TTL_SECONDS,
        () => prisma.careerDiscovery.update({ where: { studentId: STUDENT_ID }, data: { sageSummary: `${marker} growing interest in patient-care technology` } }),
        ({ ctx }) => ({ pass: Boolean(ctx.discoverySummary && ctx.discoverySummary.includes(marker)), evidence: `"${snippet(ctx.discoverySummary ?? "(undefined)", marker)}"` }),
      );
    }

    // B4. Second required form submitted → studentStatusSummary review line (300s).
    await runGroupB(
      "form-submission-recorded → chatPromptContext.studentStatusSummary review line",
      BASE_CONTEXT_TTL_SECONDS,
      () => recordFormSubmission(formY),
      ({ ctx }) => {
        const line = awaitingReviewLine(ctx);
        return { pass: Boolean(line && line.includes(formY.title)), evidence: `"${line ?? "(no review line)"}"` };
      },
    );

    // B5. Earlier appointment scheduled → snapshot next-appointment (chat:snapshot, 180s).
    {
      const marker = mk("b5-appt");
      const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // earlier than A10's +48h
      await runGroupB(
        "appointment-scheduled → snapshot next-appointment line",
        SNAPSHOT_TTL_SECONDS,
        () =>
          prisma.appointment.create({
            data: {
              studentId: STUDENT_ID,
              advisorId: TEACHER_ID,
              title: `${marker} resume review`,
              startsAt,
              endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
              status: "scheduled",
              locationType: "virtual",
              bookingSource: "student",
            },
          }),
        ({ snapshot }) => ({ pass: typeof snapshot === "string" && snapshot.includes(marker), evidence: typeof snapshot === "string" ? `"${snippet(snapshot, marker)}"` : "snapshot null" }),
      );
    }

    // B6. New BHAG goal → snapshot active-goals line (chat:snapshot, 180s).
    {
      const marker = mk("b6-bhag");
      await runGroupB(
        "goal-created (bhag) → snapshot active-goals line",
        SNAPSHOT_TTL_SECONDS,
        () => prisma.goal.create({ data: { studentId: STUDENT_ID, level: "bhag", content: `${marker} pharmacy tech cert`, status: "active" } }),
        ({ snapshot }) => ({ pass: typeof snapshot === "string" && snapshot.includes(marker), evidence: typeof snapshot === "string" ? `"${snippet(snapshot, marker)}"` : "snapshot null" }),
      );
    }

    // =====================================================================
    // Summary + exit semantics
    // =====================================================================
    const aFailures = results.A.filter((r) => !r.pass);
    const bStale = results.B.filter((r) => r.verdict === "STALE");
    const bFresh = results.B.filter((r) => r.verdict === "FRESH");
    const bBroken = results.B.filter((r) => r.verdict === "WRITE-PLANE FAIL" || r.verdict === "INVALID");

    console.log("\n=== Sage Freshness Eval ===");
    console.log(`Group A (cold-context visibility, gating): ${results.A.length - aFailures.length}/${results.A.length} PASS`);
    for (const f of aFailures) console.log(`  FAIL: ${f.id} — ${f.evidence}`);
    console.log(
      `Group B (post-cache staleness, ${STRICT ? "gating (--strict)" : "reporting"}): ` +
        `${bStale.length} STALE, ${bFresh.length} FRESH, ${bBroken.length} broken of ${results.B.length}`,
    );
    for (const r of results.B) console.log(`  ${r.verdict}: ${r.id}${r.ttl ? ` (window ${r.ttl}s)` : ""}`);
    if (bStale.length > 0) {
      console.log(
        `Staleness window today: a native change stays invisible to Sage for up to ` +
          `${BASE_CONTEXT_TTL_SECONDS}s (chat:base-context) / ${SNAPSHOT_TTL_SECONDS}s (chat:snapshot) ` +
          `because no write invalidates chat:* keys. Phase 3 write-through invalidation turns these green.`,
      );
    }

    if (aFailures.length > 0) process.exitCode = 1;
    if (bBroken.length > 0) process.exitCode = 1;
    if (STRICT && bStale.length > 0) process.exitCode = 1;
  } finally {
    if (!KEEP) {
      await cleanup("eval rows cleaned up — use --keep to retain");
      // Zero-proof: every table the run touched, filtered by the markers.
      const counts = {
        student: await prisma.student.count({ where: { id: { startsWith: ID_PREFIX } } }),
        orientationItem: await prisma.orientationItem.count({ where: { label: { startsWith: MARKER_PREFIX } } }),
        certTemplate: await prisma.certTemplate.count({ where: { label: { startsWith: MARKER_PREFIX } } }),
        auditLog: await prisma.auditLog.count({ where: { actorId: { startsWith: ID_PREFIX } } }),
        goal: await prisma.goal.count({ where: { studentId: STUDENT_ID } }),
        orientationProgress: await prisma.orientationProgress.count({ where: { studentId: STUDENT_ID } }),
        formSubmission: await prisma.formSubmission.count({ where: { studentId: STUDENT_ID } }),
        fileUpload: await prisma.fileUpload.count({ where: { studentId: STUDENT_ID } }),
        certification: await prisma.certification.count({ where: { studentId: STUDENT_ID } }),
        certRequirement: await prisma.certRequirement.count({ where: { certification: { studentId: STUDENT_ID } } }),
        sageInsight: await prisma.sageInsight.count({ where: { studentId: STUDENT_ID } }),
        appointment: await prisma.appointment.count({ where: { OR: [{ studentId: STUDENT_ID }, { advisorId: TEACHER_ID }] } }),
        careerDiscovery: await prisma.careerDiscovery.count({ where: { studentId: STUDENT_ID } }),
        progression: await prisma.progression.count({ where: { studentId: STUDENT_ID } }),
        progressionEvent: await prisma.progressionEvent.count({ where: { studentId: STUDENT_ID } }),
        studentAlert: await prisma.studentAlert.count({ where: { studentId: STUDENT_ID } }),
      };
      const leftovers = Object.entries(counts).filter(([, n]) => n > 0);
      console.log(`Cleanup proof: ${Object.entries(counts).map(([k, n]) => `${k}=${n}`).join(" ")}`);
      if (leftovers.length > 0) {
        console.error(`CLEANUP FAILED — leftover rows: ${leftovers.map(([k, n]) => `${k}=${n}`).join(", ")}`);
        process.exitCode = 1;
      } else {
        console.log("Cleanup proof: zero marker rows remain.");
      }
    } else {
      console.log("(--keep: rows retained; rerun without --keep to sweep them)");
    }
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
