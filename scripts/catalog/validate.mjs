#!/usr/bin/env node
// Validates catalog/** nodes for structural + parity correctness.
//
// DB dependency: ONLY the `program_document` node type needs a live DB, to
// fetch ProgramDocument rows (title/audience/category/storageKey) as the
// source of truth to diff against. Every other check — form-vs-forms.ts
// parity, certification/platform nodes, required-field checks, cross-link
// integrity, and allowlist reverse-parity for forms/certs/platforms — reads
// only the filesystem + config/catalog-allowlist.json and needs no DB.
//
// --no-db (or no DATABASE_URL in the environment) skips the DB-dependent
// program_document checks with a printed notice instead of silently passing;
// every DB-free check above still runs and still gates on failure. This lets
// CI run the DB-free portion as a hard gate even when a live DB isn't
// wired up, without ever silently skipping the entire validation.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { loadEnvFile } from "../lib/sage-rag-utils.mjs";

loadEnvFile();

async function main() {
  const noDb = process.argv.includes("--no-db") || !process.env.DATABASE_URL;
  const allow = JSON.parse(readFileSync("config/catalog-allowlist.json", "utf8"));
  const { getFormById } = await import("../../src/lib/spokes/forms.ts");
  const { parseCatalogNode } = await import("../../src/lib/catalog/parse.ts");
  const { mapFormAudience, slugifyStorageKey } = await import("../../src/lib/catalog/generate.ts");
  const { validateNode } = await import("../../src/lib/catalog/validate.ts");

  const dirs = ["forms", "documents", "certifications", "platforms"];
  const nodes = [];
  const existingNodePaths = new Set();
  for (const d of dirs) {
    if (!existsSync(`catalog/${d}`)) continue;
    for (const f of readdirSync(`catalog/${d}`).filter((x) => x.endsWith(".md") && x !== "index.md")) {
      const fp = `catalog/${d}/${f}`;
      existingNodePaths.add(fp);
      nodes.push(parseCatalogNode(readFileSync(fp, "utf8"), fp));
    }
  }

  const docKeys = allow.documents ?? [];
  let docByKey = new Map();
  const skippedNotices = [];
  if (docKeys.length && !noDb) {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const rows = await prisma.programDocument.findMany({
      where: { storageKey: { in: docKeys } },
      select: { title: true, storageKey: true, category: true, audience: true, certificationId: true, platformId: true },
    });
    await prisma.$disconnect();
    docByKey = new Map(rows.map((r) => [r.storageKey, r]));
  } else if (docKeys.length && noDb) {
    skippedNotices.push(
      `program_document parity + reverse-parity for ${docKeys.length} allowlisted document(s) SKIPPED — no DATABASE_URL (or --no-db passed)`,
    );
  }

  const docSlugs = docKeys.map(slugifyStorageKey);
  const allowlistIds = [
    ...(allow.forms ?? []),
    ...docSlugs,
    ...(allow.certifications ?? []).map((c) => c.id),
    ...(allow.platforms ?? []).map((p) => p.id),
  ];
  const ctx = { existingNodePaths, allowlistIds };

  const errors = [];
  for (const node of nodes) {
    const t = node.frontmatter.type;
    let expected;
    if (t === "form") {
      const form = getFormById(node.frontmatter.vq_id);
      if (!form) { errors.push({ filePath: node.filePath, rule: "parity", message: "no source form in forms.ts" }); continue; }
      expected = { type: "form", title: form.title, vq_audience: mapFormAudience(form.audience), vq_category: form.category, vq_storage_key: form.storageKey ?? undefined };
    } else if (t === "program_document") {
      if (noDb) continue; // DB-dependent check skipped — see skippedNotices notice above.
      const doc = docByKey.get(node.frontmatter.vq_storage_key);
      if (!doc) { errors.push({ filePath: node.filePath, rule: "parity", message: "no source ProgramDocument for storageKey" }); continue; }
      expected = { type: "program_document", title: doc.title, vq_audience: doc.audience, vq_category: doc.category, vq_storage_key: doc.storageKey, vq_certification: doc.certificationId ?? undefined, vq_platform: doc.platformId ?? undefined };
    } else {
      expected = { type: t, title: node.frontmatter.title, vq_audience: node.frontmatter.vq_audience, vq_category: node.frontmatter.vq_category };
    }
    errors.push(...validateNode(node, expected, ctx));
  }

  // Reverse parity: every allowlisted item has a node. (Forms/certs/platforms
  // are DB-free — sourced from forms.ts and the allowlist itself — so these
  // always run. Only the `documents` reverse-parity needs DB, since matching
  // storage keys to ProgramDocument rows requires the DB fetch above.)
  for (const id of allow.forms ?? []) if (!existingNodePaths.has(`catalog/forms/${id}.md`)) errors.push({ filePath: `catalog/forms/${id}.md`, rule: "parity", message: "allowlisted form has no node" });
  if (!noDb) {
    for (const key of docKeys) { const slug = slugifyStorageKey(key); if (!existingNodePaths.has(`catalog/documents/${slug}.md`)) errors.push({ filePath: `catalog/documents/${slug}.md`, rule: "parity", message: `allowlisted document has no node: ${key}` }); }
  }
  for (const c of allow.certifications ?? []) if (!existingNodePaths.has(`catalog/certifications/${c.id}.md`)) errors.push({ filePath: `catalog/certifications/${c.id}.md`, rule: "parity", message: "allowlisted cert has no node" });
  for (const p of allow.platforms ?? []) if (!existingNodePaths.has(`catalog/platforms/${p.id}.md`)) errors.push({ filePath: `catalog/platforms/${p.id}.md`, rule: "parity", message: "allowlisted platform has no node" });

  for (const notice of skippedNotices) console.log(`::notice::catalog:validate — ${notice}`);

  if (errors.length) {
    for (const e of errors) console.error(`[${e.rule}] ${e.filePath}: ${e.message}`);
    console.error(`\n${errors.length} validation error(s).`);
    process.exit(1);
  }
  const skippedCount = noDb ? nodes.filter((n) => n.frontmatter.type === "program_document").length : 0;
  console.log(`Catalog valid: ${nodes.length - skippedCount} node(s) checked, ${skippedCount} program_document node(s) skipped (no DB), 0 errors.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
