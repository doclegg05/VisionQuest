import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getThemePreferenceFromCookie,
  resolveTheme,
  THEME_BOOT_SCRIPT,
  THEME_DEFAULT,
} from "./theme";

/**
 * VisionQuest followed its own default (dark) instead of the device. A
 * learner whose iPhone was set to Light got a dark app on first visit
 * (confirmed on production 2026-10-09). Apple's guidance is to follow the
 * system appearance (HIG review A-1); the project's own design spec says
 * light is primary. With no saved choice the app now follows the device.
 */

describe("theme preference", () => {
  it("follows the device when nothing is saved", () => {
    assert.equal(THEME_DEFAULT, "system");
    assert.equal(getThemePreferenceFromCookie(undefined), "system");
  });

  it("keeps an explicit choice", () => {
    assert.equal(getThemePreferenceFromCookie("light"), "light");
    assert.equal(getThemePreferenceFromCookie("dark"), "dark");
  });

  it("treats anything else as no choice", () => {
    assert.equal(getThemePreferenceFromCookie("purple"), "system");
  });

  it("resolves system to the device's appearance", () => {
    assert.equal(resolveTheme("system", true), "dark");
    assert.equal(resolveTheme("system", false), "light");
    assert.equal(resolveTheme("light", true), "light");
    assert.equal(resolveTheme("dark", false), "dark");
  });
});

/** Runs the boot script against a minimal document and matchMedia. */
function runBootScript(opts: { prefersDark: boolean; existing?: string }) {
  const attrs = new Map<string, string>(opts.existing ? [["data-theme", opts.existing]] : []);
  const documentElement = {
    hasAttribute: (name: string) => attrs.has(name),
    setAttribute: (name: string, value: string) => attrs.set(name, value),
  };
  const matchMedia = (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && opts.prefersDark,
  });
  new Function("document", "matchMedia", THEME_BOOT_SCRIPT)({ documentElement }, matchMedia);
  return attrs.get("data-theme");
}

describe("THEME_BOOT_SCRIPT", () => {
  it("sets the device's appearance before first paint", () => {
    assert.equal(runBootScript({ prefersDark: true }), "dark");
    assert.equal(runBootScript({ prefersDark: false }), "light");
  });

  it("leaves an explicit server-rendered choice alone", () => {
    assert.equal(runBootScript({ prefersDark: true, existing: "light" }), "light");
  });
});
