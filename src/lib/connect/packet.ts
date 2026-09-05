// =============================================================================
// Packet assembly — Match & Connect Phase 4, Task 4.2.
//
// The packet is built ONCE, at PROPOSE time, and frozen at approval: the
// approval card has to show the student the exact contents before they tap, so
// it cannot be assembled afterwards. Nothing re-derives it at send time — the
// student approved a specific list of specific facts, and a résumé edited the
// next morning must not silently change what an employer receives.
//
// The résumé and cover letter come from `tailor_application`'s own planner —
// this module calls `createTailoredApplication` with the LEAD rendered as the
// "posting", so the grounding contract, the exact-fact assertions and the
// prompt all stay in one place. Duplicating that prompt here would have given
// the program two anti-fabrication guards to keep in step, and the weaker one
// would eventually win.
// =============================================================================

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { studentLogKey } from "@/lib/log-keys";
import { generateStorageKey, uploadFile } from "@/lib/storage";
import { generateResumePdfArrayBuffer } from "@/lib/resume-pdf";
import { parseStoredResumeData, type ResumeContent } from "@/lib/resume";
import {
  createTailoredApplication,
  type TailoringSource,
} from "@/lib/sage/agent/tailor-application";
import { sanitizeForPrompt } from "@/lib/sage/system-prompts";

import { describeLeadPay } from "./leads-shared";
import {
  candidateDisplayName,
  packetSchema,
  type Packet,
  type PacketFieldKey,
} from "./packet-shared";
import { subsidyLine } from "./subsidies";
import { AVAILABILITY_SLOTS, parseAvailability } from "./work-profile-shared";

export * from "./packet-shared";

export class PacketAssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PacketAssemblyError";
  }
}

/**
 * How long the tailoring model call may hold up a propose request.
 *
 * This runs on the REQUEST PATH: an instructor tapping "Introduce", or a
 * student's Sage turn. The local provider's own ceiling is 300s, which is
 * three minutes of a spinner on a page somebody is waiting at. Past this the
 * packet degrades to no résumé, the failure is logged, and the approval card
 * says so — all of which is better than a request that never answers.
 */
export const TAILORING_DEADLINE_MS = 20_000;

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const SLOT_LABELS: Record<(typeof AVAILABILITY_SLOTS)[number], string> = {
  morning: "mornings",
  afternoon: "afternoons",
  evening: "evenings",
  overnight: "overnights",
};

/**
 * "Weekdays: mornings, afternoons. Saturday: mornings." — the availability the
 * employer is shown.
 *
 * Days and slots ONLY. The work profile also holds a pay floor, a transport
 * mode, a home ZIP and childcare hours; the design spec §4 is explicit that
 * none of those are shared ("availability and start date only"), and this
 * function is where that line is drawn.
 */
export function summarizeAvailability(availability: unknown): string {
  const grid = parseAvailability(availability);

  const parts: string[] = [];
  for (const [day, slots] of Object.entries(grid)) {
    const open = AVAILABILITY_SLOTS.filter((slot) => slots[slot]).map(
      (slot) => SLOT_LABELS[slot],
    );
    if (open.length === 0) continue;
    parts.push(`${day.charAt(0).toUpperCase()}${day.slice(1)}: ${open.join(", ")}`);
  }

  return parts.length > 0 ? parts.join(". ") : "Not set";
}

/**
 * The fields this packet actually has content for.
 *
 * A student must not be shown "The days and times you can work" on the
 * approval card when the profile is empty and the employer would receive
 * "Not set". The list they approve is the list that goes.
 *
 * `subsidy_line` stays even when no verified rule applies: the fallback
 * ("Ask about hiring incentives.") is still that note, and it carries nothing
 * about the student.
 */
export function contentBearingFields(packet: {
  endorsement: string;
  certifications: string[];
  availabilitySummary: string;
  earliestStart: string | null;
  resumeVersionId: string | null;
}): PacketFieldKey[] {
  const included: PacketFieldKey[] = ["candidate_name"];
  if (packet.resumeVersionId) included.push("resume");
  if (packet.certifications.length > 0) included.push("verified_certifications");
  if (packet.availabilitySummary && packet.availabilitySummary !== "Not set") {
    included.push("availability");
  }
  if (packet.earliestStart) included.push("earliest_start");
  if (packet.endorsement.trim().length > 0) included.push("endorsement");
  included.push("subsidy_line");
  return included;
}

