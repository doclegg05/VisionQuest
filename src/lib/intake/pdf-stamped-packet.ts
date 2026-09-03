import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  parseSignatureImageDataUrl,
  type IntakePayload,
  type ParsedSignatureImage,
} from "./schema";
import { uploadFile } from "@/lib/storage";
// The app client is the CORRECT one here, and prismaAdmin would be wrong. Every
// write in this module belongs to a single student and runs inside
// `withStudentRlsContext(studentDbId, ...)`, which is the second remedy the rule
// itself prescribes; the rule matches on the import and cannot see the wrapper.
// Reaching for prismaAdmin to silence it would trade a lint error for an unscoped
// write path through a document generator that public intake can reach. If a write
// here ever needs to cross students, that is a design change to argue for, not a
// client swap.
// eslint-disable-next-line no-restricted-imports -- RLS-scoped, see above
import { prisma } from "@/lib/db";
import { withStudentRlsContext } from "@/lib/rls-context";
import { signDocumentVerificationToken } from "./document-token";

// Re-exported: callers were given this name on this module, and the token is now
// defined once in ./document-token so signer and verifier cannot drift apart.
export { signDocumentVerificationToken } from "./document-token";
import { logger } from "@/lib/logger";
import QRCode from "qrcode";

// US Letter dimensions in points
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;

const OFFICIAL_TEMPLATE_RELATIVE_PATH =
  "docs-upload/orientation/SPOKES_Student_Profile_FY26_Fillable.pdf";

interface DrawContext {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
}

const INK_PRIMARY = rgb(0.0, 0.48, 0.68); // SPOKES Primary (#007baf)
const INK_TEXT = rgb(0.1, 0.12, 0.16);
const INK_MUTED = rgb(0.42, 0.46, 0.52);
const INK_LINE = rgb(0.85, 0.88, 0.92);
const INK_WARN = rgb(0.7, 0.45, 0.1);

// The standard fonts encode WinAnsi only, and every name on this form arrives
// from a public intake box. An unencodable character would throw out of pdf-lib
// and take the whole packet with it, so text is folded into the encodable range
// before it is drawn.
const WINANSI_SPECIALS =
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ" +
  "‘’“”•–—˜™š›œžŸ";

function safeText(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += char;
    } else if (WINANSI_SPECIALS.includes(char)) {
      out += char;
    } else if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += " ";
    } else {
      out += "?";
    }
  }
  return out;
}

// --- Attestation ----------------------------------------------------------------

export const PACKET_DIGEST_ALGORITHM = "sha256" as const;
export type PacketDigestAlgorithm = typeof PACKET_DIGEST_ALGORITHM;

/**
 * The integrity digest for a packet: a SHA-256 over the exact PDF bytes.
 *
 * Exported so a verifier hashes the archived original with the same function
 * that produced the recorded digest. Nothing derived from the student's name or
 * the signing time goes into it — the pre-hardening "digest" was hex of
 * `name:timestamp:studentId`, which decoded straight back to the student.
 */
export function computePacketDigest(bytes: Uint8Array): string {
  return crypto.createHash(PACKET_DIGEST_ALGORITHM).update(bytes).digest("hex");
}

/**
 * Mint the id the packet is filed under.
 *
 * It becomes the FileUpload primary key, the storage-key discriminator, the
 * printed verification id, and the `fid` the verification token binds — one
 * identity for the archived original. Cuid-shaped because several routes screen
 * file ids with `z.string().cuid()`; 96 random bits, so it carries no student
 * data and cannot be enumerated.
 */
export function createPacketFileUploadId(): string {
  return `c${crypto.randomBytes(12).toString("hex")}`;
}

/** Signing forensics the ROUTE derives — never the request body. */
export interface SignatureForensics {
  /** When the signature was captured. Defaults to the server clock. */
  signedAt?: Date;
  /** Source IP, read from the connection or proxy headers by the route. */
  sourceIp?: string | null;
}

/** A counter-signature applied on an authenticated staff path. */
export interface StaffCounterSignature {
  /** Staff display name, taken from the verified session. */
  name: string;
  title: string;
  /** Session id of the staff member approving, recorded as the reviewer. */
  reviewerId: string;
  signedAt?: Date;
  signatureDataUrl?: string | null;
}

export interface StampedPacketOptions {
  signature?: SignatureForensics;
  /**
   * Present only when signed-in staff counter-sign. It can never be reached from
   * an intake payload, which is what let an anonymous POST self-approve.
   */
  staffCounterSignature?: StaffCounterSignature;
  /**
   * Path to the official state template. `null` renders the procedural packet.
   * Defaults to the FY26 fillable profile under `docs-upload/orientation/`.
   */
  templatePath?: string | null;
  /**
   * Bind the packet to an existing FileUpload row. Regeneration of an archived
   * packet should pass the original id so the printed token keeps resolving;
   * omitted, a fresh id is minted and `saveStampedIntakePacket` files under it.
   */
  fileUploadId?: string;
  /** Clock injection point for tests. */
  now?: Date;
}

