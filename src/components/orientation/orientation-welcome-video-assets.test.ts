import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The welcome video is the one large file every new student downloads. These
// checks pin its size, its poster, the paths the component points at, and the
// long cache lifetime that a versioned file name makes safe.

const MAX_VIDEO_BYTES = 10_000_000;
const MAX_POSTER_BYTES = 100_000;
const ROOT = process.cwd();
const COMPONENT = readFileSync(
  join(ROOT, "src", "components", "orientation", "OrientationWelcomeVideo.tsx"),
  "utf8",
);

/** The `/media/...` value of an attribute such as src= or poster=, or null. */
function mediaPath(attribute: string, tag: string): string | null {
  const element = new RegExp(`<${tag}\\b[^>]*?>`).exec(COMPONENT);
  if (!element) return null;
  const value = new RegExp(`\\b${attribute}="(/media/[^"]+)"`).exec(element[0]);
  return value ? value[1] : null;
}

function publicFile(urlPath: string): string {
  return join(ROOT, "public", ...urlPath.split("/").filter(Boolean));
}

describe("orientation welcome video assets", () => {
  it("serves a video of 10 MB or less from a file that exists", () => {
    const src = mediaPath("src", "source");
    assert.ok(src, "the <source> has no /media/ src");
    assert.ok(existsSync(publicFile(src)), `${src} is missing from public/`);
    const bytes = statSync(publicFile(src)).size;
    assert.ok(bytes <= MAX_VIDEO_BYTES, `${src} is ${bytes} bytes, over ${MAX_VIDEO_BYTES}`);
  });

  it("versions the video file name so it can be cached for a year", () => {
    const src = mediaPath("src", "source");
    assert.match(src ?? "", /-v\d+\.mp4$/, "the video name must end in -v<N>.mp4");
  });

  it("sets a poster of 100 KB or less on the <video>", () => {
    const poster = mediaPath("poster", "video");
    assert.ok(poster, "the <video> has no /media/ poster");
    assert.ok(existsSync(publicFile(poster)), `${poster} is missing from public/`);
    const bytes = statSync(publicFile(poster)).size;
    assert.ok(bytes <= MAX_POSTER_BYTES, `${poster} is ${bytes} bytes, over ${MAX_POSTER_BYTES}`);
  });

  it("fetches only metadata before the student presses play", () => {
    const video = /<video\b[^>]*?>/.exec(COMPONENT);
    assert.ok(video, "no <video> element");
    assert.match(video[0], /\bpreload="metadata"/);
  });

  it("points the caption track at a file that exists", () => {
    const captions = mediaPath("src", "track");
    assert.ok(captions, "the <track> has no /media/ src");
    assert.ok(existsSync(publicFile(captions)), `${captions} is missing from public/`);
  });

  it("points the download link at the same video file", () => {
    const src = mediaPath("src", "source");
    const href = mediaPath("href", "a");
    assert.equal(href, src);
  });
});

describe("next.config.ts cache rule for /media/", () => {
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");

  it("caches /media/ for a year as immutable", () => {
    const rule = /source:\s*"\/media\/:path\*"\s*,\s*headers:\s*\[([^\]]*)\]/.exec(config);
    assert.ok(rule, 'no headers rule with source "/media/:path*"');
    assert.match(rule[1], /key:\s*"Cache-Control"/);
    assert.match(rule[1], /value:\s*"public, max-age=31536000, immutable"/);
  });
});
