#!/usr/bin/env node

/**
 * Run the top student RAG questions against the same getDocumentContext()
 * function used by Sage chat.
 *
 * Relevance checks are source-based when the fixture includes
 * expectedStorageKeys / acceptableStorageKeys:
 *   - top1Expected: the first retrieved doc is expected
 *   - top3Expected: any retrieved doc is expected
 *   - unexpectedTop3: retrieved docs outside the acceptable set
 *
 * Usage:
 *   npm run sage:rag:harness
 *   npm run sage:rag:harness -- --strict
 *   npm run sage:rag:harness -- --strict-clean
 *   npm run sage:rag:harness -- --json --out=.planning/sage-rag/harness.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  ensureParentDir,
  loadEnvFile,
  parseArgs,
} from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const args = parseArgs();
const prisma = new PrismaClient();
const fixturePath = args.fixture || "config/sage-rag-top-questions.json";
const role = args.role === "staff" ? "staff" : "student";
const maxResults = args.maxResults ? Number(args.maxResults) : 3;
const tokenBudgetChars = args.tokenBudgetChars ? Number(args.tokenBudgetChars) : 6000;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(values)];
}

function parseDocumentRefs(context) {
  const refs = [];
  const pattern =
    /^\[([^\]]+)\]\nLink: \/api\/documents\/download\?id=([^&\n]+)&mode=view/gm;
  let match;
  while ((match = pattern.exec(context)) !== null) {
    refs.push({ title: match[1], id: decodeURIComponent(match[2]) });
  }
  return refs;
}

function includesAny(contextLower, terms) {
  return terms.some((term) => contextLower.includes(term.toLowerCase()));
}

function compactDoc(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    title: doc.title,
    storageKey: doc.storageKey,
    category: doc.category,
    audience: doc.audience,
    usedBySage: doc.usedBySage,
  };
}

async function loadDocumentsByIds(ids) {
  if (ids.length === 0) return new Map();
  const docs = await prisma.programDocument.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      storageKey: true,
      category: true,
      audience: true,
      usedBySage: true,
    },
  });
  return new Map(docs.map((doc) => [doc.id, doc]));
}

async function loadDocumentsByStorageKeys(storageKeys) {
  if (storageKeys.length === 0) return new Map();
  const docs = await prisma.programDocument.findMany({
    where: { storageKey: { in: storageKeys } },
    select: {
      id: true,
      title: true,
      storageKey: true,
      category: true,
      audience: true,
      usedBySage: true,
    },
  });
  return new Map(docs.map((doc) => [doc.storageKey, doc]));
}

async function main() {
  const questions = JSON.parse(readFileSync(fixturePath, "utf8"));
  const expectationKeys = unique(
    questions.flatMap((item) => [
      ...asArray(item.expectedStorageKeys),
      ...asArray(item.acceptableStorageKeys),
    ]),
  );
  const docsByStorageKey = await loadDocumentsByStorageKeys(expectationKeys);
  const missingExpectationKeys = expectationKeys.filter((key) => !docsByStorageKey.has(key));
  const { getDocumentContext } = await import("../src/lib/sage/knowledge-base-server.ts");

  const results = [];
  for (const item of questions) {
    const context = await getDocumentContext(
      item.question,
      role,
      maxResults,
      tokenBudgetChars,
    );
    const contextLower = context.toLowerCase();
    const matchedRefs = parseDocumentRefs(context);
    const matchedIds = unique(matchedRefs.map((ref) => ref.id));
    const docsById = await loadDocumentsByIds(matchedIds);
    const matchedDocuments = matchedRefs.map((ref) => {
      const doc = docsById.get(ref.id);
      return {
        id: ref.id,
        title: doc?.title ?? ref.title,
        storageKey: doc?.storageKey ?? null,
        category: doc?.category ?? null,
        audience: doc?.audience ?? null,
        usedBySage: doc?.usedBySage ?? null,
      };
    });

    const expectedStorageKeys = asArray(item.expectedStorageKeys);
    const acceptableStorageKeys = unique([
      ...expectedStorageKeys,
      ...asArray(item.acceptableStorageKeys),
    ]);
    const expectedSet = new Set(expectedStorageKeys);
    const acceptableSet = new Set(acceptableStorageKeys);
    const hasExpectations = expectedSet.size > 0;

    const top1 = matchedDocuments[0] ?? null;
    const top1Expected = hasExpectations
      ? Boolean(top1?.storageKey && expectedSet.has(top1.storageKey))
      : null;
    const top3Expected = hasExpectations
      ? matchedDocuments.some((doc) => doc.storageKey && expectedSet.has(doc.storageKey))
      : null;
    const unexpectedTop3 = hasExpectations
      ? matchedDocuments
          .filter((doc) => !doc.storageKey || !acceptableSet.has(doc.storageKey))
          .map(compactDoc)
      : [];
    const cleanTop3 = hasExpectations ? unexpectedTop3.length === 0 : null;

    const hasContext = context.trim().length > 0;
    const matchedExpectedTerm = includesAny(contextLower, item.expectedTerms || []);
    const legacyPassed = hasContext && matchedExpectedTerm;
    const relevancePassed = hasExpectations ? top3Expected : null;
    const strictPassed = legacyPassed && (relevancePassed !== false);
    const strictCleanPassed = strictPassed && (cleanTop3 !== false);

    results.push({
      id: item.id,
      question: item.question,
      hasContext,
      matchedExpectedTerm,
      legacyPassed,
      relevancePassed,
      strictPassed,
      strictCleanPassed,
      top1Expected,
      top3Expected,
      cleanTop3,
      unexpectedTop3,
      documentContextChars: context.length,
      matchedTitles: matchedDocuments.map((doc) => doc.title),
      matchedDocuments: matchedDocuments.map(compactDoc),
      expectedTerms: item.expectedTerms || [],
      expectedStorageKeys,
      acceptableStorageKeys,
    });
  }

  const legacyPassed = results.filter((result) => result.legacyPassed).length;
  const strictPassed = results.filter((result) => result.strictPassed).length;
  const strictCleanPassed = results.filter((result) => result.strictCleanPassed).length;
  const expectedResults = results.filter((result) => result.expectedStorageKeys.length > 0);
  const top1Expected = expectedResults.filter((result) => result.top1Expected).length;
  const top3Expected = expectedResults.filter((result) => result.top3Expected).length;
  const cleanTop3 = expectedResults.filter((result) => result.cleanTop3).length;
  const unexpectedTop3Docs = expectedResults.reduce(
    (sum, result) => sum + result.unexpectedTop3.length,
    0,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    fixturePath,
    role,
    maxResults,
    tokenBudgetChars,
    legacyPassed,
    strictPassed,
    strictCleanPassed,
    total: results.length,
    expectedChecks: expectedResults.length,
    passRate: results.length ? strictPassed / results.length : 0,
    top1Expected,
    top3Expected,
    cleanTop3,
    unexpectedTop3Docs,
    missingExpectationKeys,
    results,
  };

  if (args.out) {
    ensureParentDir(args.out);
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("\nVisionQuest Sage RAG Harness");
    console.log(`Fixture: ${fixturePath}`);
    console.log(`Role: ${role}`);
    console.log(`Legacy term/context pass: ${legacyPassed}/${results.length}`);
    console.log(`Strict top-3 source pass: ${strictPassed}/${results.length}`);
    console.log(`Top-1 expected: ${top1Expected}/${expectedResults.length}`);
    console.log(`Top-3 contains expected: ${top3Expected}/${expectedResults.length}`);
    console.log(`Clean top-3: ${cleanTop3}/${expectedResults.length}`);
    console.log(`Unexpected top-3 docs: ${unexpectedTop3Docs}`);

    if (missingExpectationKeys.length > 0) {
      console.log("\nMissing fixture storage keys:");
      for (const key of missingExpectationKeys) {
        console.log(`  ${key}`);
      }
    }

    for (const result of results) {
      const mark = result.strictPassed ? "PASS" : "MISS";
      console.log(`\n${mark} ${result.id}: ${result.question}`);
      console.log(`  context chars: ${result.documentContextChars}`);
      console.log(`  expected term matched: ${result.matchedExpectedTerm}`);
      console.log(`  top-1 expected: ${result.top1Expected}`);
      console.log(`  top-3 expected: ${result.top3Expected}`);
      console.log(`  clean top-3: ${result.cleanTop3}`);
      console.log(
        `  docs: ${result.matchedDocuments
          .map((doc) => `${doc.title} (${doc.storageKey ?? "unknown"})`)
          .join("; ") || "(none)"}`,
      );
      if (result.unexpectedTop3.length > 0) {
        console.log(
          `  unexpected: ${result.unexpectedTop3
            .map((doc) => `${doc.title} (${doc.storageKey ?? "unknown"})`)
            .join("; ")}`,
        );
      }
    }

    if (args.out) {
      console.log(`\nWrote JSON report: ${args.out}`);
    }
  }

  if (args.strict && strictPassed !== results.length) {
    process.exitCode = 1;
  }
  if (args["strict-clean"] && strictCleanPassed !== results.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Harness failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
