#!/usr/bin/env node
/** Prepare an auditable source snapshot, then apply its AI-only passage index.
 * tsx scripts/reindex-ai-corpus.mjs --prepare=/private/tmp/corpus
 * tsx scripts/reindex-ai-corpus.mjs --apply=/private/tmp/corpus
 * Source bytes, extracted text and rollback vectors stay outside the repo.
 * OCR runs locally; only approved, PII-screened program text is embedded.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";

loadEnvFile();
const args = parseArgs();
const prisma = new PrismaClient();
const hash = (value, algorithm = "sha256") => createHash(algorithm).update(value).digest("hex");
const identity = (doc) => JSON.stringify([doc.id, doc.title, doc.storageKey, doc.sageContextNote, doc.audience, doc.etag]);
const root = path.resolve(String(args.prepare || args.apply || ""));

async function documents() {
  return prisma.$queryRaw`
    SELECT d.id, d.title, d."storageKey", d."sageContextNote", d.audience,
           o.metadata->>'eTag' AS etag
    FROM visionquest."ProgramDocument" d
    JOIN storage.objects o ON o.bucket_id = 'Uploads' AND o.name = d."storageKey"
    WHERE d."isActive" AND d."usedBySage" ORDER BY d."storageKey"
  `;
}

async function main() {
  if ((!args.prepare && !args.apply) || (args.prepare && args.apply) || root.startsWith(process.cwd() + path.sep) || root === process.cwd())
    throw new Error("Choose --prepare or --apply with a private directory outside the repository");
  const { extractPagesFromBuffer, containsPII } = await import("../src/lib/sage/extract.ts");
  const { cleanPassageText } = await import("../src/lib/sage/passage-text.ts");
  const { chunkPages } = await import("../src/lib/sage/chunking.ts");

  if (args.prepare) {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const ocrBinary = path.join(root, "ocr-source");
    execFileSync("swiftc", ["scripts/ocr-program-source.swift", "-O", "-o", ocrBinary], { timeout: 120000 });
    const client = new S3Client({ region: process.env.STORAGE_REGION, endpoint: process.env.STORAGE_ENDPOINT, forcePathStyle: true,
      credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY, secretAccessKey: process.env.STORAGE_SECRET_KEY } });
    const docs = await documents();
    const count = await prisma.programDocument.count({ where: { usedBySage: true, isActive: true } });
    if (docs.length !== count) throw new Error("An enabled source is missing from Storage metadata");
    let previous = [];
    try { previous = JSON.parse(await fs.readFile(path.join(root, "prepared.json"), "utf8")).documents; } catch { /* first preparation */ }
    const prepared = [];
    for (const doc of docs) {
      const saved = previous.find((p) => p.id === doc.id && p.identity === hash(identity(doc)));
      if (saved && hash(await fs.readFile(saved.sourcePath)) === saved.sourceHash) {
        prepared.push(saved);
        continue;
      }
      const ext = path.extname(doc.storageKey).toLowerCase();
      const sourcePath = path.join(root, doc.id + ext);
      const response = await client.send(new GetObjectCommand({ Bucket: "Uploads", Key: doc.storageKey }));
      const buffer = Buffer.from(await response.Body.transformToByteArray());
      const etag = (doc.etag ?? "").replaceAll('"', "");
      if (!/^[a-f0-9]{32}$/i.test(etag) || hash(buffer, "md5") !== etag.toLowerCase()) throw new Error("Source checksum verification failed: " + doc.id);
      await fs.writeFile(sourcePath, buffer, { mode: 0o600 });
      const native = await extractPagesFromBuffer(buffer, ext);
      let pages = (native?.pages ?? []).map((p) => ({ ...p, extractionMethod: "text" }));
      let ocr = [];
      if (ext === ".pdf") {
        // PDFKit determines total page count even for fully scanned PDFs.
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        let total;
        try { total = (await parser.getInfo()).total; } finally { await parser.destroy(); }
        const missing = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !pages.some((p) => p.pageNumber === n));
        if (missing.length) ocr = JSON.parse(execFileSync(ocrBinary, [sourcePath, missing.join(",")], { encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 }));
      } else if ([".png", ".jpg", ".jpeg"].includes(ext)) {
        ocr = JSON.parse(execFileSync(ocrBinary, [sourcePath], { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 }));
      }
      const uncertain = ocr.filter((p) => cleanPassageText(p.text) && p.meanConfidence < 0.8);
      pages.push(...ocr.map((p) => ({ pageNumber: p.pageNumber ?? null, text: cleanPassageText(p.text), extractionMethod: "ocr", meanConfidence: p.meanConfidence })).filter((p) => p.text));
      pages.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));
      const piiDetected = containsPII(pages.map((p) => p.text).join("\n"));
      const entry = { ...doc, identity: hash(identity(doc)), sourceHash: hash(buffer), sourcePath,
        pages, piiDetected, estimatedChunks: chunkPages(pages).length,
        status: piiDetected ? "pii_review_required" : uncertain.length ? "ocr_review_required" : pages.length ? "ready" : "summary_only" };
      prepared.push(entry);
      await fs.writeFile(path.join(root, "prepared.json"), JSON.stringify({ preparedAt: new Date().toISOString(), documents: prepared }, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ prepared: prepared.length, total: docs.length, sourceKey: doc.storageKey, pages: pages.length, ocrPages: ocr.length, status: entry.status, chunks: entry.estimatedChunks }));
    }
    client.destroy();
  } else {
    const preparedText = await fs.readFile(path.join(root, "prepared.json"), "utf8");
    const manifest = JSON.parse(preparedText);
    const docs = await documents();
    if (docs.length !== manifest.documents.length || docs.some((d) => !manifest.documents.some((p) => p.id === d.id && p.identity === hash(identity(d)))))
      throw new Error("Enabled corpus or source version changed after preparation");
    if (manifest.documents.some((d) => ["pii_review_required", "ocr_review_required"].includes(d.status))) throw new Error("Source screening requires review before applying this corpus");
    for (const doc of manifest.documents) {
      if (hash(await fs.readFile(doc.sourcePath)) !== doc.sourceHash) throw new Error("Prepared source changed: " + doc.id);
    }
    const backup = {
      createdAt: new Date().toISOString(),
      preparedChecksum: hash(preparedText),
      documents: await prisma.$queryRaw`SELECT d.id, d.embedding::text, d."embeddingModel" FROM visionquest."ProgramDocument" d WHERE d."usedBySage" AND d."isActive"`,
      chunks: await prisma.$queryRaw`SELECT c.id,c."documentId",c."chunkIndex",c.content,c.embedding::text,c."embeddingModel",c."tokenCount",c."pageNumber",c."sectionTitle",c."extractionMethod",c."createdAt",c."updatedAt" FROM visionquest."DocumentChunk" c JOIN visionquest."ProgramDocument" d ON d.id=c."documentId" WHERE d."usedBySage" AND d."isActive"`,
    };
    try {
      await fs.writeFile(path.join(root, "index-before.json"), JSON.stringify(backup), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const previous = JSON.parse(await fs.readFile(path.join(root, "index-before.json"), "utf8"));
      if (previous.preparedChecksum !== hash(preparedText)) throw new Error("Prepared snapshot differs from the existing rollback backup");
    }
    const { embedProgramDocument } = await import("../src/lib/sage/document-embedding.ts");
    const results = [];
    for (const doc of manifest.documents) {
      const result = await embedProgramDocument(doc.id, { title: doc.title, sageContextNote: doc.sageContextNote, pages: doc.pages,
        usage: { studentId: null, callSite: "sage_program_corpus_repair" } });
      results.push({ id: doc.id, sourceKey: doc.storageKey, sourceHash: doc.sourceHash, chunks: result.chunkCount,
        nativePages: doc.pages.filter((p) => p.extractionMethod === "text").length,
        ocrPages: doc.pages.filter((p) => p.extractionMethod === "ocr").length, status: doc.status });
      await fs.writeFile(path.join(root, "applied.json"), JSON.stringify({ appliedAt: new Date().toISOString(), documents: results }, null, 2));
      console.log(JSON.stringify({ completed: results.length, total: manifest.documents.length, ...results.at(-1) }));
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
