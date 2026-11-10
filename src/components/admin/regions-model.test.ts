import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRegionChange,
  coordinatorChoices,
  mergePeople,
  parseRegionReply,
  parseRegionList,
  regionWithSameName,
  regionCountFor,
  suggestRegionCode,
  withCoordinatorAdded,
  withCoordinatorRemoved,
  withRegionAdded,
  withRegionChanged,
  type AdminRegion,
  type RegionPerson,
} from "./regions-model";

const pat: RegionPerson = { id: "u1", displayName: "Pat Lee", email: "pat@example.org" };
const sam: RegionPerson = { id: "u2", displayName: "Sam Roy", email: null };

function region(overrides: Partial<AdminRegion> = {}): AdminRegion {
  return { id: "r1", name: "North", code: "north", status: "active", classCount: 0, coordinators: [], ...overrides };
}

/** The shape GET /api/admin/regions answers with, login ids included. */
const serverRegion = {
  id: "r1",
  name: "North",
  code: "north",
  description: null,
  status: "active",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  classCount: 2,
  coordinators: [
    { id: "u1", studentId: "pat.login", displayName: "Pat Lee", email: "pat@example.org", assignedAt: "2026-11-02T00:00:00.000Z" },
  ],
};

describe("parseRegionList", () => {
  it("reads the regions the server lists", () => {
    assert.deepEqual(parseRegionList({ regions: [serverRegion] }), [
      { id: "r1", name: "North", code: "north", status: "active", classCount: 2, coordinators: [pat] },
    ]);
  });

  it("leaves out archived regions, because this screen cannot archive or restore one", () => {
    const archived = { ...serverRegion, id: "r9", name: "Old Valley", status: "archived" };
    assert.deepEqual(parseRegionList({ regions: [archived, serverRegion] })?.map((item) => item.id), ["r1"]);
  });

  it("reads an empty list as no regions, not as a failure", () => {
    assert.deepEqual(parseRegionList({ regions: [] }), []);
  });

  it("drops the coordinator's login id at the boundary", () => {
    const parsed = parseRegionList({ regions: [serverRegion] });
    assert.ok(parsed);
    assert.equal(JSON.stringify(parsed).includes("pat.login"), false);
  });

  it("refuses a payload with no regions list", () => {
    assert.equal(parseRegionList({ error: "nope" }), null);
    assert.equal(parseRegionList(null), null);
    assert.equal(parseRegionList("regions"), null);
  });

  it("refuses the whole list when one region is malformed", () => {
    assert.equal(parseRegionList({ regions: [serverRegion, { id: "r2", name: "South" }] }), null);
  });

  it("refuses a status it does not know", () => {
    assert.equal(parseRegionList({ regions: [{ ...serverRegion, status: "paused" }] }), null);
  });
});

describe("parseRegionReply", () => {
  it("reads a new region, which has no classes and no coordinators yet", () => {
    const created = { region: { id: "r9", name: "East", code: "east", description: null, status: "active" } };
    assert.deepEqual(parseRegionReply(created), {
      id: "r9",
      name: "East",
      code: "east",
      status: "active",
      classCount: 0,
      coordinators: [],
    });
  });

  it("refuses a reply with no region in it", () => {
    assert.equal(parseRegionReply({ ok: true }), null);
  });
});

describe("suggestRegionCode", () => {
  it("turns a name into the code format the server accepts", () => {
    assert.equal(suggestRegionCode("North Central"), "north-central");
    assert.equal(suggestRegionCode("  Region 3: Kanawha & Putnam  "), "region-3-kanawha-putnam");
  });

  it("suggests nothing for a name with no letters or numbers", () => {
    assert.equal(suggestRegionCode("  --  "), "");
  });

  it("stays inside the server's 40 character limit without a trailing dash", () => {
    const code = suggestRegionCode("a".repeat(39) + " b");
    assert.equal(code, "a".repeat(39));
    assert.match(code, /^[a-z0-9-]{1,40}$/);
  });
});

