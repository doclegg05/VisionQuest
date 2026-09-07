import archiver from "archiver";
import path from "path";
import { Writable } from "stream";
import { prisma } from "./db";
import { downloadFile, uploadFile } from "./storage";
import { FORMS } from "./spokes/forms";
import { logger } from "./logger";
import { safeUploadName } from "./upload-name";
import { studentLogKey } from "@/lib/log-keys";

const FORM_BY_ID = new Map(FORMS.map((f) => [f.id, f]));

/** Characters an archive entry name may keep: letters, digits, and the
 * punctuation an ordinary filename actually uses. `\p{L}`/`\p{N}` rather than
 * `\w` so a Spanish or Japanese filename stays readable — the student is the
 * one receiving this bundle. */
const UNSAFE_ENTRY_CHARS = /[^\p{L}\p{N}_. \-()\[\]]/gu;

const MAX_ENTRY_NAME_LENGTH = 120;

/**
 * Ticket D5 (AC5) — the archive is built entirely in memory: every section
 * appended above accumulates in `chunks` and is `Buffer.concat`-ed into one
 * ZIP buffer before `uploadFile` ever sees it (below). None of the three
 * callers (the offboard route, the teacher archive route, or the
 * fire-and-forget status-change trigger) stream the result, and none of them
 * change here — this ticket only adds content to sections they already
 * treat as an opaque `{ storageKey, fileCount }`.
 *
 * Adding the full Sage transcript (potentially years of daily conversations)
 * is exactly the kind of section that can make one student's archive large
 * enough to matter. 25 MB is not a hard limit — it would take a genuinely
 * exceptional history to reach it, well past a typical multi-month
 * transcript — so this logs a warning rather than throwing: an operator
 * finds out an archive got unusually large, without a bigger transcript ever
 * turning "the export failed" into new instructions the retention policy
 * doesn't already give ("if the export fails, the student is left
 * untouched," docs/DATA_RETENTION_POLICY.md).
 */
