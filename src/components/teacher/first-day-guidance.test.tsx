import assert from "node:assert/strict";
import { it } from "node:test";
import { renderToString } from "react-dom/server";
import { CreateClassForm, initialClassValues } from "./CreateClassForm";
import { CreateClassHint } from "./CreateClassGate";

it("preselects the instructor and a sole region, but leaves multiple regions for a choice", () => {
  const north = { id: "north", name: "North" };
  assert.deepEqual(initialClassValues("teacher-1", [north]).instructorIds, ["teacher-1"]);
  assert.equal(initialClassValues("teacher-1", [north]).regionId, "north");
  assert.equal(initialClassValues(null, [north, { id: "south", name: "South" }]).regionId, "");
  assert.deepEqual(initialClassValues(null, []).instructorIds, []);
});

it("sends an admin on Classes to region setup instead of telling them to ask an admin", () => {
  const html = renderToString(<CreateClassHint manageRegions={false} regionCount={0} loading={false} isAdmin />);
  assert.match(html, /href="\/admin#regions"/);
  assert.doesNotMatch(html, /Ask your program admin/);
});

it("shows the Admin label only for an admin viewer", () => {
  const props = {
    form: { values: initialClassValues(null, []), setField() {}, toggleInstructor() {}, reset() {} },
    regions: [], instructors: [], onAdminPage: false, creating: false, onCreate() {},
  };
  assert.doesNotMatch(renderToString(<CreateClassForm {...props} />), />Admin</);
  assert.match(renderToString(<CreateClassForm {...props} showAdminLabel />), />Admin</);
});

it("keeps the create button focusable while suppressing repeat activation", () => {
  let calls = 0;
  for (const creating of [false, true]) {
    const element = CreateClassForm({
      form: { values: initialClassValues(null, []), setField() {}, toggleInstructor() {}, reset() {} },
      regions: [], instructors: [], onAdminPage: false, creating, onCreate() { calls += 1; },
    });
    const button = element.props.children.at(-1);
    assert.equal(button.props.disabled, undefined);
    assert.equal(button.props["aria-disabled"], creating);
    button.props.onClick();
  }
  assert.equal(calls, 1);
});
