import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyGetRoute, libReach, stripComments } from "./staff-read-walk";

const STAFF_GET_NO_VIEW = `
import { assertStaffCanManageStudent } from "@/lib/classroom";
export const GET = withAuth(async (session, req) => {
  const student = await assertStaffCanManageStudent(session, "x");
  return NextResponse.json({ student });
});
`;

describe("classifyGetRoute", () => {
  it("flags a staff GET that calls the guard and records no view", () => {
    const result = classifyGetRoute("src/app/api/new/route.ts", STAFF_GET_NO_VIEW);
    assert.deepEqual(result, { kind: "in_scope", records: false, why: ["calls a staff-on-student guard"] });
  });

  it("does not accept a comment that names recordStudentView", () => {
    const source = STAFF_GET_NO_VIEW.replace(
      "return NextResponse",
      "// recordStudentView({ surface: 'x' }) is called elsewhere\n  /* recordStudentView( */\n  return NextResponse",
    );
    const result = classifyGetRoute("src/app/api/new/route.ts", source);
    assert.equal(result.kind, "in_scope");
    assert.equal(result.kind === "in_scope" && result.records, false);
  });

  it("counts a guard and a view reached through same-file helpers", () => {
    const source = `
async function resolveTarget(session, id) {
  await assertStaffCanManageStudent(session, id);
  return id;
}
async function audit(session, id) {
  await recordStudentView({ actorId: session.id, targetStudentId: id });
}
export const GET = withAuth(async (session, req) => {
  const id = await resolveTarget(session, new URL(req.url).searchParams.get("studentId"));
  await audit(session, id);
  return NextResponse.json({});
});
`;
    const result = classifyGetRoute("src/app/api/x/route.ts", source);
    assert.deepEqual(result, {
      kind: "in_scope",
      records: true,
      why: ["calls a staff-on-student guard", "reads a student query parameter"],
    });
  });

  it("ignores a guard used only by another handler", () => {
    const source = `
export const GET = withAuth(async () => NextResponse.json({}));
export const PATCH = withAuth(async (session) => {
  await assertStaffCanManageStudent(session, "x");
});
`;
    assert.deepEqual(classifyGetRoute("src/app/api/x/route.ts", source), { kind: "out_of_scope" });
  });

  it("puts a students/[id] route in scope by path", () => {
    const source = "export async function GET() { return new Response(); }\n";
    const result = classifyGetRoute("src/app/api/teacher/students/[id]/x/route.ts", source);
    assert.deepEqual(result, { kind: "in_scope", records: false, why: ["students/[id] path"] });
  });

  it("reports a file with no GET", () => {
    assert.deepEqual(classifyGetRoute("src/app/api/x/route.ts", "export const POST = 1;\n"), { kind: "no_get" });
  });
});

describe("the stronger walk (H15c item 6)", () => {
  const lib = libReach([
    {
      file: "src/lib/panel-data.ts",
      source: `
async function scoped(session, id) {
  return assertStaffCanManageStudent(session, id);
}
export async function loadPanel(session, id) {
  await scoped(session, id);
  return {};
}
export function shape(x) { return x; }
`,
    },
    {
      file: "src/lib/dashboard/tasks.ts",
      source: `
export async function listTasks(session, id) {
  const where = buildManagedStudentWhere(session);
  return where;
}
export async function tasksForPanel(session, id) {
  return listTasks(session, id);
}
`,
    },
    {
      file: "src/lib/views.ts",
      source: "export async function auditPanel(session, id) {\n  await recordStudentView({ targetStudentId: id });\n}\n",
    },
  ]);

  it("finds exported src/lib helpers that reach a guard, across files", () => {
    assert.deepEqual([...lib.guards].sort(), ["listTasks", "loadPanel", "tasksForPanel"]);
    assert.deepEqual([...lib.recorders], ["auditPanel"]);
  });

  it("puts a route in scope when it calls a guarding src/lib helper", () => {
    const source = "export const GET = withAuth(async (session) => NextResponse.json(await loadPanel(session, 'x')));\n";
    assert.deepEqual(classifyGetRoute("src/app/api/x/route.ts", source, lib), {
      kind: "in_scope",
      records: false,
      why: ["calls a staff-on-student guard"],
    });
  });

  it("counts a view recorded through a src/lib helper", () => {
    const source = "export const GET = withAuth(async (session) => {\n  await loadPanel(session, 'x');\n  await auditPanel(session, 'x');\n});\n";
    const result = classifyGetRoute("src/app/api/x/route.ts", source, lib);
    assert.equal(result.kind === "in_scope" && result.records, true);
  });

  it("matches buildManagedStudentWhere as a guard", () => {
    const source = "export const GET = withAuth(async (session) => {\n  const where = buildManagedStudentWhere(session);\n});\n";
    assert.equal(classifyGetRoute("src/app/api/x/route.ts", source).kind, "in_scope");
  });

  it("follows export const GET = withX(handlerFn)", () => {
    const source = `
async function handler(session, req) {
  await assertStaffCanManageStudent(session, "x");
  return NextResponse.json({});
}
export const GET = withTeacherAuth(handler);
`;
    assert.deepEqual(classifyGetRoute("src/app/api/x/route.ts", source), {
      kind: "in_scope",
      records: false,
      why: ["calls a staff-on-student guard"],
    });
  });

  it("counts any query parameter that names a student", () => {
    for (const param of ["targetStudentId", "student", "studentIds"]) {
      const source = `export async function GET(req) {\n  const id = new URL(req.url).searchParams.get("${param}");\n}\n`;
      const result = classifyGetRoute("src/app/api/x/route.ts", source);
      assert.equal(result.kind, "in_scope", param);
    }
  });
});

describe("stripComments", () => {
  it("keeps URLs inside strings", () => {
    assert.equal(stripComments('const u = "https://x.example/a"; // note'), 'const u = "https://x.example/a"; ');
  });
});
