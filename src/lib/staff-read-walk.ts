/**
 * Static classifier for the staff-read route walk (src/lib/audit.staff-reads.test.ts).
 *
 * A GET handler is in scope when it can reach a staff-on-student guard
 * (`assertStaffCanManageStudent`, `staffCanManageStudent`), reads a
 * `?studentId=` query parameter, or lives under a `students/[id]` path. It
 * "records" when it can reach `recordStudentView(`. Reach means the handler
 * calls the function itself or through a helper defined in the same file.
 *
 * Comments are stripped first, so a comment that names a function proves
 * nothing.
 */

const GUARD_CALL = /\b(?:assertStaffCanManageStudent|staffCanManageStudent)\s*\(/u;
const RECORD_CALL = /\brecordStudentView\s*\(/u;
const STUDENT_ID_QUERY = /\.get\(\s*["'`]studentId["'`]\s*\)/u;
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

function callsName(body: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${name.replace(/\$/gu, "\\$")}\\s*\\(`, "u").test(body);
}

/** Names of the chunks that reach `target`, directly or through other chunks. */
function reaching(chunks: TopLevelChunk[], target: RegExp): Set<string> {
  const found = new Set(chunks.filter((chunk) => target.test(chunk.body)).map((chunk) => chunk.name));
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

export type GetRouteClass =
  | { kind: "no_get" }
  | { kind: "out_of_scope" }
  | { kind: "in_scope"; records: boolean; why: string[] };

/** Classify one route file's GET handler. `file` is the repo-relative path. */
export function classifyGetRoute(file: string, rawSource: string): GetRouteClass {
  const chunks = topLevelChunks(stripComments(rawSource));
  const get = chunks.find((chunk) => chunk.name === "GET");
  if (!get) return { kind: "no_get" };

  const guarded = reaching(chunks, GUARD_CALL);
  const reached = reachableBodies(chunks, get);
  const why: string[] = [];
  if (guarded.has("GET")) why.push("calls a staff-on-student guard");
  if (STUDENT_ID_QUERY.test(reached)) why.push("reads ?studentId=");
  if (STUDENT_PATH.test(file)) why.push("students/[id] path");
  if (why.length === 0) return { kind: "out_of_scope" };

  return { kind: "in_scope", records: reaching(chunks, RECORD_CALL).has("GET"), why };
}
