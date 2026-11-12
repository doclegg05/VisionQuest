import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";

import { PLAIN_LANGUAGE_IDEAL_GRADE, assessReadability } from "@/lib/sage/readability";
import { CreateClassForm, createClassBody, type CreateClassValues, type InstructorChoice } from "./CreateClassForm";

const BLANK: CreateClassValues = { name: "", code: "", description: "", startDate: "", endDate: "", regionId: "", instructorIds: [] };
const regions = [{ id: "r1", name: "North" }];
const people: readonly InstructorChoice[] = [
  { id: "t1", displayName: "Ada Park" },
  { id: "t2", displayName: "Ben Ortiz" },
];

const NO_INSTRUCTORS = "No instructors yet.";
const WHO_TO_PICK = "Pick instructors who are in this region. To add someone to a region, use Staff Waiting for a Region below.";
const INVITE_ONE = "No instructors yet. Invite one in Invite Staff at the bottom of this page. They show here after they accept.";

interface RenderInput {
  instructors?: readonly InstructorChoice[];
  onAdminPage?: boolean;
  values?: CreateClassValues;
  creating?: boolean;
}

function render({ instructors = people, onAdminPage = true, values = BLANK, creating = false }: RenderInput = {}): string {
  return renderToString(
    <CreateClassForm
      form={{ values, setField: () => {}, toggleInstructor: () => {}, reset: () => {} }}
      regions={regions}
      instructors={instructors}
      onAdminPage={onAdminPage}
      creating={creating}
      onCreate={() => {}}
    />,
  ).replaceAll("<!-- -->", "");
}

/** The words on the screen: tags out, entities back. */
function wordsOf(html: string): string {
  return html.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
}

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("Create a Class with no instructor to pick", () => {
  it("on the admin page says where to invite one and when they show up", () => {
    const html = render({ instructors: [], onAdminPage: true });
    assert.ok(wordsOf(html).includes(INVITE_ONE), wordsOf(html));
  });

  it("links the words Invite Staff to that card, with a 44px touch target", () => {
    const html = render({ instructors: [], onAdminPage: true });
    const link = html.match(/<a href="#invite-staff" class="([^"]*)">Invite Staff<\/a>/);
    assert.ok(link, html);
    assert.match(link[1], /(?:^| )inline-flex(?: |$)/);
    assert.match(link[1], /(?:^| )pointer-coarse:min-h-11(?: |$)/);
  });

  it("on an instructor's page says only that there are none, with no link to a card that is not there", () => {
    const html = render({ instructors: [], onAdminPage: false });
    const words = wordsOf(html);
    assert.ok(words.includes(NO_INSTRUCTORS), words);
    assert.equal(words.includes("Invite"), false);
    assert.equal(html.includes("#invite-staff"), false);
  });

  it("says nothing of the kind when there are instructors", () => {
    assert.equal(wordsOf(render()).includes(NO_INSTRUCTORS), false);
    assert.equal(render().includes("#invite-staff"), false);
  });

  it("names the invite card as the admin page shows it, below this card", () => {
    const invitePanel = sourceOf("../staff/StaffInvitePanel.tsx");
    assert.ok(invitePanel.includes('<section id="invite-staff"'));
    assert.match(invitePanel, /<h2 [^>]*>Invite Staff<\/h2>/);
    const adminPage = sourceOf("../../app/(admin)/admin/page.tsx");
    assert.ok(adminPage.indexOf("<ClassRosterManager manageRegions />") < adminPage.indexOf("<StaffInvitePanel"));
    const teacherPage = sourceOf("../../app/(teacher)/teacher/classes/page.tsx");
    assert.equal(teacherPage.includes("StaffInvitePanel"), false);
  });

  it("reads at grade 6 or lower, with no dash", () => {
    const result = assessReadability(INVITE_ONE, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.equal(result.scorable, true);
    assert.ok(result.grade <= PLAIN_LANGUAGE_IDEAL_GRADE, `grade ${result.grade}`);
    assert.doesNotMatch(wordsOf(render({ instructors: [] })), /[–—]/);
  });
});

