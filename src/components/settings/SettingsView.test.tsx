import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";

import { SettingsView } from "./SettingsView";

// SettingsView backs both /settings (students) and /teacher/settings (staff).
// These renders assert the role split on first paint: staff get the MFA panel
// immediately (no flash of student-only sections), students never see it.

describe("SettingsView role split", () => {
  it("mounts StaffMfaPanel on first paint for teachers", () => {
    const html = renderToString(<SettingsView initialRole="teacher" />);
    // StaffMfaPanel renders its loading state until /api/auth/mfa/status resolves.
    assert.ok(html.includes("Loading MFA settings"));
    assert.ok(html.includes("Manage staff account security"));
  });

  it("mounts StaffMfaPanel on first paint for admins", () => {
    const html = renderToString(<SettingsView initialRole="admin" />);
    assert.ok(html.includes("Loading MFA settings"));
  });

  it("hides student-only sections from staff", () => {
    const html = renderToString(<SettingsView initialRole="teacher" />);
    assert.ok(!html.includes("Recovery questions"));
    assert.ok(!html.includes("Personal info"));
  });

  it("shows student sections and no MFA panel for students", () => {
    const html = renderToString(<SettingsView initialRole="student" />);
    assert.ok(html.includes("Recovery questions"));
    assert.ok(html.includes("Personal info"));
    assert.ok(!html.includes("Loading MFA settings"));
  });

  it("defaults to the student-safe render when no role is supplied", () => {
    // The (student) route renders <SettingsView /> with no prop — the session
    // fetch resolves the role after mount, exactly as before the extraction.
    const html = renderToString(<SettingsView />);
    assert.ok(!html.includes("Loading MFA settings"));
  });
});
