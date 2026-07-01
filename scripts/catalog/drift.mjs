#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { loadEnvFile } from "../lib/sage-rag-utils.mjs";

loadEnvFile();

async function main() {
  const { parseCatalogNode } = await import("../../src/lib/catalog/parse.ts");
  const { findNoteDrift } = await import("../../src/lib/catalog/drift-audit.ts");
  const load = (dir) => (existsSync(`catalog/${dir}`) ? readdirSync(`catalog/${dir}`) : [])
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => parseCatalogNode(readFileSync(`catalog/${dir}/${f}`, "utf8"), `catalog/${dir}/${f}`));
  const nodes = [...load("forms"), ...load("documents")].filter((n) => n.frontmatter.vq_status === "approved");
  const keys = [...new Set(nodes.map((n) => n.frontmatter.vq_storage_key).filter(Boolean))];
  if (!keys.length) { console.log("No approved nodes with storageKeys; nothing to audit."); return; }
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const rows = await prisma.programDocument.findMany({ where: { storageKey: { in: keys } }, select: { id: true, storageKey: true, sageContextNote: true } });
  await prisma.$disconnect();
  const findings = findNoteDrift(nodes, rows);
  if (findings.length) {
    for (const f of findings) console.error(`[drift] ${f.storageKey}: DB note diverges from catalog`);
    console.error(`\n${findings.length} drift finding(s).`);
    process.exit(1);
  }
  console.log(`No drift: ${nodes.length} approved nodes; DB notes match catalog.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
