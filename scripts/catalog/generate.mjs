#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import matter from "gray-matter";
import { loadEnvFile } from "../lib/sage-rag-utils.mjs";

loadEnvFile();

async function main() {
  const allow = JSON.parse(readFileSync("config/catalog-allowlist.json", "utf8"));
  const { getFormById } = await import("../../src/lib/spokes/forms.ts");
  const { buildFormNodeMarkdown, buildProgramDocNodeMarkdown, buildTaxonomyNodeMarkdown, slugifyStorageKey } =
    await import("../../src/lib/catalog/generate.ts");
  const today = new Date().toISOString().slice(0, 10);
  const HARD = ["type","title","resource","vq_id","vq_audience","vq_category","vq_certification","vq_platform","vq_storage_key"];

  // Existing node: refresh ONLY hard identity; preserve curated soft fields + body. New node: full skeleton.
  const writeNode = (path, markdown) => {
    mkdirSync(dirname(path), { recursive: true });
    const fresh = matter(markdown);
    if (existsSync(path)) {
      const cur = matter(readFileSync(path, "utf8"));
      const merged = { ...cur.data };
      for (const k of HARD) { if (fresh.data[k] !== undefined) merged[k] = fresh.data[k]; else delete merged[k]; }
      writeFileSync(path, matter.stringify(cur.content, merged));
      return;
    }
    writeFileSync(path, matter.stringify(fresh.content, { ...fresh.data, timestamp: today }));
  };

  for (const id of allow.forms ?? []) {
    const form = getFormById(id);
    if (!form) throw new Error(`Allowlist form id not found in forms.ts: ${id}`);
    writeNode(`catalog/forms/${id}.md`, buildFormNodeMarkdown(form));
  }

  const docKeys = allow.documents ?? [];
  if (docKeys.length) {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const rows = await prisma.programDocument.findMany({
      where: { storageKey: { in: docKeys } },
      select: { title: true, storageKey: true, category: true, audience: true, certificationId: true, platformId: true },
    });
    await prisma.$disconnect();
    const found = new Set(rows.map((r) => r.storageKey));
    for (const k of docKeys) if (!found.has(k)) console.warn(`WARN: allowlist document not found in DB (skipped): ${k}`);
    for (const doc of rows) writeNode(`catalog/documents/${slugifyStorageKey(doc.storageKey)}.md`, buildProgramDocNodeMarkdown(doc));
  }

  for (const c of allow.certifications ?? []) writeNode(`catalog/certifications/${c.id}.md`, buildTaxonomyNodeMarkdown("certification", c.id, c.title));
  for (const p of allow.platforms ?? []) writeNode(`catalog/platforms/${p.id}.md`, buildTaxonomyNodeMarkdown("platform", p.id, p.title));

  for (const dir of ["forms","documents","certifications","platforms"]) {
    const files = existsSync(`catalog/${dir}`) ? readdirSync(`catalog/${dir}`).filter((f) => f.endsWith(".md") && f !== "index.md") : [];
    writeFileSync(`catalog/${dir}/index.md`, `# ${dir}\n\n${files.map((f) => `- [${f.replace(/\.md$/, "")}](./${f})`).join("\n")}\n`);
  }
  console.log(`Generated: ${(allow.forms ?? []).length} forms, ${docKeys.length} documents, ${(allow.certifications ?? []).length} certs, ${(allow.platforms ?? []).length} platforms.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