describe("list changes", () => {
  it("adds a region and keeps the list by name", () => {
    const start = [region({ id: "r1", name: "North" }), region({ id: "r3", name: "West" })];
    const next = withRegionAdded(start, region({ id: "r2", name: "East" }));
    assert.deepEqual(next.map((item) => item.name), ["East", "North", "West"]);
    assert.equal(start.length, 2, "the list passed in is not changed");
  });

  it("renames one region and leaves the rest alone", () => {
    const start = [region({ id: "r1", name: "North" }), region({ id: "r2", name: "East" })];
    const next = withRegionChanged(start, "r1", { name: "Northern" });
    assert.deepEqual(next.map((item) => item.name), ["East", "Northern"]);
    assert.equal(start[0].name, "North");
  });

  it("adds a coordinator to one region only", () => {
    const start = [region({ id: "r1" }), region({ id: "r2", name: "East" })];
    const next = withCoordinatorAdded(start, "r1", pat);
    assert.deepEqual(next.find((item) => item.id === "r1")?.coordinators, [pat]);
    assert.deepEqual(next.find((item) => item.id === "r2")?.coordinators, []);
  });

  it("does not list a coordinator twice in one region", () => {
    const next = withCoordinatorAdded([region({ coordinators: [pat] })], "r1", pat);
    assert.deepEqual(next[0].coordinators, [pat]);
  });

  it("removes a coordinator from one region only", () => {
    const start = [region({ id: "r1", coordinators: [pat, sam] }), region({ id: "r2", name: "East", coordinators: [pat] })];
    const next = withCoordinatorRemoved(start, "r1", "u1");
    assert.deepEqual(next.find((item) => item.id === "r1")?.coordinators, [sam]);
    assert.deepEqual(next.find((item) => item.id === "r2")?.coordinators, [pat]);
  });
});

describe("applyRegionChange", () => {
  const start = [region({ id: "r1", name: "North", coordinators: [pat] })];

  it("applies each kind of saved change to the list", () => {
    const added = applyRegionChange(start, { kind: "region-added", region: region({ id: "r2", name: "East" }) });
    assert.deepEqual(added.map((item) => item.name), ["East", "North"]);

    const renamed = applyRegionChange(start, { kind: "region-changed", regionId: "r1", change: { name: "Northern" } });
    assert.equal(renamed[0].name, "Northern");

    const joined = applyRegionChange(start, { kind: "coordinator-added", regionId: "r1", person: sam });
    assert.deepEqual(joined[0].coordinators, [pat, sam]);

    const left = applyRegionChange(start, { kind: "coordinator-removed", regionId: "r1", coordinatorId: "u1" });
    assert.deepEqual(left[0].coordinators, []);
  });
});

describe("people who can be added as a coordinator", () => {
  it("keeps everyone seen holding a region, once each, by name", () => {
    const regions = [region({ id: "r1", coordinators: [sam, pat] }), region({ id: "r2", coordinators: [pat] })];
    assert.deepEqual(mergePeople([], regions), [pat, sam]);
  });

  it("keeps a person who was just removed from their last region", () => {
    assert.deepEqual(mergePeople([pat], [region({ coordinators: [] })]), [pat]);
  });

  it("offers only people who are not in the region already", () => {
    assert.deepEqual(coordinatorChoices([pat, sam], region({ coordinators: [pat] })), [sam]);
  });

  it("counts the regions a coordinator holds", () => {
    const regions = [
      region({ id: "r1", coordinators: [pat] }),
      region({ id: "r2", coordinators: [pat, sam] }),
      region({ id: "r3", coordinators: [sam] }),
    ];
    assert.equal(regionCountFor(regions, "u1"), 2);
    assert.equal(regionCountFor(regions, "nobody"), 0);
  });
});

describe("regionWithSameName", () => {
  const regions = [region({ id: "r1", name: "North" }), region({ id: "r2", name: "East" })];

  it("finds another region with the same name, ignoring case and spaces", () => {
    assert.equal(regionWithSameName(regions, "  north "), "North");
  });

  it("does not count the region being renamed", () => {
    assert.equal(regionWithSameName(regions, "North", "r1"), null);
  });

  it("finds nothing for a new name or a blank one", () => {
    assert.equal(regionWithSameName(regions, "West"), null);
    assert.equal(regionWithSameName(regions, "  "), null);
  });
});