export interface PacketAttestation {
  /** FileUpload primary key, printed verification id, and the token's `fid`. */
  fileUploadId: string;
  /**
   * HMAC token the printed QR code carries, or null when
   * `DOCUMENT_VERIFICATION_SECRET` is unconfigured (the packet then ships
   * without a QR rather than failing to generate).
   */
  verificationToken: string | null;
  /** Lowercase hex digest over the bytes returned alongside this record. */
  digest: string;
  algorithm: PacketDigestAlgorithm;
  signedAt: Date;
  sourceIp: string | null;
  /** The student affirmed consent AND signed. */
  studentAttested: boolean;
  staffCounterSigned: boolean;
  reviewerId: string | null;
}

interface ResolvedStaffSignature {
  name: string;
  title: string;
  reviewerId: string;
  signedAt: Date;
  image: ParsedSignatureImage | null;
}

export interface PacketAttestationPlan {
  fileUploadId: string;
  verificationToken: string | null;
  signedAt: Date;
  sourceIp: string | null;
  studentAttested: boolean;
  signerName: string | null;
  methodLabel: string;
  signatureImage: ParsedSignatureImage | null;
  staff: ResolvedStaffSignature | null;
}

const SIGNATURE_METHOD_LABELS: Record<string, string> = {
  drawn: "Interactive Touch/Stylus Signature Pad",
  uploaded: "Uploaded Handwritten Signature",
  typed_affirmation: "Typed Legal Affirmation",
};

/**
 * Decide what this packet may claim.
 *
 * A packet may print the FERPA / E-SIGN declaration only when the record shows
 * the student both consented and signed; it may print an instructor clearance
 * only when staff passed a counter-signature. Nothing here reads the deprecated
 * `staff*` or `signature{Timestamp,Ip,AuditHash}` fields on the payload.
 */
export function resolvePacketAttestation(
  payload: IntakePayload,
  options: StampedPacketOptions = {},
): PacketAttestationPlan {
  const signedAt = options.signature?.signedAt ?? options.now ?? new Date();
  const signerName = payload.signatureName?.trim() ? payload.signatureName.trim() : null;
  const signatureImage = parseSignatureImageDataUrl(payload.signatureDataUrl);

  const consented =
    payload.ferpaConsentSigned === true && payload.policyAcknowledgmentSigned === true;
  const hasSignatureArtifact =
    signatureImage !== null || payload.signatureMethod === "typed_affirmation";
  const studentAttested = consented && signerName !== null && hasSignatureArtifact;

  const staffInput = options.staffCounterSignature;
  const staff: ResolvedStaffSignature | null =
    staffInput && staffInput.name.trim() && staffInput.reviewerId.trim()
      ? {
          name: staffInput.name.trim(),
          title: staffInput.title.trim() || "SPOKES Program Instructor / Coordinator",
          reviewerId: staffInput.reviewerId.trim(),
          signedAt: staffInput.signedAt ?? options.now ?? new Date(),
          image: parseSignatureImageDataUrl(staffInput.signatureDataUrl),
        }
      : null;

  const fileUploadId = options.fileUploadId?.trim() || createPacketFileUploadId();

  return {
    fileUploadId,
    verificationToken: trySignVerificationToken(fileUploadId),
    signedAt,
    sourceIp: options.signature?.sourceIp?.trim() || null,
    studentAttested,
    signerName,
    methodLabel:
      SIGNATURE_METHOD_LABELS[payload.signatureMethod ?? ""] ?? "Digital Legal Affirmation",
    signatureImage,
    staff,
  };
}

const UNSIGNED_NOTICE = "NO ELECTRONIC SIGNATURE ON RECORD";
const UNSIGNED_EXPLANATION =
  "This copy is an administrative record only. No electronic signature or FERPA release consent is on file for it.";
const LEGAL_DECLARATION =
  "Legal Declaration: Verified electronic signature compliant with FERPA 34 CFR § 99.30(d) and Federal E-SIGN Act (15 U.S.C. § 7001).";

/**
 * A missing verification secret must not stop a compliance packet from being
 * produced, so the token is optional and its absence is logged rather than
 * thrown. The packet then prints no QR code.
 */
function trySignVerificationToken(fileUploadId: string): string | null {
  try {
    return signDocumentVerificationToken(fileUploadId);
  } catch (err) {
    logger.warn("Intake packet issued without a verification token", { error: String(err) });
    return null;
  }
}

function verifyUrlFor(token: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://visionquest.onrender.com";
  return `${baseUrl}/verify/document?token=${encodeURIComponent(token)}`;
}

async function embedSignatureImage(doc: PDFDocument, image: ParsedSignatureImage) {
  const bytes = Buffer.from(image.base64, "base64");
  return image.mimeType === "image/jpeg" ? doc.embedJpg(bytes) : doc.embedPng(bytes);
}

// --- Drawing helpers ------------------------------------------------------------

function checkPage(ctx: DrawContext, requiredSpace: number): void {
  if (ctx.y < MARGIN + requiredSpace) {
    ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.y = PAGE_HEIGHT - MARGIN;
  }
}

