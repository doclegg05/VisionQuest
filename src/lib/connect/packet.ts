// =============================================================================
// Packet assembly — Match & Connect Phase 4, Task 4.2.
//
// The packet is built ONCE, at approval, and frozen on Connection.packet. It
// is never re-derived at send time: the student approved a specific list of
// specific facts, and a résumé edited the next morning must not silently
// change what an employer receives.
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
  /** Override the field list. Defaults to the full allowlist. */
  includedFields?: PacketFieldKey[];
}

/**
 * Build the packet for one connection.
 *
 * Runs in the CALLER's RLS context: this is invoked from the student's own
 * approval route and from a staff route, and in both cases the reads below
 * must be the ones that actor is allowed to make.
 */
export async function assemblePacket(
  connectionId: string,
  options: AssembleOptions = {},
): Promise<Packet> {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      studentId: true,
      jobLeadId: true,
      student: {
        select: {
          displayName: true,
          resumeData: { select: { data: true } },
          workProfile: true,
          certifications: {
            // Verified only. An in-progress or self-reported card is not a
            // fact this program will assert to an employer.
            where: { status: "completed", verificationStatus: "verified" },
            select: { id: true, certType: true, completedAt: true },
          },
        },
      },
      jobLead: {
        select: {
          id: true,
          title: true,
          description: true,
          location: true,
          clusters: true,
          payMin: true,
          payMax: true,
          payPeriod: true,
          employer: { select: { name: true, subsidyFlags: true } },
        },
      },
    },
  });
  if (!connection) throw new PacketAssemblyError("That connection wasn't found.");

  const { student, jobLead } = connection;
  const resume: ResumeContent = parseStoredResumeData(student.resumeData?.data ?? null);
  const certifications = student.certifications.map((cert) => cert.certType);

  const { resumeVersionId, coverLetterId } = await buildTailoredDocuments({
    studentId: connection.studentId,
    jobLeadId: connection.jobLeadId,
    resume,
    certifications,
    lead: jobLead,
  });

  const line = await subsidyLine({ subsidyFlags: jobLead.employer.subsidyFlags });

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
    employer: { name: string };
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
      company: sanitizeForPrompt(input.lead.employer.name),
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
    const created = await createTailoredApplication(input.studentId, input.lead.id, source);
    // createTailoredApplication writes rows keyed to a JobListing id, which
    // this lead is not. Re-key them onto the lead so the packet's documents
    // hang off the opening they were written for.
    await prisma.$transaction([
      prisma.resumeVersion.update({
        where: { id: created.resumeVersionId },
        data: { jobLeadId: input.jobLeadId, jobListingId: null },
      }),
      prisma.coverLetter.update({
        where: { id: created.coverLetterId },
        data: { jobLeadId: input.jobLeadId, jobListingId: null },
      }),
    ]);
    return { resumeVersionId: created.resumeVersionId, coverLetterId: created.coverLetterId };
  } catch {
    // A tailoring failure must not block the introduction: the packet still
    // carries verified certs, availability and the endorsement, and the
    // instructor can attach a résumé by hand. The nulls are visible in the
    // console, so this degrades loudly rather than silently.
    return { resumeVersionId: null, coverLetterId: null };
  }
}

function renderGrounding(input: TailoringInput, description: string): string {
  return [
    "JOB POSTING",
    `Title: ${input.lead.title}`,
    `Company: ${input.lead.employer.name}`,
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
