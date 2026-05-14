import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export const SAFE_STUDENT_CATEGORIES = [
  "ORIENTATION",
  "STUDENT_RESOURCE",
  "STUDENT_REFERRAL",
  "DOHS_FORM",
  "CERTIFICATION_INFO",
  "LMS_PLATFORM_GUIDE",
  "READY_TO_WORK",
  "PROGRAM_POLICY",
];

export const STUDENT_VISIBLE_AUDIENCES = ["STUDENT", "BOTH"];

export function loadEnvFile(filePath = ".env.local") {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;

    const index = line.indexOf("=");
    const name = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[name]) {
      process.env[name] = value;
    }
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const index = body.indexOf("=");
    if (index === -1) {
      args[body] = true;
    } else {
      args[body.slice(0, index)] = body.slice(index + 1);
    }
  }
  return args;
}

export function splitCsv(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function classifySageContextNote(note, title = "") {
  const trimmed = (note || "").trim();
  if (!trimmed) return "empty";

  const words = trimmed.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const meaningfulWords = words.filter((word) => word.length >= 4);
  const uniqueMeaningfulWords = new Set(meaningfulWords);
  const titleWords = new Set(
    title
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((word) => word.length >= 4) ?? [],
  );
  const nonTitleWords = meaningfulWords.filter((word) => !titleWords.has(word));

  const metadataOnly =
    /^.+\.\s*(related certification|platform|category):\s*[^.]+\.?$/i.test(trimmed) ||
    /^.+\.\s*category:\s*[A-Z_]+\.?$/i.test(trimmed);

  const hasOperationalLanguage =
    /\b(student|students|teacher|instructor|use|uses|need|needs|required|complete|submit|certification|platform|orientation|form|guide|policy|portfolio|attendance|evidence|employment|career|support|referral|rights|responsibilities)\b/i.test(
      trimmed,
    );

  if (
    trimmed.length >= 120 &&
    uniqueMeaningfulWords.size >= 14 &&
    nonTitleWords.length >= 8 &&
    hasOperationalLanguage &&
    !metadataOnly
  ) {
    return "good";
  }

  return "weak";
}

export function summarizeCounts(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