function drawSectionHeader(ctx: DrawContext, title: string): void {
  checkPage(ctx, 35);
  ctx.y -= 10;
  ctx.page.drawText(safeText(title.toUpperCase()), {
    x: MARGIN,
    y: ctx.y,
    size: 11,
    font: ctx.bold,
    color: INK_PRIMARY,
  });
  ctx.y -= 5;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN, y: ctx.y },
    thickness: 1,
    color: INK_LINE,
  });
  ctx.y -= 15;
}

function drawField(
  ctx: DrawContext,
  label: string,
  value: string | null | undefined,
  startX = MARGIN,
): void {
  const displayVal = value && value.trim() ? value.trim() : "N/A";
  ctx.page.drawText(safeText(label), {
    x: startX,
    y: ctx.y,
    size: 9,
    font: ctx.bold,
    color: INK_MUTED,
  });
  ctx.page.drawText(safeText(displayVal), {
    x: startX,
    y: ctx.y - 12,
    size: 10,
    font: ctx.regular,
    color: INK_TEXT,
  });
}

function drawParagraph(
  ctx: DrawContext,
  text: string,
  fontSize = 9,
  color = INK_TEXT,
): void {
  const words = safeText(text).split(/\s+/);
  let line = "";
  const maxWidth = PAGE_WIDTH - 2 * MARGIN;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const testWidth = ctx.regular.widthOfTextAtSize(testLine, fontSize);
    if (testWidth > maxWidth) {
      checkPage(ctx, fontSize + 4);
      ctx.page.drawText(line, {
        x: MARGIN,
        y: ctx.y,
        size: fontSize,
        font: ctx.regular,
        color,
      });
      ctx.y -= fontSize + 4;
      line = word;
    } else {
      line = testLine;
    }
  }

  if (line) {
    checkPage(ctx, fontSize + 4);
    ctx.page.drawText(line, {
      x: MARGIN,
      y: ctx.y,
      size: fontSize,
      font: ctx.regular,
      color,
    });
    ctx.y -= fontSize + 6;
  }
}

// --- Official state template -----------------------------------------------------

