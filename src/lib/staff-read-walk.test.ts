import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyGetRoute, stripComments } from "./staff-read-walk";

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
      why: ["calls a staff-on-student guard", "reads ?studentId="],
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

describe("stripComments", () => {
  it("keeps URLs inside strings", () => {
    assert.equal(stripComments('const u = "https://x.example/a"; // note'), 'const u = "https://x.example/a"; ');
  });
});
