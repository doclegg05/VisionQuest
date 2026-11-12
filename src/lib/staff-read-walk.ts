/**
 * Static classifier for the staff-read route walk (src/lib/audit.staff-reads.test.ts).
 *
 * A GET handler is in scope when it can reach a staff-on-student guard
 * (`assertStaffCanManageStudent`, `staffCanManageStudent`,
 * `buildManagedStudentWhere`, or an exported src/lib helper that reaches one),
 * reads a query parameter whose name contains "student", or lives under a
 * `students/[id]` path. It "records" when it can reach `recordStudentView(`
 * the same ways. Reach means the handler calls the function itself, through a
 * helper defined in the same file, or hands a same-file function to a wrapper
 * (`export const GET = withTeacherAuth(handler)`).
 *
 * Comments are stripped first, so a comment that names a function proves
 * nothing.
 */

const GUARD_NAMES = ["assertStaffCanManageStudent", "staffCanManageStudent", "buildManagedStudentWhere"];
const RECORD_NAMES = ["recordStudentView"];
const STUDENT_QUERY = /\.get\(\s*["'`]\w*student\w*["'`]\s*\)/iu;
const STUDENT_PATH = /\/students\/\[id\]\//u;

/** Block comments, then line comments that are not part of a URL like `https://`. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:\\"'`])\/\/.*$/gmu, "$1");
}

interface TopLevelChunk {
  name: string;
  body: string;
}

const TOP_LEVEL_DECL =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|class\s+)([A-Za-z_$][\w$]*)/u;

/** Split a module into top-level declarations: each runs until the next one. */
export function topLevelChunks(source: string): TopLevelChunk[] {
  const chunks: TopLevelChunk[] = [];
  let current: TopLevelChunk | null = null;
  for (const line of source.split("\n")) {
    const match = TOP_LEVEL_DECL.exec(line);
    if (match) {
      current = { name: match[1], body: "" };
      chunks.push(current);
    }
    if (current) current.body += `${line}\n`;
  }
  return chunks;
}

function escapeName(name: string): string {
  return name.replace(/\$/gu, "\\$");
}

/** A call `name(`, or `name` handed to another call as an argument. */
function callsName(body: string, name: string): boolean {
  const id = escapeName(name);
  return new RegExp(`(?<![\\w$.])${id}\\s*\\(|[(,]\\s*${id}\\s*[,)]`, "u").test(body);
}

function callsAny(body: string, names: Iterable<string>): boolean {
  for (const name of names) if (callsName(body, name)) return true;
  return false;
}

/** Names of the chunks that reach one of `targets`, directly or through other chunks. */
function reaching(chunks: TopLevelChunk[], targets: Iterable<string>): Set<string> {
  const names = [...targets];
  const found = new Set(chunks.filter((chunk) => callsAny(chunk.body, names)).map((chunk) => chunk.name));
  let grew = true;
  while (grew) {
    grew = false;
    for (const chunk of chunks) {
      if (found.has(chunk.name)) continue;
      if ([...found].some((name) => callsName(chunk.body, name))) {
        found.add(chunk.name);
        grew = true;
      }
    }
  }
  return found;
}

/** The chunks a handler can reach: itself plus every same-file helper it calls. */
function reachableBodies(chunks: TopLevelChunk[], start: TopLevelChunk): string {
  const seen = new Set([start.name]);
  const queue = [start];
  let bodies = "";
  while (queue.length > 0) {
    const chunk = queue.shift() as TopLevelChunk;
    bodies += chunk.body;
    for (const other of chunks) {
      if (!seen.has(other.name) && callsName(chunk.body, other.name)) {
        seen.add(other.name);
        queue.push(other);
      }
    }
  }
  return bodies;
}

/** Exported src/lib functions that reach a guard, and ones that reach a view write. */
export interface LibReach {
  guards: ReadonlySet<string>;
  recorders: ReadonlySet<string>;
}

export interface SourceFile {
  file: string;
  source: string;
}

const NO_LIB: LibReach = { guards: new Set(), recorders: new Set() };

/**
 * Exported functions across `files` that reach one of `base`, directly, through
 * same-file helpers, or through another file's exported function. Repeats
 * until nothing new is found, so a chain of helpers across files counts.
 */
function exportedReaching(modules: TopLevelChunk[][], base: string[]): Set<string> {
  const found = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    const targets = [...base, ...found];
    for (const chunks of modules) {
      for (const name of reaching(chunks, targets)) {
        const chunk = chunks.find((c) => c.name === name);
        if (chunk?.body.startsWith("export") && !found.has(name) && !base.includes(name)) {
          found.add(name);
          grew = true;
        }
      }
    }
  }
  return found;
}

/** Build the guard and recorder lists from src/lib sources. */
export function libReach(files: readonly SourceFile[]): LibReach {
  const modules = files.map((f) => topLevelChunks(stripComments(f.source)));
  return {
    guards: exportedReaching(modules, GUARD_NAMES),
    recorders: exportedReaching(modules, RECORD_NAMES),
  };
}

export type GetRouteClass =
  | { kind: "no_get" }
  | { kind: "out_of_scope" }
  | { kind: "in_scope"; records: boolean; why: string[] };

/** Classify one route file's GET handler. `file` is the repo-relative path. */
export function classifyGetRoute(file: string, rawSource: string, lib: LibReach = NO_LIB): GetRouteClass {
  const chunks = topLevelChunks(stripComments(rawSource));
  const get = chunks.find((chunk) => chunk.name === "GET");
  if (!get) return { kind: "no_get" };

  const guarded = reaching(chunks, [...GUARD_NAMES, ...lib.guards]);
  const reached = reachableBodies(chunks, get);
  const why: string[] = [];
  if (guarded.has("GET")) why.push("calls a staff-on-student guard");
  if (STUDENT_QUERY.test(reached)) why.push("reads a student query parameter");
  if (STUDENT_PATH.test(file)) why.push("students/[id] path");
  if (why.length === 0) return { kind: "out_of_scope" };

  const records = reaching(chunks, [...RECORD_NAMES, ...lib.recorders]).has("GET");
  return { kind: "in_scope", records, why };
}
