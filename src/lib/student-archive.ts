import archiver from "archiver";
import { Writable } from "stream";
import { prisma } from "./db";
import { downloadFile, uploadFile } from "./storage";
import { FORMS } from "./spokes/forms";
import { logger } from "./logger";

const FORM_BY_ID = new Map(FORMS.map((f) => [f.id, f]));

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

      const archivePath = `${folder}/${fileRecord.filename}`;
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
  const alreadyArchived = new Set(manifest.entries.map((e) => e.path));
  for (const file of student.files) {
    if (file.category === "resume" || file.category === "general") {
      const archivePath = `files/${file.filename}`;
      if (!alreadyArchived.has(archivePath)) {
        try {
          const result = await downloadFile(file.storageKey);
          if (result) {
            archive.append(result.buffer, { name: archivePath });
            manifest.entries.push({ path: archivePath, type: file.category });
            manifest.fileCount++;
          }
        } catch {
          // Skip files that fail to download
        }
      }
    }
  }

  // 5. Resume data as JSON
  if (student.resumeData?.data) {
    archive.append(student.resumeData.data, { name: "resume/resume-data.json" });
    manifest.entries.push({ path: "resume/resume-data.json", type: "resume_data" });
    manifest.fileCount++;
  }

  // 6. Add manifest
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
    studentId,
    fileCount: manifest.fileCount,
    archiveSize: zipBuffer.length,
    storageKey,
  });

  return { storageKey, fileCount: manifest.fileCount };
}
