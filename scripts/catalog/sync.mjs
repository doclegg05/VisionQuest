#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "../lib/sage-rag-utils.mjs";

loadEnvFile();

async function main() {
  const apply = process.argv.includes("--apply");
  const { parseCatalogNode } = await import("../../src/lib/catalog/parse.ts");
  const { buildFormRoutingOverlay, buildDocSyncManifest } = await import("../../src/lib/catalog/sync.ts");

  const load = (dir) => (existsSync(`catalog/${dir}`) ? readdirSync(`catalog/${dir}`) : [])
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => parseCatalogNode(readFileSync(`catalog/${dir}/${f}`, "utf8"), `catalog/${dir}/${f}`));

  const formNodes = load("forms").filter((n) => n.frontmatter.vq_status === "approved");
  const allNodes = [...formNodes, ...load("documents").filter((n) => n.frontmatter.vq_status === "approved")];

  const overlay = buildFormRoutingOverlay(formNodes);
  console.log(`FORM OVERLAY: ${Object.keys(overlay.entries).length} entries`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const keys = [...new Set(allNodes.map((n) => n.frontmatter.vq_storage_key).filter(Boolean))];
  const rows = keys.length ? await prisma.programDocument.findMany({ where: { storageKey: { in: keys } }, select: { id: true, storageKey: true } }) : [];
  const byKey = new Map(rows.map((r) => [r.storageKey, { id: r.id }]));
  const manifest = buildDocSyncManifest(allNodes, byKey);

  console.log(`DOC NOTE UPDATES (incl. forms that are program docs): ${manifest.length}`);
  for (const u of manifest) console.log(`  ${u.storageKey} -> note(${u.newNote.length} chars)`);
  const noMatch = allNodes.filter((n) => n.frontmatter.vq_storage_key && !byKey.has(n.frontmatter.vq_storage_key));
  if (noMatch.length) {
    console.log(`  (${noMatch.length} approved nodes carry a storageKey with NO ProgramDocument — overlay-only, no doc note):`);
    for (const n of noMatch) console.log(`    - ${n.frontmatter.vq_id} (${n.frontmatter.vq_storage_key})`);
  }

  if (!apply) { console.log("\nDRY RUN. Re-run with --apply to write the overlay + re-embed notes."); await prisma.$disconnect(); return; }

  // ---- APPLY (controller-gated; do NOT run in this task) ----
  writeFileSync("config/form-routing.generated.json", JSON.stringify(overlay, null, 2) + "\n");
  const { embedProgramDocument } = await import("../../src/lib/sage/document-embedding.ts");
  const { extractPagesFromBuffer, containsPII } = await import("../../src/lib/sage/extract.ts");
  const { downloadBundledFile } = await import("../../src/lib/storage.ts");
  const { invalidatePrefix } = await import("../../src/lib/cache.ts");
  let applied = 0;
  for (const u of manifest) {
    try {
      const doc = await prisma.programDocument.findUnique({ where: { id: u.docId }, select: { title: true, storageKey: true } });
      if (!doc) { console.warn(`  SKIP ${u.storageKey}: doc not found`); continue; }
      const dl = await downloadBundledFile(doc.storageKey);
      if (!dl) { console.warn(`  SKIP ${u.storageKey}: source bytes unavailable (left unchanged)`); continue; }
      const ext = doc.storageKey.slice(doc.storageKey.lastIndexOf("."));
      const extracted = await extractPagesFromBuffer(dl.buffer, ext);
      const pages = extracted?.pages ?? [];
      const bodyText = pages.map((p) => p.text).join("\n");
      if (bodyText && containsPII(bodyText)) { console.warn(`  SKIP ${u.storageKey}: PII detected in body — handle manually`); continue; }
      await embedProgramDocument(u.docId, { title: doc.title, sageContextNote: u.newNote, pages });
      await prisma.programDocument.update({ where: { id: u.docId }, data: { sageContextNote: u.newNote } });
      applied++;
    } catch (e) { console.error(`  FAILED ${u.storageKey}: ${e.message} (left unchanged)`); }
  }
  invalidatePrefix("sage:documents");
  await prisma.$disconnect();
  console.log(`Applied ${applied}/${manifest.length} doc updates; overlay written; cache invalidated.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
