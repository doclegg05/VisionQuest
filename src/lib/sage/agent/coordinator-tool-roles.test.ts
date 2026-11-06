import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-32-chars-minimum-ok!!";

// find_certification reads the module catalog through the app client. The
// stand-in returns the same catalog row to every caller, so a coordinator and
// a program coordinator must get the same answer from it.
const catalogRows = [
  { id: "mod-1", label: "Microsoft Excel", description: "Spreadsheets for work", category: "computer", platform: null },
];
const findManyCalls: unknown[] = [];

mock.module("@/lib/db", {
  exports: {
    prisma: {
      spokesModuleTemplate: {
        findMany: async (args: unknown) => {
          findManyCalls.push(args);
          return catalogRows;
        },
      },
    },
    prismaAdmin: {},
  },
});

let getEnabledTools: typeof import("./tools").getEnabledTools;
let getToolByName: typeof import("./tools").getToolByName;

before(async () => {
  ({ getEnabledTools, getToolByName } = await import("./tools"));
});

/** Read-only catalog and reference tools a program coordinator may use. */
const PROGRAM_COORDINATOR_TOOLS = [
  "present_form",
  "search_forms",
  "find_certification",
  "open_resource",
  "lookup_program_info",
  "career_skills_match",
  "career_occupation_profile",
  "career_wages",
  "career_training_programs",
  "career_tools_technology",
  "list_students_needing_attention",
];

/**
 * Coordinator-listed tools a program coordinator does not get: each reads one
 * student's record (or an upload) by the session's own id, or starts the
 * student booking flow.
 */
const WITHHELD_TOOLS = [
  "lookup_cert_progress",
  "review_portfolio",
  "lookup_appointment",
  "classify_attachment",
  "find_appointment_slots",
];

function enabledNames(role: string, mode: "readonly" | "full"): string[] {
  return getEnabledTools(role, mode).map((tool) => tool.name);
}

describe("program coordinator tool set", () => {
  it("offers the read-only catalog and reference tools", () => {
    const names = enabledNames("program_coordinator", "full");
    for (const name of PROGRAM_COORDINATOR_TOOLS) {
      assert.ok(names.includes(name), `${name} should be offered to program_coordinator`);
    }
  });

  it("withholds per-student reads, uploads and the booking flow", () => {
    const names = enabledNames("program_coordinator", "full");
    for (const name of WITHHELD_TOOLS) {
      assert.ok(!names.includes(name), `${name} must not be offered to program_coordinator`);
    }
  });

  it("offers exactly the listed tools and nothing else", () => {
    assert.deepEqual(
      [...enabledNames("program_coordinator", "full")].sort(),
      [...PROGRAM_COORDINATOR_TOOLS].sort(),
    );
  });

  it("gets no tool that writes, in either agent mode", () => {
    for (const mode of ["readonly", "full"] as const) {
      for (const tool of getEnabledTools("program_coordinator", mode)) {
        assert.equal(tool.riskTier, "read", `${tool.name} is ${tool.riskTier}`);
      }
    }
  });

  it("every program coordinator tool is also a regional coordinator tool", () => {
    const regional = enabledNames("coordinator", "full");
    for (const name of enabledNames("program_coordinator", "full")) {
      assert.ok(regional.includes(name), `${name} is program_coordinator-only`);
    }
  });
});

describe("regional coordinator tool set", () => {
  it("gets no tool that writes, in either agent mode", () => {
    for (const mode of ["readonly", "full"] as const) {
      for (const tool of getEnabledTools("coordinator", mode)) {
        assert.equal(tool.riskTier, "read", `${tool.name} is ${tool.riskTier}`);
      }
    }
  });
});

describe("both coordinator roles (R25)", () => {
  for (const role of ["coordinator", "program_coordinator"]) {
    it(`${role} holds no per-student, upload or booking tool, even as a declared role`, () => {
      for (const name of WITHHELD_TOOLS) {
        const tool = getToolByName(name);
        assert.ok(tool, `${name} exists`);
        assert.ok(
          !tool.requiredRoles.some((allowed) => allowed === role),
          `${name} still lists ${role}`,
        );
      }
    });

    // An exact set: a new tool reaches coordinators only by a reviewed edit
    // here. list_students_needing_attention is in it because coordinators get
    // names and an open-item count only (pinned in teacher-tools.test.ts).
    it(`${role} gets exactly the reviewed read-only tool set`, () => {
      for (const mode of ["readonly", "full"] as const) {
        assert.deepEqual(
          [...enabledNames(role, mode)].sort(),
          [...PROGRAM_COORDINATOR_TOOLS].sort(),
          `${role} in ${mode} mode`,
        );
      }
    });
  }
});

describe("find_certification — both coordinator roles", () => {
  it("returns the same state-wide catalog to a regional and a program coordinator", async () => {
    const tool = getToolByName("find_certification");
    assert.ok(tool);
    const run = (role: string) =>
      tool.execute(
        { query: "excel" },
        { session: { id: `${role}-1`, studentId: "", displayName: "Staff", role }, conversationId: "c-1" } as never,
      );

    const regional = await run("coordinator");
    const program = await run("program_coordinator");

    assert.equal(regional.status, "success");
    assert.deepEqual(program, regional);
    // The catalog read takes no region or student filter for either role.
    assert.equal(findManyCalls.length, 2);
    assert.deepEqual(findManyCalls[0], findManyCalls[1]);
  });
});