interface AssembleOptions {
  /** The endorsement an instructor has approved. Empty when there is none. */
  endorsement?: string;
  /** Override the field list. Defaults to the content-bearing ones. */
  includedFields?: PacketFieldKey[];
  /**
   * `Employer.subsidyFlags`, supplied by the caller rather than read here.
   *
   * Employer is staff-only under RLS, and a student-initiated proposal
   * assembles its own packet — so this module cannot read the column without
   * an admin bypass, and a bypass to decide whether to print a benefits
   * sentence is not a trade worth making. A staff caller passes the flags; the
   * student path passes nothing and the packet says "Ask about hiring
   * incentives.", which is also what every path says until P0.8 verifies a
   * figure.
   */
  subsidyFlags?: unknown;
}

/**
 * Build the packet for one connection.
 *
 * Runs in the CALLER's RLS context: this is invoked from the student's own
 * approval route and from a staff route, and in both cases the reads below
 * must be the ones that actor is allowed to make.
 */
export async function assemblePacket(
  target: { studentId: string; jobLeadId: string },
  options: AssembleOptions = {},
): Promise<Packet> {
  // Keyed on (studentId, jobLeadId), NOT on a connection id: the packet is
  // assembled BEFORE the Connection row exists, so a failure here leaves no
  // half-built proposal squatting on the permanent unique key, and the
  // student-context write that stores it is the INSERT rather than an UPDATE
  // the RLS policy would reject.
  const [student, jobLead] = await Promise.all([
    prisma.student.findUnique({
      where: { id: target.studentId },
      select: {
        displayName: true,
        resumeData: { select: { data: true } },
        workProfile: true,
        certifications: {
          // Verified only. An in-progress or self-reported card is not a fact
          // this program will assert to an employer.
          where: { status: "completed", verificationStatus: "verified" },
          select: { id: true, certType: true, completedAt: true },
        },
      },
    }),
    prisma.jobLead.findUnique({
      where: { id: target.jobLeadId },
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        clusters: true,
        payMin: true,
        payMax: true,
        payPeriod: true,
        // The denormalised name, NOT the Employer relation: assemblePacket
        // runs in the caller's RLS context and that caller is the student when
        // Sage raised the proposal. `employer_access` has no student branch, so
        // a join here would come back empty.
        employerName: true,
      },
    }),
  ]);
  if (!student) throw new PacketAssemblyError("That student wasn't found.");
  if (!jobLead) throw new PacketAssemblyError("That job wasn't found.");

  const resume: ResumeContent = parseStoredResumeData(student.resumeData?.data ?? null);
  const certifications = student.certifications.map((cert) => cert.certType);

  const { resumeVersionId, coverLetterId } = await buildTailoredDocuments({
    studentId: target.studentId,
    jobLeadId: target.jobLeadId,
    resume,
    certifications,
    lead: jobLead,
  });

  const line = await subsidyLine({ subsidyFlags: options.subsidyFlags ?? null });

  const draft = {
    resumeVersionId,
    coverLetterId,
    resumeFileUploadId: null,
    endorsement: (options.endorsement ?? "").slice(0, 2000),
    includedCertIds: student.certifications.map((cert) => cert.id),
    candidateName: candidateDisplayName(student.displayName),
    certifications,
    availabilitySummary: summarizeAvailability(student.workProfile?.availability ?? null),
    earliestStart: student.workProfile?.earliestStart
      ? student.workProfile.earliestStart.toISOString().slice(0, 10)
      : null,
    subsidyLine: line,
  };

  return packetSchema.parse({
    ...draft,
    includedFields: options.includedFields ?? contentBearingFields(draft),
  } satisfies Packet);
}

interface TailoringInput {
  studentId: string;
  jobLeadId: string;
  resume: ResumeContent;
  certifications: string[];
  lead: {
    id: string;
    title: string;
    description: string | null;
    location: string;
    clusters: string[];
    payMin: number | null;
    payMax: number | null;
    payPeriod: string;
    employerName: string;
  };
}

/**
 * Reuse the existing tailored résumé for this lead, or create one.
 *
 * The lead is rendered as `tailor_application`'s "posting" — the same shape it
 * builds for a JobListing — so its planner, its grounding assertions and its
 * prompt are used unchanged. Lead text is instructor- or employer-supplied, so
 * it is third-party data and goes through `sanitizeForPrompt` at this boundary
 * exactly as a scraped posting does.
 */
