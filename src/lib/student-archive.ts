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

interface ArchiveManifest {
  studentId: string;
  displayName: string;
  archivedAt: string;
  archivedBy: string;
  fileCount: number;
  entries: ArchiveManifestEntry[];
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
          events: {
            orderBy: { at: "asc" },
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
  };

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
  if (student.connections.length > 0) {
    // The frozen packet's `includedFields` is what the student approved and
    // what the employer page actually rendered, so it is the honest answer to
    // "what was shared". The rest of the packet is not repeated here — the
    // resume and cover letter are already in the archive as their own files.
    const disclosures = student.connections.map((connection) => {
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

  // 8. Add manifest
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  await archive.finalize();

  // Wait for stream to finish
  await new Promise<void>((resolve, reject) => {
    bufferStream.on("finish", resolve);
    bufferStream.on("error", reject);
  });

  const zipBuffer = Buffer.concat(chunks);
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