const ARCHIVE_SIZE_WARNING_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Ticket D5b — the 25 MB warning above measures a buffer already resident;
 * this is the fix upstream of it. Six relations had no `take:` at all
 * (`conversations.messages`, `notifications`, `alerts`, `moodEntries`,
 * `failedExtractions`, and `connections[].events` — the last two are the
 * append-only "grows on every status change / every SMS nudge" shape a
 * `ConnectionEvent` list has, same as the platform's other event ledgers), so
 * a student with a long-enough history — or years of nudge/status events on
 * one connection — could make `generateStudentArchive` load an unboundedly
 * large row set into memory before archiver ever sees a byte, in a route
 * that calls it fire-and-forget (`teacher/students/[id]/status/route.ts`).
 *
 * `MESSAGE_CAP` is larger than `EVENT_LIST_CAP` because one Sage conversation
 * genuinely can run for years without being a bug — a chat message is the
 * unit this whole product is built around. The other five relations are much
 * shorter-lived per-row, appended by automated systems (nudges, alerts,
 * extraction retries) rather than the student's own typing, so the smaller
 * cap is a truer "this is unusual" line for them.
 */
const MESSAGE_CAP = 20_000;
const EVENT_LIST_CAP = 5_000;

/**
 * Keep the newest `cap` of `rows` and return them in this file's oldest-first
 * export convention.
 *
 * Sorts explicitly rather than trusting the caller's order: the real Prisma
 * query below asks for `take: cap + 1` ordered newest-first (so Postgres
 * never returns more than one row past the cap — the actual memory bound),
 * but this function does not assume that ordering survived intact, because
 * this file's own tests hand it fixtures in whatever order is convenient to
 * write. Correctness comes from `getTime`, not from array position.
 *
 * `rows.length` past `cap` is exactly how a truncation is detected — a
 * relation with precisely `cap` rows and a relation with `cap + 1` must not
 * look the same, which is also why the query below asks for one row more
 * than the cap rather than exactly the cap.
 *
 * Tolerates a missing `rows` (treated as empty) rather than requiring every
 * caller to guard it first — Prisma's own select always returns an array for
 * a list relation, but this file's own narrower test fixtures (predating
 * this ticket) omit fields they do not exercise.
 */
function capNewestFirst<T>(
  rows: readonly T[] | null | undefined,
  cap: number,
  getTime: (row: T) => number,
): { rows: T[]; truncated: boolean } {
  const input = rows ?? [];
  const truncated = input.length > cap;
  const kept = truncated ? [...input].sort((a, b) => getTime(b) - getTime(a)).slice(0, cap) : input;
  return { rows: [...kept].sort((a, b) => getTime(a) - getTime(b)), truncated };
}

/**
 * Names Windows reserves for devices, matched on the STEM and case-insensitively.
 *
 * Windows refuses to create a file called `CON`, and refuses it just as
 * firmly when it carries an extension — `CON.pdf`, `com1.txt` and
 * `AUX.tar.gz` are all the same reservation. A student who names an upload
 * that way, deliberately or otherwise, produces a retention archive that
 * fails partway through extraction on a staff machine, which is where these
 * bundles are actually opened. Everything else in `safeEntryName` keeps the
 * entry from escaping the extraction directory; this keeps the archive
 * extractable at all.
 *
 * Anchored on the whole stem on purpose: `console.log.txt`, `contract.pdf`
 * and `COM10.txt` are ordinary names and must not be renamed.
 */
const WINDOWS_RESERVED_STEM = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * The authoritative sanitizer for a ZIP entry name.
 *
 * `FileUpload.filename` is student-controlled (it is `File.name`, which undici
 * preserves verbatim through `req.formData()`), and `archiver` does not
 * normalize entry names — so without this the central directory of a retention
 * archive literally contains `files/../../../../home/staff/.bashrc`. Staff and
 * admins download and unzip these bundles, which makes it a zip-slip write on
 * any extractor that does not normalize; and on one that DOES normalize, a
 * student could still plant `files/../forms/DoHS Release.pdf` beside or over a
 * real signed form inside their own archive.
 *
 * This runs at the archive boundary rather than only at upload time because
 * the database already holds rows written before upload-time sanitizing
 * existed, and because the boundary is where the string stops being a name and
 * starts being a path.
 */
export function safeEntryName(rawName: string | null | undefined): string {
  // First the shared upload-time pass: separators, control characters,
  // leading dots, and the length cap (tighter here than at upload).
  const base = safeUploadName(rawName, MAX_ENTRY_NAME_LENGTH);

  const name = base
    .replace(UNSAFE_ENTRY_CHARS, "_")
    // The substitution can expose new leading dots, so strip them again.
    .replace(/^\.+/, "")
    .trim()
    .slice(0, MAX_ENTRY_NAME_LENGTH);

  if (!name) return "file";

  // Windows reserves the stem, so the check runs on everything before the
  // FIRST dot: `AUX.tar.gz` is as reserved as `AUX`. The `_` prefix keeps the
  // name recognizable to the student who uploaded it — renaming it to
  // something generic would lose the one thing the entry name is for. A
  // reserved stem is at most four characters, so the prefix cannot push the
  // name past the cap applied above.
  if (WINDOWS_RESERVED_STEM.test(name.split(".")[0])) return `_${name}`;

  return name;
}

interface ArchiveManifestEntry {
  path: string;
  type: string;
  formId?: string;
  formTitle?: string;
  status?: string;
  signedAt?: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

/**
 * One capped relation that actually hit its cap. `kept` and `cap` are always
 * equal today (a truncated relation is always sliced down to exactly its
 * cap) — both are recorded anyway so the manifest is self-describing without
 * a reader needing to know this file's constants.
 */
interface ArchiveTruncationEntry {
  model: string;
  kept: number;
  cap: number;
}

interface ArchiveManifest {
  studentId: string;
  displayName: string;
  archivedAt: string;
  archivedBy: string;
  fileCount: number;
  entries: ArchiveManifestEntry[];
  /**
   * Ticket D5b — one entry per capped relation that was actually truncated
   * (deduplicated by model name: a second conversation hitting the same
   * message cap does not add a second entry). Empty for any export under
   * every cap, which today is every student — an export must never claim
   * completeness it cannot back up, and it must never look incomplete when
   * it isn't either.
   */
  truncated: ArchiveTruncationEntry[];
}

/** Record one capped relation as truncated, once per model. */
function recordTruncation(manifest: ArchiveManifest, model: string, kept: number, cap: number): void {
  if (manifest.truncated.some((entry) => entry.model === model)) return;
  manifest.truncated.push({ model, kept, cap });
}

/**
 * Generate a ZIP archive of all student files (forms, signatures, cert evidence,
 * portfolio items, resume) and upload it to storage.
 *
 * Returns the storage key of the ZIP archive.
 */
export async function generateStudentArchive(
  studentId: string,
  archivedByTeacherId: string,
): Promise<{ storageKey: string; fileCount: number }> {
  // Fetch student data with all file references
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      studentId: true,
      displayName: true,
      formSubmissions: {
        select: {
          formId: true,
          fileId: true,
          signatureFileId: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          reviewedBy: true,
        },
      },
      files: {
        select: {
          id: true,
          filename: true,
          storageKey: true,
          category: true,
          mimeType: true,
          uploadedAt: true,
        },
      },
      certifications: {
        include: {
          requirements: {
            select: {
              templateId: true,
              fileId: true,
              completed: true,
              verifiedBy: true,
              verifiedAt: true,
            },
          },
        },
      },
      portfolioItems: {
        select: {
          id: true,
          title: true,
          type: true,
          fileId: true,
        },
      },
      resumeData: {
        select: { data: true },
      },
      // Match & Connect Phase 2: the work profile is student-owned PII (home
      // ZIP, transport, pay floor, childcare hours) with its own retention
      // row, so export-before-deactivate has to carry it. Leaving it out
      // would delete a class of data the student never got a copy of.
      workProfile: {
        select: {
          availability: true,
          transport: true,
          homeZip: true,
          county: true,
          maxCommuteMinutes: true,
          payFloorHourly: true,
          childcareHours: true,
          earliestStart: true,
          shiftLimits: true,
          createdAt: true,
          updatedAt: true,
          updatedVia: true,
        },
      },
      // Match & Connect Phase 4: the disclosure record. Every Connection is a
      // moment this program sent this student's information to an employer
      // outside it, and the archive is the one copy they take with them, so
      // leaving it out would mean the student can never afterwards answer
      // "who did SPOKES tell about me, and what did they say".
      //
      // The employer's CONTACT is named but never their email or phone: that
      // is a third party's PII, it is not the student's to be handed, and the
      // employer-facing page never showed it to them either.
      connections: {
        orderBy: { createdAt: "asc" },
        select: {
          status: true,
          statusChangedAt: true,
          proposedVia: true,
          packet: true,
          sentAt: true,
          employerViewedAt: true,
          employerRespondedAt: true,
          employerResponse: true,
          responseReason: true,
          hiredAt: true,
          startDate: true,
          hourlyWage: true,
          closedReason: true,
          createdAt: true,
          employer: { select: { name: true } },
          jobLead: { select: { title: true } },
          // Ticket D5b — capped per connection (same nested-`take`-is-per-
          // parent behavior as conversations.messages above). A connection's
          // event ledger grows on every status change and every SMS nudge
          // attempt, so a long-lived placement is the realistic way this
          // list gets large.
          events: {
            orderBy: { at: "desc" },
            take: EVENT_LIST_CAP + 1,
            select: {
              fromStatus: true,
              toStatus: true,
              actorType: true,
              note: true,
              at: true,
            },
          },
        },
      },
      // Ticket D5 — the offboarding export was missing 30 of the 42
      // student-linked models, Message (the Sage transcript) foremost among
      // them. Everything below is the student's own words, choices, or what
      // they were told; see docs/DATA_RETENTION_POLICY.md and
      // config/benchmarks/fixtures/archive-exemptions.json for what stayed
      // out and why.

      // Sage transcripts — the single biggest gap. Ordered oldest-first so
      // the export reads like the conversation happened, both at the
      // conversation level and within each conversation's messages.
      conversations: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          module: true,
          stage: true,
          title: true,
          summary: true,
          active: true,
          createdAt: true,
          updatedAt: true,
          // Ticket D5b — one conversation's history is capped independently
          // of every other conversation's (Prisma's nested `take` applies
          // per parent row), newest-first with one row past MESSAGE_CAP so
          // the code below can tell "hit the cap" apart from "had exactly
          // MESSAGE_CAP messages and no more" — see capNewestFirst.
          messages: {
            orderBy: { createdAt: "desc" },
            take: MESSAGE_CAP + 1,
            select: { role: true, content: true, createdAt: true },
          },
        },
      },
      // Sage's own observations about the student and its daily/weekly
      // panels — content Sage generated FROM the student's own words, kept
      // alongside the transcript that produced it.
      sageInsights: {
        orderBy: { createdAt: "asc" },
        select: {
          category: true,
          content: true,
          confidence: true,
          status: true,
          createdAt: true,
        },
      },
      sagePanels: {
        orderBy: { panelDate: "asc" },
        select: {
          panelDate: true,
          spec: true,
          status: true,
          createdAt: true,
        },
      },
      // Goals the student set (with the resources staff or Sage attached to
      // each one). GoalResourceLink is fetched at top level under its own
      // Student relation name (`goalResourceLinks`) and merged into its goal
      // below, rather than nested under Goal.resourceLinks — same data,
      // named the way the ownership relation actually is.
      goals: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          level: true,
          parentId: true,
          content: true,
          status: true,
          confirmedAt: true,
          lastReviewedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      goalResourceLinks: {
        orderBy: { createdAt: "asc" },
        select: {
          goalId: true,
          resourceType: true,
          title: true,
          description: true,
          url: true,
          linkType: true,
          status: true,
          dueAt: true,
          createdAt: true,
        },
      },
      // Career exploration — RIASEC/cluster results, the multi-week campaign
      // and coaching-arc trackers, all student-specific narrative or choice
      // data.
      careerDiscovery: {
        select: {
          status: true,
          interests: true,
          strengths: true,
          subjects: true,
          problems: true,
          values: true,
          circumstances: true,
          topClusters: true,
          sageSummary: true,
          riasecScores: true,
          hollandCode: true,
          nationalClusters: true,
          transferableSkills: true,
          workValues: true,
          assessmentSummary: true,
          profileSource: true,
          assessedAt: true,
          assessmentPayload: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      careerCampaigns: {
        orderBy: { createdAt: "asc" },
        select: {
          status: true,
          targetClusters: true,
          currentStage: true,
          weeklyApplicationTarget: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      coachingArcs: {
        orderBy: { createdAt: "asc" },
        select: {
          arcType: true,
          weekNumber: true,
          milestones: true,
          status: true,
          startedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      // Vision board and mood — student-chosen imagery/text and
      // Sage-extracted mood context.
      visionBoardItems: {
        orderBy: { createdAt: "asc" },
        select: {
          type: true,
          content: true,
          fileId: true,
          goalId: true,
          createdAt: true,
        },
      },
      // Ticket D5b — capped, newest-first, one row past EVENT_LIST_CAP so
      // capNewestFirst can tell a truncation apart from an exact fit.
      moodEntries: {
        orderBy: { extractedAt: "desc" },
        take: EVENT_LIST_CAP + 1,
        select: {
          score: true,
          context: true,
          source: true,
          conversationId: true,
          extractedAt: true,
        },
      },
      // Every resume/cover-letter draft the student produced, not only the
      // Portfolio's current one (already covered by resumeData above).
      resumeVersions: {
        orderBy: { createdAt: "asc" },
        select: {
          jobListingId: true,
          jobLeadId: true,
          version: true,
          content: true,
          status: true,
          createdAt: true,
        },
      },
      coverLetters: {
        orderBy: { createdAt: "asc" },
        select: {
          jobListingId: true,
          jobLeadId: true,
          version: true,
          content: true,
          status: true,
          createdAt: true,
        },
      },
      // Job search activity — what the student applied to, saved, and
      // wagered on their own progress.
      applications: {
        orderBy: { createdAt: "asc" },
        select: {
          status: true,
          notes: true,
          appliedAt: true,
          verificationStatus: true,
          verifiedAt: true,
          createdAt: true,
          opportunity: { select: { title: true, company: true } },
        },
      },
      savedJobs: {
        orderBy: { savedAt: "asc" },
        select: {
          status: true,
          notes: true,
          savedAt: true,
          appliedAt: true,
          jobListing: { select: { title: true, company: true } },
        },
      },
      wagers: {
        orderBy: { createdAt: "asc" },
        select: {
          wagerType: true,
          hypothesis: true,
          predictedOutcome: true,
          confidence: true,
          horizonAt: true,
          status: true,
          createdAt: true,
        },
      },
      // Advising — tasks, appointments, event sign-ups, and the checklist of
      // orientation items, none of which is currently exported.
      assignedTasks: {
        orderBy: { createdAt: "asc" },
        select: {
          title: true,
          description: true,
          dueAt: true,
          status: true,
          priority: true,
          completedAt: true,
          createdAt: true,
          createdBy: { select: { displayName: true } },
        },
      },
      appointments: {
        orderBy: { startsAt: "asc" },
        select: {
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          status: true,
          locationType: true,
          locationLabel: true,
          notes: true,
          createdAt: true,
          advisor: { select: { displayName: true } },
        },
      },
      eventRegistrations: {
        orderBy: { registeredAt: "asc" },
        select: {
          status: true,
          registeredAt: true,
          event: { select: { title: true, startsAt: true } },
        },
      },
      orientationProgress: {
        select: {
          completed: true,
          completedAt: true,
          verificationStatus: true,
          verifiedAt: true,
          item: { select: { label: true } },
        },
      },
      // Digital form answers (distinct from the signed-PDF FormSubmission
      // rows already exported above as files).
      formResponses: {
        orderBy: { createdAt: "asc" },
        select: {
          answers: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          createdAt: true,
          template: { select: { title: true } },
        },
      },
      // The student's own consent decisions and their SPOKES/DoHS intake
      // and enrollment record.
      consentRecords: {
        orderBy: { grantedAt: "asc" },
        select: {
          scope: true,
          grantedAt: true,
          revokedAt: true,
          createdAt: true,
        },
      },
      spokesRecord: {
        select: {
          firstName: true,
          lastName: true,
          county: true,
          householdType: true,
          requiredParticipationHours: true,
          referralDate: true,
          status: true,
          enrolledAt: true,
          exitDate: true,
          barriersOnEntry: true,
          barriersRemaining: true,
          educationalLevel: true,
          tabeDate: true,
          postSecondaryProgram: true,
          unsubsidizedEmploymentAt: true,
          employerName: true,
          hourlyWage: true,
          nonCompleterAt: true,
          nonCompleterReason: true,
          notes: true,
          createdAt: true,
        },
      },
      classEnrollments: {
        orderBy: { enrolledAt: "asc" },
        select: {
          status: true,
          enrolledAt: true,
          archivedAt: true,
          archiveReason: true,
          class: { select: { name: true } },
        },
      },
      // The public credential page's own content (not the page's traffic —
      // just what the student put on it) and the notification layer: their
      // own channel preferences, and every notification they were sent.
      publicCredentialPage: {
        select: {
          slug: true,
          headline: true,
          summary: true,
          isPublic: true,
          createdAt: true,
        },
      },
      // smsVerifyCodeHash/smsVerifyExpiresAt are excluded: an unexpired
      // verification code hash is an authentication artifact, the same
      // reasoning PasswordResetToken/SecurityQuestionAnswer are exempted
      // under in the fixture, not something the student wrote or said.
      notificationPreferences: {
        select: {
          channel: true,
          enabled: true,
          destination: true,
          smsConsentAt: true,
          smsRevokedAt: true,
          createdAt: true,
        },
      },
      // Ticket D5b — capped, newest-first, one row past EVENT_LIST_CAP.
      notifications: {
        orderBy: { createdAt: "desc" },
        take: EVENT_LIST_CAP + 1,
        select: {
          type: true,
          title: true,
          body: true,
          createdAt: true,
        },
      },
      // Staff-authored content ABOUT the student. Every CaseNote category
      // (general, check_in, risk, career, celebration — src/lib/advising.ts)
      // is exported verbatim: neither the schema nor
      // docs/DATA_RETENTION_POLICY.md nor .claude/rules/security.md marks any
      // category "staff-confidential" today. CaseNote.visibility currently
      // has exactly one legal value ("teacher", src/lib/advising.ts
      // NOTE_VISIBILITIES) — that describes who the in-app UI shows a note
      // to today, not a confidentiality classification, so it is not read as
      // grounds to redact here. If a category or a visibility value is ever
      // documented as staff-confidential, exclude that category with a
      // comment here and count it as exported-with-redaction rather than
      // folding it into the archive-exemptions fixture (which is for whole
      // MODELS, not categories within one).
      caseNotes: {
        orderBy: { createdAt: "asc" },
        select: {
          category: true,
          body: true,
          createdAt: true,
          author: { select: { displayName: true } },
        },
      },
      // Ticket D5b — capped, newest-first, one row past EVENT_LIST_CAP.
      alerts: {
        orderBy: { detectedAt: "desc" },
        take: EVENT_LIST_CAP + 1,
        select: {
          type: true,
          severity: true,
          status: true,
          title: true,
          summary: true,
          detectedAt: true,
          resolvedAt: true,
        },
      },
      // Dead-letter copies of failed Sage extractions. `payload` is a capped
      // snapshot of the student's own message the extractor was working
      // from — a transcript excerpt, not a new class of data — so this leans
      // include per the ticket's guidance rather than joining the fixture's
      // exemptions.
      // Ticket D5b — capped, newest-first, one row past EVENT_LIST_CAP.
      failedExtractions: {
        orderBy: { createdAt: "desc" },
        take: EVENT_LIST_CAP + 1,
        select: {
          extractorKey: true,
          payload: true,
          error: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });

  if (!student) throw new Error("Student not found");

  // Build a map of all FileUpload records for this student
  const fileMap = new Map(student.files.map((f) => [f.id, f]));

  // Collect all files to archive
  const manifest: ArchiveManifest = {
    studentId: student.studentId,
    displayName: student.displayName,
    archivedAt: new Date().toISOString(),
    archivedBy: archivedByTeacherId,
    fileCount: 0,
    entries: [],
    truncated: [],
  };

  // Ticket D5b — resolve every capped relation's actual export list, once,
  // before any section below reads it. Each cap was already enforced at the
  // query above (`take: cap + 1`); this is what decides whether the cap was
  // actually hit and produces the manifest entry when it was.
  const cappedNotifications = capNewestFirst(
    student.notifications,
    EVENT_LIST_CAP,
    (row) => row.createdAt.getTime(),
  );
  if (cappedNotifications.truncated) {
    recordTruncation(manifest, "Notification", EVENT_LIST_CAP, EVENT_LIST_CAP);
  }

  const cappedAlerts = capNewestFirst(student.alerts, EVENT_LIST_CAP, (row) => row.detectedAt.getTime());
  if (cappedAlerts.truncated) recordTruncation(manifest, "StudentAlert", EVENT_LIST_CAP, EVENT_LIST_CAP);

  const cappedMoodEntries = capNewestFirst(
    student.moodEntries,
    EVENT_LIST_CAP,
    (row) => row.extractedAt.getTime(),
  );
  if (cappedMoodEntries.truncated) recordTruncation(manifest, "MoodEntry", EVENT_LIST_CAP, EVENT_LIST_CAP);

  const cappedFailedExtractions = capNewestFirst(
    student.failedExtractions,
    EVENT_LIST_CAP,
    (row) => row.createdAt.getTime(),
  );
  if (cappedFailedExtractions.truncated) {
    recordTruncation(manifest, "FailedExtraction", EVENT_LIST_CAP, EVENT_LIST_CAP);
  }

  // Nested caps: one conversation's messages, or one connection's events,
  // truncating does not affect any sibling conversation/connection — but the
  // manifest records the MODEL once, not once per parent that happened to
  // hit it (see recordTruncation).
  const cappedConversations = (student.conversations ?? []).map((conversation) => {
    const capped = capNewestFirst(conversation.messages, MESSAGE_CAP, (row) => row.createdAt.getTime());
    if (capped.truncated) recordTruncation(manifest, "Message", MESSAGE_CAP, MESSAGE_CAP);
    return { ...conversation, messages: capped.rows };
  });

  const cappedConnections = (student.connections ?? []).map((connection) => {
    const capped = capNewestFirst(connection.events, EVENT_LIST_CAP, (row) => row.at.getTime());
    if (capped.truncated) recordTruncation(manifest, "ConnectionEvent", EVENT_LIST_CAP, EVENT_LIST_CAP);
    return { ...connection, events: capped.rows };
  });

  // Create ZIP in memory
  const chunks: Buffer[] = [];
  const bufferStream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(bufferStream);

  // Sanitizing flattens names, so two uploads that differed only by directory
  // ("../report.pdf" and "sub/report.pdf") now collide. Renaming the later one
  // is the honest outcome — dropping it would silently lose a file from the
  // one copy the student takes with them.
  const usedEntryPaths = new Set<string>();

  function reserveEntryPath(folder: string, rawFilename: string | null | undefined): string {
    const safe = safeEntryName(rawFilename);
    const first = `${folder}/${safe}`;
    if (!usedEntryPaths.has(first)) {
      usedEntryPaths.add(first);
      return first;
    }

    const ext = path.posix.extname(safe);
    const stem = safe.slice(0, safe.length - ext.length);
    for (let n = 2; ; n++) {
      const candidate = `${folder}/${stem} (${n})${ext}`;
      if (!usedEntryPaths.has(candidate)) {
        usedEntryPaths.add(candidate);
        return candidate;
      }
    }
  }

  // Helper to add a file to the archive
  async function addFile(
    folder: string,
    fileId: string,
    entry: Omit<ArchiveManifestEntry, "path">,
  ): Promise<boolean> {
    const fileRecord = fileMap.get(fileId);
    if (!fileRecord) return false;

    try {
      const result = await downloadFile(fileRecord.storageKey);
      if (!result) return false;

      const archivePath = reserveEntryPath(folder, fileRecord.filename);
      archive.append(result.buffer, { name: archivePath });
      manifest.entries.push({ ...entry, path: archivePath });
      manifest.fileCount++;
      return true;
    } catch (err) {
      logger.error("Archive: failed to download file", {
        fileId,
        storageKey: fileRecord.storageKey,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * Append one JSON section, but only when there is something to say.
   *
   * An empty array or a null singular relation means "the student has none
   * of this" — writing `[]` or `{}` anyway would look identical to that in
   * the exported bundle and give it no evidentiary meaning, exactly the
   * reasoning the existing work-profile.json/connections.json sections
   * already use above.
   */
  function addJsonSection(name: string, type: string, data: unknown): void {
    const isEmptyArray = Array.isArray(data) && data.length === 0;
    const isAbsent = data === null || data === undefined || isEmptyArray;
    if (isAbsent) return;

    archive.append(JSON.stringify(data, null, 2), { name });
    manifest.entries.push({ path: name, type });
    manifest.fileCount++;
  }

  // 1. Form submissions (completed forms + signatures)
  for (const sub of student.formSubmissions) {
    const formDef = FORM_BY_ID.get(sub.formId);
    const formTitle = formDef?.title || sub.formId;

    await addFile("forms", sub.fileId, {
      type: "form_submission",
      formId: sub.formId,
      formTitle,
      status: sub.status,
      signedAt: sub.createdAt.toISOString(),
      reviewedAt: sub.reviewedAt?.toISOString() || null,
      reviewedBy: sub.reviewedBy,
    });

    if (sub.signatureFileId) {
      await addFile("signatures", sub.signatureFileId, {
        type: "signature",
        formId: sub.formId,
        formTitle: `Signature — ${formTitle}`,
        status: sub.status,
        signedAt: sub.createdAt.toISOString(),
      });
    }
  }

  // 2. Certification evidence files
  for (const cert of student.certifications) {
    for (const req of cert.requirements) {
      if (req.fileId) {
        await addFile("certifications", req.fileId, {
          type: "certification_evidence",
          status: req.completed ? "completed" : "in_progress",
        });
      }
    }
  }

  // 3. Portfolio item files
  for (const item of student.portfolioItems) {
    if (item.fileId) {
      await addFile("portfolio", item.fileId, {
        type: "portfolio_item",
      });
    }
  }

  // 4. General uploads (resume files, etc.)
  for (const file of student.files) {
    if (file.category === "resume" || file.category === "general") {
      try {
        const result = await downloadFile(file.storageKey);
        if (result) {
          // Reserved only once the download succeeded, so a failed download
          // does not burn a name and push the next file to " (2)".
          const archivePath = reserveEntryPath("files", file.filename);
          archive.append(result.buffer, { name: archivePath });
          manifest.entries.push({ path: archivePath, type: file.category });
          manifest.fileCount++;
        }
      } catch {
        // Skip files that fail to download
      }
    }
  }

  // 5. Resume data as JSON
  if (student.resumeData?.data) {
    archive.append(student.resumeData.data, { name: "resume/resume-data.json" });
    manifest.entries.push({ path: "resume/resume-data.json", type: "resume_data" });
    manifest.fileCount++;
  }

  // 6. Work profile as JSON (student-owned availability/transport/pay answers)
  if (student.workProfile) {
    archive.append(JSON.stringify(student.workProfile, null, 2), {
      name: "work-profile.json",
    });
    manifest.entries.push({ path: "work-profile.json", type: "work_profile" });
    manifest.fileCount++;
  }

  // 7. Employer introductions as JSON (the disclosure record)
  if (cappedConnections.length > 0) {
    // The frozen packet's `includedFields` is what the student approved and
    // what the employer page actually rendered, so it is the honest answer to
    // "what was shared". The rest of the packet is not repeated here — the
    // resume and cover letter are already in the archive as their own files.
    const disclosures = cappedConnections.map((connection) => {
      const packet = connection.packet as { includedFields?: unknown } | null;
      const sharedFields = Array.isArray(packet?.includedFields)
        ? packet.includedFields.filter((field): field is string => typeof field === "string")
        : [];
      return {
        employer: connection.employer.name,
        job: connection.jobLead.title,
        status: connection.status,
        statusChangedAt: connection.statusChangedAt,
        proposedVia: connection.proposedVia,
        proposedAt: connection.createdAt,
        sharedFields,
        sentAt: connection.sentAt,
        employerViewedAt: connection.employerViewedAt,
        employerRespondedAt: connection.employerRespondedAt,
        employerResponse: connection.employerResponse,
        responseReason: connection.responseReason,
        hiredAt: connection.hiredAt,
        startDate: connection.startDate,
        hourlyWage: connection.hourlyWage,
        closedReason: connection.closedReason,
        events: connection.events,
      };
    });
    archive.append(JSON.stringify(disclosures, null, 2), { name: "connections.json" });
    manifest.entries.push({ path: "connections.json", type: "employer_introductions" });
    manifest.fileCount++;
  }

  // 8. Sage transcripts — conversations with their messages nested, both
  // ordered oldest-first by the Prisma query above. The single biggest gap
  // this ticket closes.
  addJsonSection("sage/conversations.json", "sage_conversation", cappedConversations);

  // 9. Sage's own observations and daily/weekly panels.
  addJsonSection("sage/insights.json", "sage_insight", student.sageInsights);
  addJsonSection("sage/panels.json", "sage_panel", student.sagePanels);

  // 10. Goals, with each goal's resource links nested under it — same data
  // as GoalResourceLink, grouped by the goal it belongs to rather than left
  // as a second flat list the student would have to cross-reference by hand.
  const studentGoals = student.goals ?? [];
  const studentGoalResourceLinks = student.goalResourceLinks ?? [];
  if (studentGoals.length > 0) {
    const resourceLinksByGoal = new Map<string, typeof studentGoalResourceLinks>();
    for (const link of studentGoalResourceLinks) {
      const existing = resourceLinksByGoal.get(link.goalId);
      if (existing) existing.push(link);
      else resourceLinksByGoal.set(link.goalId, [link]);
    }
    const goalsWithLinks = studentGoals.map((goal) => ({
      ...goal,
      resourceLinks: resourceLinksByGoal.get(goal.id) ?? [],
    }));
    addJsonSection("goals.json", "goal", goalsWithLinks);
  }

  // 11. Career exploration.
  addJsonSection("career/discovery.json", "career_discovery", student.careerDiscovery);
  addJsonSection("career/campaigns.json", "career_campaign", student.careerCampaigns);
  addJsonSection("career/coaching-arcs.json", "coaching_arc", student.coachingArcs);

  // 12. Vision board and mood.
  addJsonSection("vision-board.json", "vision_board_item", student.visionBoardItems);
  addJsonSection("mood-entries.json", "mood_entry", cappedMoodEntries.rows);

  // 13. Every resume/cover-letter draft (distinct from resume/resume-data.json,
  // the Portfolio's current one, exported above).
  addJsonSection("resume/resume-versions.json", "resume_version", student.resumeVersions);
  addJsonSection("cover-letters.json", "cover_letter", student.coverLetters);

  // 14. Job search activity.
  addJsonSection("applications.json", "application", student.applications);
  addJsonSection("saved-jobs.json", "saved_job", student.savedJobs);
  addJsonSection("wagers.json", "wager", student.wagers);

  // 15. Advising — tasks, appointments, event sign-ups, orientation checklist.
  addJsonSection("tasks.json", "student_task", student.assignedTasks);
  addJsonSection("appointments.json", "appointment", student.appointments);
  addJsonSection("event-registrations.json", "event_registration", student.eventRegistrations);
  addJsonSection("orientation-progress.json", "orientation_progress", student.orientationProgress);

  // 16. Digital form answers (distinct from the signed-PDF FormSubmission
  // rows already exported above under forms/).
  addJsonSection("form-responses.json", "form_response", student.formResponses);

  // 17. Consent decisions and the SPOKES/DoHS intake record.
  addJsonSection("consent-records.json", "consent_record", student.consentRecords);
  addJsonSection("spokes-record.json", "spokes_record", student.spokesRecord);
  addJsonSection("class-enrollments.json", "class_enrollment", student.classEnrollments);

  // 18. The public credential page's own content, notification preferences,
  // and every notification the student was sent.
  addJsonSection("credential-page.json", "public_credential_page", student.publicCredentialPage);
  addJsonSection(
    "notification-preferences.json",
    "notification_preference",
    student.notificationPreferences,
  );
  addJsonSection("notifications.json", "notification", cappedNotifications.rows);

  // 19. Staff-authored content about the student. See the select block above
  // for the CaseNote-category confidentiality decision.
  addJsonSection("case-notes.json", "case_note", student.caseNotes);
  addJsonSection("alerts.json", "student_alert", cappedAlerts.rows);

  // 20. Dead-letter copies of failed Sage extractions — a capped snapshot of
  // the student's own message, not a new class of data.
  addJsonSection("failed-extractions.json", "failed_extraction", cappedFailedExtractions.rows);

  // 21. Add manifest
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  await archive.finalize();

  // Wait for stream to finish
  await new Promise<void>((resolve, reject) => {
    bufferStream.on("finish", resolve);
    bufferStream.on("error", reject);
  });

  const zipBuffer = Buffer.concat(chunks);

  if (zipBuffer.length > ARCHIVE_SIZE_WARNING_BYTES) {
    logger.warn("Student archive exceeded the size-warning threshold", {
      student: studentLogKey(studentId),
      archiveSize: zipBuffer.length,
      thresholdBytes: ARCHIVE_SIZE_WARNING_BYTES,
    });
  }

  const dateStamp = new Date().toISOString().slice(0, 10);
  const safeName = student.displayName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
  const storageKey = `archives/${studentId}/${safeName}_${dateStamp}.zip`;

  await uploadFile(storageKey, zipBuffer, "application/zip");

  logger.info("Student archive created", {
    student: studentLogKey(studentId),
    fileCount: manifest.fileCount,
    archiveSize: zipBuffer.length,
    storageKey,
  });

  return { storageKey, fileCount: manifest.fileCount };
}
