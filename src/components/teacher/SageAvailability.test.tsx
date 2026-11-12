import assert from "node:assert/strict";
import { it } from "node:test";
import { renderToString } from "react-dom/server";
import { SageAvailabilityNotice } from "./SageAvailability";

it("shows an actionable Sage outage without blocking the rest of the app", () => {
  const html = renderToString(<SageAvailabilityNotice connected={false} />);
  assert.match(html, /Sage is off/); assert.match(html, /Students can still use/); assert.match(html, /program admin/);
});
it("does not call an unverified connection healthy or off", () => {
  const html = renderToString(<SageAvailabilityNotice connected={null} />);
  assert.match(html, /could not check/);
  assert.doesNotMatch(html, /Students can still use/);
  assert.equal(renderToString(<SageAvailabilityNotice connected={true} />), "");
});
