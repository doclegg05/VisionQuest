import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { buildNotificationEmail } from "./email-templates";

// The template prefers APP_BASE_URL over the action URL's origin. CI sets
// APP_BASE_URL=http://localhost:3000 for the e2e server, which made these
// assertions on the onrender host fail there while passing locally; pin the
// variable for the file's duration so the expected origin is the one used.
const savedBaseUrl = process.env.APP_BASE_URL;
before(() => {
  process.env.APP_BASE_URL = "https://visionquest.onrender.com";
});
after(() => {
  if (savedBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = savedBaseUrl;
});

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