describe("the line under the instructor list", () => {
  it("on the admin page says who to pick and where to add someone to a region", () => {
    const words = wordsOf(render());
    assert.ok(words.includes(WHO_TO_PICK), words);
    assert.ok(words.indexOf("Ben Ortiz") < words.indexOf(WHO_TO_PICK), "the line comes after the last instructor");
  });

  it("is read out with the list: the box is a named group described by the line", () => {
    const html = render();
    assert.match(html, /<div role="group" aria-labelledby="new-class-instructors-label" aria-describedby="new-class-instructors-help" /);
    assert.match(html, /<p id="new-class-instructors-label" [^>]*>Assign instructors<\/p>/);
    assert.ok(html.includes(`<p id="new-class-instructors-help" class="mt-3 text-sm text-[var(--ink-muted)]">${WHO_TO_PICK}</p>`), html);
  });

  it("is left off an instructor's page, which has no Staff Waiting for a Region panel", () => {
    const html = render({ onAdminPage: false });
    assert.equal(wordsOf(html).includes("Staff Waiting for a Region"), false);
    assert.equal(html.includes("aria-describedby"), false, "nothing points at a line that is not there");
    assert.match(html, /<div role="group" aria-labelledby="new-class-instructors-label" class=/);
  });

  it("is left off when there is no instructor to pick", () => {
    const html = render({ instructors: [] });
    assert.equal(wordsOf(html).includes("Pick instructors who are in this region."), false);
    assert.equal(html.includes("aria-describedby"), false);
  });

  it("names the placement panel as the admin page shows it, below this card", () => {
    assert.match(sourceOf("../staff/OrgPlacementPanel.tsx"), /<h2 [^>]*>Staff Waiting for a Region<\/h2>/);
    const adminPage = sourceOf("../../app/(admin)/admin/page.tsx");
    assert.ok(adminPage.indexOf("<ClassRosterManager manageRegions />") < adminPage.indexOf("<OrgPlacementSection"));
    assert.equal(sourceOf("../../app/(teacher)/teacher/classes/page.tsx").includes("OrgPlacement"), false);
  });

  it("reads at grade 6 or lower, with no dash", () => {
    const result = assessReadability(WHO_TO_PICK, { maxGrade: PLAIN_LANGUAGE_IDEAL_GRADE });
    assert.equal(result.scorable, true);
    assert.ok(result.grade <= PLAIN_LANGUAGE_IDEAL_GRADE, `grade ${result.grade}`);
    assert.doesNotMatch(wordsOf(render()), /[\u2013\u2014]/);
  });
});

// The card was moved out of ClassRosterManager.tsx as it was. These pin what moved.
describe("Create a Class, as it was before it moved", () => {
  it("keeps its heading, its fields and its button", () => {
    const html = render();
    assert.match(html, /^<div class="surface-section space-y-4 p-5">/);
    assert.match(html, /<h2 [^>]*>Create a Class<\/h2>/);
    for (const label of ["Class name", "Class code", "Start date", "End date", "Description"]) {
      assert.match(html, new RegExp(`<label class="block space-y-1.5"><span [^>]*>${label}</span><(?:input|textarea) `), label);
    }
    assert.match(html, /<label for="new-class-region"[^>]*>Region<\/label>/);
    assert.match(html, /<button type="button" aria-disabled="false" class="primary-button [^"]*">Create Class<\/button>/);
  });

  it("shows what was typed and ticks the picked instructors", () => {
    const html = render({ values: { ...BLANK, name: "Morning", startDate: "2026-11-12", instructorIds: ["t2"] } });
    assert.match(html, /<input class="field [^"]*" value="Morning"\/>/);
    assert.match(html, /<input type="date" class="field [^"]*" value="2026-11-12"\/>/);
    assert.match(html, /<input type="checkbox"\/><span>Ada Park<\/span>/);
    assert.match(html, /<input type="checkbox" checked=""\/><span>Ben Ortiz<\/span>/);
  });

  it("turns the button off while the class is being created", () => {
    assert.match(render({ creating: true }), /<button type="button" aria-disabled="true" class="primary-button [^"]*">Creating\.\.\.<\/button>/);
  });

  it("sends the same body as before, with a blank date as null", () => {
    const values = { ...BLANK, name: "Morning", code: "am", regionId: "r1", endDate: "2026-12-18", instructorIds: ["t1"] };
    assert.equal(
      JSON.stringify(createClassBody(values)),
      '{"name":"Morning","code":"am","description":"","startDate":null,"endDate":"2026-12-18","instructorIds":["t1"],"regionId":"r1"}',
    );
  });
});