async function buildTailoredDocuments(input: TailoringInput): Promise<{
  resumeVersionId: string | null;
  coverLetterId: string | null;
}> {
  const existing = await prisma.resumeVersion.findFirst({
    where: { studentId: input.studentId, jobLeadId: input.jobLeadId },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  if (existing) {
    const letter = await prisma.coverLetter.findFirst({
      where: { studentId: input.studentId, jobLeadId: input.jobLeadId },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    return { resumeVersionId: existing.id, coverLetterId: letter?.id ?? null };
  }

  const description = [input.lead.description ?? "", `Location: ${input.lead.location}`]
    .filter(Boolean)
    .join("\n\n");

  const source: TailoringSource = {
    job: {
      id: input.lead.id,
      title: sanitizeForPrompt(input.lead.title),
      company: sanitizeForPrompt(input.lead.employerName),
      location: sanitizeForPrompt(input.lead.location),
      description: sanitizeForPrompt(description),
      salary: describeLeadPay(input.lead),
      clusters: input.lead.clusters,
    },
    profile: {
      resume: input.resume,
      completedCertifications: input.certifications,
      nationalClusters: null,
      transferableSkills: null,
    },
    grounding: renderGrounding(input, description),
  };

  try {
    // The lead is named as a LEAD, so the rows are written with `jobLeadId`
    // from the start. The first cut passed the lead id into `jobListingId` and
    // re-keyed afterwards; the FK rejected that insert every time, and the
    // bare catch below turned it into "every packet has no résumé", silently.
    const created = await withDeadline(
      createTailoredApplication(input.studentId, { kind: "lead", id: input.lead.id }, source),
      TAILORING_DEADLINE_MS,
    );
    return { resumeVersionId: created.resumeVersionId, coverLetterId: created.coverLetterId };
  } catch (error) {
    // A tailoring failure must not block the introduction: the packet still
    // carries verified certs, availability and the endorsement, and the
    // instructor can attach a résumé by hand. But it must not be SILENT
    // either — that is exactly how the FK failure above hid. The student is
    // told too: the approval card says the résumé is still being prepared
    // rather than letting them consent to a blank.
    logger.warn("Packet tailoring failed", {
      student: studentLogKey(input.studentId),
      error: String(error),
    });
    return { resumeVersionId: null, coverLetterId: null };
  }
}

function renderGrounding(input: TailoringInput, description: string): string {
  return [
    "JOB POSTING",
    `Title: ${input.lead.title}`,
    `Company: ${input.lead.employerName}`,
    `Location: ${input.lead.location}`,
    `Description: ${description}`,
    "",
    "STUDENT PROFILE",
    `Skills: ${input.resume.skills.join(", ")}`,
    `Experience: ${input.resume.experience
      .map((item) => `${item.title} at ${item.company} (${item.dates})`)
      .join("; ")}`,
    `Credentials: ${input.certifications.join(", ")}`,
  ].join("\n");
}

/**
 * Render the packet's résumé to PDF and store it, returning the FileUpload id.
 *
 * Goes through `generateResumePdfArrayBuffer` — the same renderer the student's
 * own résumé export uses — so what the employer opens is the document the
 * student has already seen, not a second layout that could drift from it.
 *
 * Returns null on any failure. The employer page then shows the packet summary
 * without a PDF link rather than a broken download.
 */
export async function renderPacketPdf(
  studentId: string,
  packet: Packet,
): Promise<string | null> {
  if (!packet.resumeVersionId) return null;

  try {
    const version = await prisma.resumeVersion.findFirst({
      where: { id: packet.resumeVersionId, studentId },
      select: { content: true },
    });
    if (!version) return null;

    const content = parseStoredResumeData(JSON.stringify(version.content));
    const buffer = Buffer.from(
      await generateResumePdfArrayBuffer(packet.candidateName, content),
    );

    const storageKey = generateStorageKey(studentId, "connect-packet.pdf");
    await uploadFile(storageKey, buffer, "application/pdf");

    const upload = await prisma.fileUpload.create({
      data: {
        studentId,
        filename: "resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: buffer.byteLength,
        storageKey,
        category: "connect_packet",
      },
      select: { id: true },
    });
    return upload.id;
  } catch {
    return null;
  }
}

/** The frozen packet as a Prisma JSON value. */
export function packetAsJson(packet: Packet): Prisma.InputJsonValue {
  return packet as unknown as Prisma.InputJsonValue;
}
