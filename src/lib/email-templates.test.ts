import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNotificationEmail } from "./email-templates";

test("buildNotificationEmail: default (no role) links to the student settings page", () => {
  const html = buildNotificationEmail("Title", "Body", "https://visionquest.onrender.com");
  assert.match(html, /href="https:\/\/visionquest\.onrender\.com\/settings"/);
  assert.doesNotMatch(html, /\/teacher\/settings/);
});

test("buildNotificationEmail: student role links to /settings, which the (student) layout serves", () => {
  const html = buildNotificationEmail(
    "Title",
    "Body",
    "https://visionquest.onrender.com",
    { role: "student" },
  );
  assert.match(html, /href="https:\/\/visionquest\.onrender\.com\/settings"/);
});

test("buildNotificationEmail: teacher role links to /teacher/settings, not the student-only /settings", () => {
  const html = buildNotificationEmail(
    "Title",
    "Body",
    "https://visionquest.onrender.com",
    { role: "teacher" },
  );
  assert.match(html, /href="https:\/\/visionquest\.onrender\.com\/teacher\/settings"/);
  // The (student) layout redirects any staff role away from /settings, so a
  // staff email must never point there.
  assert.doesNotMatch(html, /href="https:\/\/visionquest\.onrender\.com\/settings"/);
});

test("buildNotificationEmail: admin role also links to /teacher/settings", () => {
  const html = buildNotificationEmail(
    "Title",
    "Body",
    "https://visionquest.onrender.com",
    { role: "admin" },
  );
  assert.match(html, /href="https:\/\/visionquest\.onrender\.com\/teacher\/settings"/);
});