async function tryFillOfficialStudentProfilePdf(
  payload: IntakePayload,
  studentIdDisplay: string,
  plan: PacketAttestationPlan,
  templatePath: string,
): Promise<Buffer | null> {
  let officialBytes: Buffer;
  try {
    officialBytes = await fs.readFile(templatePath);
  } catch {
    return null;
  }

  try {
    const doc = await PDFDocument.load(officialBytes);
    const form = doc.getForm();

    const trySetText = (fieldName: string, val: string) => {
      try {
        const field = form.getTextField(fieldName);
        field.setText(safeText(val));
      } catch {}
    };

    trySetText("Name", `${payload.firstName} ${payload.lastName}`);
    trySetText("Date1_af_date", plan.signedAt.toLocaleDateString("en-US")); // Referral Date
    trySetText("Date2_af_date", payload.birthDate); // Date of Birth
    trySetText("City State Zip Code", `${payload.county} County, West Virginia`);
    trySetText("HomeCell Phone", payload.phone || "");
    if (payload.email) {
      trySetText("EMail Address", payload.email);
    }
    trySetText("Date3_af_date", plan.signedAt.toLocaleDateString("en-US"));

    if (payload.tanfStatus) {
      try {
        const cb12 = form.getCheckBox("Check Box12");
        cb12.check();
      } catch {}
      trySetText("Other Barrier", `TANF / WV Works (${payload.programTrack || "Employability"})`);
    } else {
      trySetText("Other Barrier", payload.programTrack || "General Employability");
    }

    form.flatten();

    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);

    const firstPage = doc.getPages()[0];
    const { width } = firstPage.getSize();

    if (plan.studentAttested && plan.signerName) {
      firstPage.drawText(safeText(plan.signerName), {
        x: 152,
        y: 496,
        size: 11,
        font: oblique,
        color: rgb(0.0, 0.25, 0.5),
      });
    }

    firstPage.drawRectangle({
      x: 36,
      y: 18,
      width: width - 72,
      height: 48,
      color: plan.studentAttested ? rgb(0.96, 0.98, 1.0) : rgb(1.0, 0.98, 0.94),
      borderColor: plan.studentAttested ? rgb(0.0, 0.48, 0.69) : INK_WARN,
      borderWidth: 1.5,
    });

    if (plan.studentAttested) {
      firstPage.drawText(
        safeText(
          "OFFICIAL STATE VERIFICATION: E-SIGN & FERPA 34 CFR § 99.30(d) AUDIT CERTIFICATE",
        ),
        { x: 46, y: 52, size: 7.5, font: bold, color: rgb(0.0, 0.48, 0.69) },
      );
      firstPage.drawText(
        safeText(
          `Digitally Signed by: ${plan.signerName}  |  Timestamp: ${plan.signedAt.toISOString()}  |  Source IP: ${plan.sourceIp ?? "not recorded"}`,
        ),
        { x: 46, y: 38, size: 7, font: regular, color: rgb(0.15, 0.15, 0.15) },
      );
    } else {
      firstPage.drawText(safeText(`UNSIGNED ADMINISTRATIVE COPY — ${UNSIGNED_NOTICE}`), {
        x: 46,
        y: 52,
        size: 7.5,
        font: bold,
        color: INK_WARN,
      });
      firstPage.drawText(safeText(UNSIGNED_EXPLANATION), {
        x: 46,
        y: 38,
        size: 7,
        font: regular,
        color: rgb(0.15, 0.15, 0.15),
      });
    }

    firstPage.drawText(
      safeText(`Verification ID: ${plan.fileUploadId}  |  Student Identifier: ${studentIdDisplay}`),
      { x: 46, y: 26, size: 6.5, font: regular, color: rgb(0.4, 0.4, 0.4) },
    );

    const page2 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const ctx: DrawContext = {
      doc,
      page: page2,
      y: PAGE_HEIGHT - MARGIN,
      regular,
      bold,
    };

    ctx.page.drawText(safeText("STATE OF WEST VIRGINIA — SPOKES PROGRAM"), {
      x: MARGIN,
      y: ctx.y,
      size: 10,
      font: ctx.bold,
      color: INK_MUTED,
    });
    ctx.y -= 16;

    ctx.page.drawText(safeText("Statutory FERPA Disclosure & Program Policies"), {
      x: MARGIN,
      y: ctx.y,
      size: 16,
      font: ctx.bold,
      color: INK_PRIMARY,
    });
    ctx.y -= 22;

    drawSectionHeader(
      ctx,
      "1. Statutory FERPA Authorization to Release Information (34 CFR Part 99)",
    );
    drawParagraph(
      ctx,
      "In compliance with the Family Educational Rights and Privacy Act (FERPA) (34 CFR § 99.30), the student grants authorization to the West Virginia Department of Human Services (WV DoHS / TANF / WV Works), WorkForce West Virginia, SPOKES adult education administrators, and authorized training partners to share and disclose educational records, attendance hours, milestone achievements, certification progress, and assessment outcomes.",
      9,
    );
    drawParagraph(
      ctx,
      "This release allows program staff to provide career coaching, verify TANF participation hours, coordinate supportive services (such as transportation assistance), and issue official credentials. The student understands that this consent remains in effect throughout their active enrollment in the SPOKES workforce program.",
      9,
    );
    ctx.y -= 10;

    drawSectionHeader(ctx, "2. SPOKES Attendance Contract & Code of Conduct");
    drawParagraph(
      ctx,
      "The student agrees to attend all scheduled class sessions punctually, engage actively in employability training, collaborate with their AI coach Sage and instructional staff, and adhere to workplace readiness expectations.",
      9,
    );
    drawParagraph(
      ctx,
      "Technology Acceptable Use: The student agrees to use computer resources, internet access, and educational accounts solely for approved career development, skill building, and certification activities. Unauthorized use, harassment, or software tampering will result in immediate review.",
      9,
    );
    ctx.y -= 20;

    const boxHeight = plan.staff ? 60 : 45;
    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - boxHeight,
      width: PAGE_WIDTH - 2 * MARGIN,
      height: boxHeight,
      color: plan.studentAttested ? rgb(0.96, 0.98, 1.0) : rgb(1.0, 0.98, 0.94),
      borderColor: plan.studentAttested ? rgb(0.0, 0.48, 0.69) : INK_WARN,
      borderWidth: 1,
    });

    ctx.page.drawText(
      safeText(
        plan.studentAttested
          ? `Consent Verified & Recorded  •  Student: ${plan.signerName}  •  ${plan.signedAt.toISOString()}`
          : `${UNSIGNED_NOTICE}  •  This page records the policies only; no consent is on file.`,
      ),
      {
        x: MARGIN + 12,
        y: ctx.y - 20,
        size: 8,
        font: ctx.bold,
        color: plan.studentAttested ? INK_PRIMARY : INK_WARN,
      },
    );

    ctx.page.drawText(
      safeText(
        plan.studentAttested
          ? "Document stamped and archived in compliance with Federal E-SIGN Act (15 U.S.C. § 7001)."
          : UNSIGNED_EXPLANATION,
      ),
      { x: MARGIN + 12, y: ctx.y - 35, size: 7, font: ctx.regular, color: INK_MUTED },
    );

    if (plan.staff) {
      ctx.page.drawText(
        safeText(
          `State Verification Clearance: APPROVED & ENROLLED  •  ${plan.staff.name}, ${plan.staff.title}  •  ${plan.staff.signedAt.toISOString()}`,
        ),
        { x: MARGIN + 12, y: ctx.y - 50, size: 7.5, font: ctx.bold, color: rgb(0.08, 0.45, 0.3) },
      );
    }

    const filledBytes = await doc.save();
    return Buffer.from(filledBytes);
  } catch (err) {
    console.error("Failed to populate official PDF template, using procedural fallback:", err);
    return null;
  }
}

// --- Procedural packet -----------------------------------------------------------

async function renderProceduralPacket(
  payload: IntakePayload,
  studentIdDisplay: string,
  plan: PacketAttestationPlan,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx: DrawContext = {
    doc,
    page,
    y: PAGE_HEIGHT - MARGIN,
    regular,
    bold,
  };

  // --- Header ---
  ctx.page.drawText(safeText("STATE OF WEST VIRGINIA — SPOKES PROGRAM"), {
    x: MARGIN,
    y: ctx.y,
    size: 10,
    font: ctx.bold,
    color: INK_MUTED,
  });
  ctx.y -= 16;

  ctx.page.drawText(safeText("Official Student Intake & Enrollment Record"), {
    x: MARGIN,
    y: ctx.y,
    size: 18,
    font: ctx.bold,
    color: INK_PRIMARY,
  });
  ctx.y -= 14;

  const dateString = plan.signedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  ctx.page.drawText(
    safeText(`Enrollment Date: ${dateString}  |  Student Identifier: ${studentIdDisplay}`),
    { x: MARGIN, y: ctx.y, size: 9, font: ctx.regular, color: INK_MUTED },
  );
  ctx.y -= 10;

  // --- Section 1: Demographics ---
  drawSectionHeader(ctx, "1. Student Identification & Demographics");

  const fullName = [payload.firstName, payload.middleName, payload.lastName]
    .filter(Boolean)
    .join(" ");
  drawField(ctx, "Full Legal Name", fullName, MARGIN);
  drawField(ctx, "Preferred Name", payload.preferredName, MARGIN + 250);
  ctx.y -= 28;

  drawField(ctx, "Date of Birth", payload.birthDate, MARGIN);
  drawField(ctx, "West Virginia County", payload.county, MARGIN + 250);
  ctx.y -= 28;

  const addressLine = [payload.streetAddress, payload.city].filter(Boolean).join(", ");
  drawField(ctx, "Residential Address & City", addressLine, MARGIN);
  drawField(ctx, "ZIP Code", payload.zipCode, MARGIN + 250);
  ctx.y -= 28;

  drawField(ctx, "Contact Email", payload.email, MARGIN);
  drawField(ctx, "Contact Phone", payload.phone, MARGIN + 250);
  ctx.y -= 28;

  const emergencyLabel = payload.emergencyContactRelation
    ? `${payload.emergencyContactName || "N/A"} (${payload.emergencyContactRelation})`
    : payload.emergencyContactName;
  drawField(ctx, "Emergency Contact & Relation", emergencyLabel, MARGIN);
  drawField(ctx, "Emergency Phone", payload.emergencyContactPhone, MARGIN + 250);
  ctx.y -= 28;

  drawField(ctx, "Self-Identified Gender", payload.gender, MARGIN);
  drawField(ctx, "Primary Language", payload.primaryLanguage || "English", MARGIN + 250);
  ctx.y -= 28;

  drawField(ctx, "Race Self-Identification", payload.race, MARGIN);
  drawField(ctx, "Ethnicity", payload.ethnicity, MARGIN + 250);
  ctx.y -= 28;

  drawField(ctx, "Household Structure", payload.householdType, MARGIN);
  const assistanceInfo = payload.caseNumber
    ? `${payload.assistanceStatus || "TANF"} (Case: ${payload.caseNumber})`
    : payload.tanfStatus
      ? "TANF Eligible / Recipient"
      : payload.assistanceStatus || "Non-TANF";
  drawField(ctx, "Assistance Status / Case #", assistanceInfo, MARGIN + 250);
  ctx.y -= 28;

  drawField(ctx, "Highest Education Completed", payload.educationalLevel, MARGIN);
  drawField(ctx, "Program Track / Career Cluster", payload.programTrack, MARGIN + 250);
  ctx.y -= 30;

  // --- Section 2: FERPA Authorization to Release Information ---
  drawSectionHeader(ctx, "2. FERPA Disclosure & Consent to Release Educational Records");

  drawParagraph(
    ctx,
    "Pursuant to the Family Educational Rights and Privacy Act (FERPA, 20 U.S.C. § 1232g; 34 CFR Part 99), educational records maintained by the SPOKES program and participating adult education centers are confidential. By submitting this intake, the student authorizes the reciprocal disclosure and exchange of education, attendance, credential attainment, and barrier-mitigation records between the SPOKES Program, the West Virginia Department of Human Services (DoHS / WV Works), WorkForce West Virginia, and authorized instructional personnel. This disclosure is authorized solely for the purpose of verifying program participation, satisfying TANF/WIOA reporting mandates, and coordinating supportive career services.",
  );
  ctx.y -= 6;

  // --- Section 3: Program Policies & Acceptable Use ---
  drawSectionHeader(ctx, "3. Program Participation & Attendance Policy Acknowledgment");

  drawParagraph(
    ctx,
    "The student acknowledges receipt of the SPOKES Student Handbook and agrees to comply with program attendance benchmarks, workplace readiness standards, computer and internet acceptable use policies, and classroom conduct guidelines. Students must notify their instructor prior to any scheduled absence and participate in scheduled goal-setting reviews.",
  );
  ctx.y -= 10;

  // --- Section 4: Electronic Signature Audit Block ---
  drawSectionHeader(ctx, "4. Formal Signature & State Audit Verification Seal");

  const sigBoxHeight = 100;
  checkPage(ctx, sigBoxHeight + 20);

  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - sigBoxHeight,
    width: PAGE_WIDTH - 2 * MARGIN,
    height: sigBoxHeight,
    borderColor: plan.studentAttested ? INK_PRIMARY : INK_WARN,
    borderWidth: 1.5,
    color: plan.studentAttested ? rgb(0.97, 0.99, 1.0) : rgb(1.0, 0.98, 0.94),
  });

  if (plan.studentAttested) {
    ctx.page.drawText(safeText(`Digitally Signed By:  ${plan.signerName}`), {
      x: MARGIN + 14,
      y: ctx.y - 18,
      size: 11,
      font: ctx.bold,
      color: INK_PRIMARY,
    });

    ctx.page.drawText(safeText(`Signature Capture Method: ${plan.methodLabel}`), {
      x: MARGIN + 14,
      y: ctx.y - 32,
      size: 8.5,
      font: ctx.regular,
      color: INK_TEXT,
    });

    ctx.page.drawText(
      safeText(
        `Audit Timestamp: ${plan.signedAt.toISOString()}  |  Source IP: ${plan.sourceIp ?? "not recorded"}`,
      ),
      { x: MARGIN + 14, y: ctx.y - 45, size: 8, font: ctx.regular, color: INK_MUTED },
    );

    ctx.page.drawText(safeText(LEGAL_DECLARATION), {
      x: MARGIN + 14,
      y: ctx.y - 82,
      size: 7,
      font: ctx.regular,
      color: INK_MUTED,
    });
  } else {
    ctx.page.drawText(safeText(UNSIGNED_NOTICE), {
      x: MARGIN + 14,
      y: ctx.y - 18,
      size: 11,
      font: ctx.bold,
      color: INK_WARN,
    });

    ctx.page.drawText(safeText(UNSIGNED_EXPLANATION), {
      x: MARGIN + 14,
      y: ctx.y - 34,
      size: 8,
      font: ctx.regular,
      color: INK_TEXT,
    });

    ctx.page.drawText(
      safeText(
        "Student Signature: _____________________________________   Date: ______________",
      ),
      { x: MARGIN + 14, y: ctx.y - 58, size: 8.5, font: ctx.regular, color: INK_TEXT },
    );
  }

  ctx.page.drawText(safeText(`Verification ID: ${plan.fileUploadId}`), {
    x: MARGIN + 14,
    y: ctx.y - 70,
    size: 7.5,
    font: ctx.regular,
    color: rgb(0.1, 0.4, 0.3),
  });

  // Scannable verification code. It carries a signed, opaque token — the
  // pre-hardening QR carried a hex-encoded copy of the student's own name.
  try {
    if (!plan.verificationToken) throw new Error("no verification token issued");
    const qrPngBuffer = await QRCode.toBuffer(verifyUrlFor(plan.verificationToken), {
      width: 140,
      margin: 1,
      color: { dark: "#004777", light: "#ffffff" },
    });
    const qrImg = await doc.embedPng(qrPngBuffer);
    ctx.page.drawImage(qrImg, {
      x: PAGE_WIDTH - MARGIN - 54,
      y: ctx.y - 70,
      width: 42,
      height: 42,
    });
    ctx.page.drawText(safeText("Scan to Verify"), {
      x: PAGE_WIDTH - MARGIN - 52,
      y: ctx.y - 79,
      size: 6,
      font: ctx.bold,
      color: INK_PRIMARY,
    });
  } catch (e) {
    console.error("Could not generate verification QR code:", e);
  }

  if (plan.studentAttested && plan.signatureImage) {
    try {
      const sigImg = await embedSignatureImage(doc, plan.signatureImage);
      const dims = sigImg.scaleToFit(120, 38);
      ctx.page.drawImage(sigImg, {
        x: PAGE_WIDTH - MARGIN - 64 - dims.width,
        y: ctx.y - 66,
        width: dims.width,
        height: dims.height,
      });
      ctx.page.drawText(safeText("Formal Signature Capture"), {
        x: PAGE_WIDTH - MARGIN - 64 - dims.width,
        y: ctx.y - 76,
        size: 6.5,
        font: ctx.regular,
        color: INK_MUTED,
      });
    } catch (e) {
      console.error("Could not embed signature image into PDF:", e);
    }
  }

  ctx.y -= sigBoxHeight + 12;

  // --- Section 5: Instructor / Agency Verification Counter-Signature ---
  drawSectionHeader(ctx, "5. Instructor & Agency Verification Counter-Signature");

  const staffBoxHeight = 85;
  checkPage(ctx, staffBoxHeight + 20);

  const staff = plan.staff;

  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - staffBoxHeight,
    width: PAGE_WIDTH - 2 * MARGIN,
    height: staffBoxHeight,
    borderColor: staff ? rgb(0.1, 0.55, 0.4) : INK_LINE,
    borderWidth: 1.5,
    color: staff ? rgb(0.96, 0.99, 0.97) : rgb(0.98, 0.98, 0.99),
  });

  if (staff) {
    ctx.page.drawText(safeText("State Verification Clearance: APPROVED & ENROLLED"), {
      x: MARGIN + 14,
      y: ctx.y - 18,
      size: 10.5,
      font: ctx.bold,
      color: rgb(0.08, 0.45, 0.3),
    });

    ctx.page.drawText(safeText(`Authorized Staff Reviewer: ${staff.name}, ${staff.title}`), {
      x: MARGIN + 14,
      y: ctx.y - 34,
      size: 9,
      font: ctx.bold,
      color: INK_TEXT,
    });

    ctx.page.drawText(
      safeText(
        `Official Agency Sign-Off: ${staff.signedAt.toISOString()} | Clearance Status: Active TANF / WIOA Enrolled`,
      ),
      { x: MARGIN + 14, y: ctx.y - 48, size: 8, font: ctx.regular, color: INK_MUTED },
    );

    ctx.page.drawText(
      safeText(
        "Agency Certification: Program eligibility criteria, barrier mitigations, and participation requirements verified.",
      ),
      { x: MARGIN + 14, y: ctx.y - 68, size: 7, font: ctx.regular, color: INK_MUTED },
    );

    if (staff.image) {
      try {
        const staffSigImg = await embedSignatureImage(doc, staff.image);
        const dims = staffSigImg.scaleToFit(120, 36);
        ctx.page.drawImage(staffSigImg, {
          x: PAGE_WIDTH - MARGIN - dims.width - 20,
          y: ctx.y - 58,
          width: dims.width,
          height: dims.height,
        });
        ctx.page.drawText(safeText("Staff Signature Verified"), {
          x: PAGE_WIDTH - MARGIN - 110,
          y: ctx.y - 68,
          size: 6,
          font: ctx.regular,
          color: INK_MUTED,
        });
      } catch (e) {
        console.error("Could not embed staff signature image:", e);
      }
    }
  } else {
    ctx.page.drawText(safeText("State Verification Clearance: PENDING INSTRUCTOR REVIEW"), {
      x: MARGIN + 14,
      y: ctx.y - 18,
      size: 10,
      font: ctx.bold,
      color: INK_WARN,
    });

    ctx.page.drawText(
      safeText(
        "Authorized Instructor Signature: _____________________________________   Date: ______________",
      ),
      { x: MARGIN + 14, y: ctx.y - 45, size: 8.5, font: ctx.regular, color: INK_TEXT },
    );

    ctx.page.drawText(
      safeText(
        "Pending review and counter-signature by assigned SPOKES instructor or regional coordinator.",
      ),
      { x: MARGIN + 14, y: ctx.y - 65, size: 7.5, font: ctx.regular, color: INK_MUTED },
    );
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

// --- Public API -------------------------------------------------------------------

/**
 * Build the official SPOKES intake packet and its attestation record.
 *
 * The packet claims only what `options` proves: the FERPA / E-SIGN declaration
 * appears when the record shows consent plus a signature, and the instructor
 * clearance appears when signed-in staff pass a `staffCounterSignature`. Nothing
 * on the intake payload can produce either.
 *
 * The returned `attestation.digest` is a SHA-256 over the exact bytes returned
 * with it; persist it so a copy can be checked against the archived original
 * later. `attestation.documentId` is what the printed QR code encodes.
 */
export async function createStampedIntakePacket(
  payload: IntakePayload,
  studentIdDisplay: string,
  options: StampedPacketOptions = {},
): Promise<{ buffer: Buffer; attestation: PacketAttestation }> {
  const plan = resolvePacketAttestation(payload, options);

  const templatePath =
    options.templatePath === undefined
      ? path.resolve(process.cwd(), OFFICIAL_TEMPLATE_RELATIVE_PATH)
      : options.templatePath;

  const official = templatePath
    ? await tryFillOfficialStudentProfilePdf(payload, studentIdDisplay, plan, templatePath)
    : null;

  const buffer = official ?? (await renderProceduralPacket(payload, studentIdDisplay, plan));

  return {
    buffer,
    attestation: {
      fileUploadId: plan.fileUploadId,
      verificationToken: plan.verificationToken,
      digest: computePacketDigest(buffer),
      algorithm: PACKET_DIGEST_ALGORITHM,
      signedAt: plan.signedAt,
      sourceIp: plan.sourceIp,
      studentAttested: plan.studentAttested,
      staffCounterSigned: plan.staff !== null,
      reviewerId: plan.staff?.reviewerId ?? null,
    },
  };
}

/**
 * Bytes-only wrapper for call sites that do not persist the attestation.
 *
 * Prefer `createStampedIntakePacket`: without the attestation there is no digest
 * to record, so the packet cannot be verified later.
 */
export async function createStampedIntakePdfBuffer(
  payload: IntakePayload,
  studentIdDisplay: string,
  options: StampedPacketOptions = {},
): Promise<Buffer> {
  const { buffer } = await createStampedIntakePacket(payload, studentIdDisplay, options);
  return buffer;
}

/**
 * Record the digest of the archived bytes.
 *
 * This is what makes the verifier's answer trustworthy: it compares against a
 * digest the program recorded, rather than one the token merely asserts. A
 * failure here is not fatal to issuing the packet, but it is logged, because a
 * packet with no recorded digest can only ever be verified on the issuer's own
 * say-so.
 */
async function recordContentDigest(fileUploadId: string, digest: string): Promise<void> {
  try {
    await prisma.fileUpload.update({
      where: { id: fileUploadId },
      data: { contentDigest: digest },
    });
  } catch (err) {
    logger.warn("Intake packet content digest not persisted", {
      alert: "packet_digest_not_recorded",
      error: String(err),
    });
  }
}

/**
 * Generate the packet, archive it, and synchronize the student's records.
 *
 * The FormSubmission this writes is `pending` unless signed-in staff supplied a
 * counter-signature: generating a document is not reviewing it. Regeneration
 * never rewrites an existing review verdict either — only the archived file
 * pointer moves.
 *
 * Every row written here belongs to `studentDbId`, so the writes run as that
 * student. Public intake provisioning has no session at all, and under `vq_app`
 * an app-client write with no RLS context is rejected (review F5/F62).
 */
export async function saveStampedIntakePacket(
  studentDbId: string,
  studentIdDisplay: string,
  payload: IntakePayload,
  options: StampedPacketOptions = {},
): Promise<{ fileUploadId: string; storageKey: string; attestation: PacketAttestation }> {
  const { buffer, attestation } = await createStampedIntakePacket(payload, studentIdDisplay, {
    ...options,
    fileUploadId: options.fileUploadId ?? createPacketFileUploadId(),
  });

  // The FileUpload id is minted before rendering because the printed QR token
  // binds it, so the row has to be filed under the id the packet already shows.
  const fileUploadId = attestation.fileUploadId;
  const storageKey = `orientation/${studentDbId}/intake-packet-${fileUploadId}.pdf`;
  const filename = `Official_Intake_Packet_${studentIdDisplay}.pdf`;

  await uploadFile(storageKey, buffer, "application/pdf");

  return withStudentRlsContext(studentDbId, async () => {
    const fileUpload = await prisma.fileUpload.create({
      data: {
        id: fileUploadId,
        studentId: studentDbId,
        filename,
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
        storageKey,
        category: "orientation",
        gist: attestation.staffCounterSigned
          ? "SPOKES intake and policy packet, counter-signed by program staff."
          : "SPOKES intake and policy packet, pending staff review.",
        gistMethod: "none",
      },
    });

    await recordContentDigest(fileUpload.id, attestation.digest);

    try {
      const reviewFields = attestation.staffCounterSigned
        ? {
            status: "approved",
            reviewedBy: attestation.reviewerId,
            reviewedAt: new Date(),
            notes: `Counter-signed SPOKES intake packet (verification ${fileUploadId}).`,
          }
        : null;

      await prisma.formSubmission.upsert({
        where: {
          studentId_formId: {
            studentId: studentDbId,
            formId: "orientation-intake",
          },
        },
        // Without a counter-signature this is a regeneration, not a review: move
        // the file pointer and leave the existing verdict where staff left it.
        update: reviewFields
          ? { fileId: fileUpload.id, ...reviewFields }
          : { fileId: fileUpload.id },
        create: {
          studentId: studentDbId,
          formId: "orientation-intake",
          fileId: fileUpload.id,
          status: reviewFields?.status ?? "pending",
          reviewedBy: reviewFields?.reviewedBy ?? null,
          reviewedAt: reviewFields?.reviewedAt ?? null,
          notes:
            reviewFields?.notes ??
            `Self-submitted SPOKES intake packet, pending staff review (verification ${fileUploadId}).`,
        },
      });
    } catch {
      // best-effort FormSubmission synchronization
    }

    const answers = {
      first_name: payload.firstName,
      last_name: payload.lastName,
      birth_date: payload.birthDate,
      county: payload.county,
      household_type: payload.householdType,
      gender: payload.gender,
      race: payload.race,
      ethnicity: payload.ethnicity,
      educational_level: payload.educationalLevel,
      contact_email: payload.email,
      phone: payload.phone,
      tanf_status: payload.tanfStatus,
      program_track: payload.programTrack,
      notes: payload.notes,
    };

    try {
      await prisma.formResponse.upsert({
        where: {
          templateId_studentId: {
            templateId: "seed-form-student-profile",
            studentId: studentDbId,
          },
        },
        update: {
          status: "submitted",
          submittedAt: new Date(),
          answers,
        },
        create: {
          templateId: "seed-form-student-profile",
          studentId: studentDbId,
          status: "submitted",
          submittedAt: new Date(),
          answers,
        },
      });
    } catch {
      // best-effort FormResponse synchronization
    }

    return {
      fileUploadId: fileUpload.id,
      storageKey,
      attestation,
    };
  });
}
