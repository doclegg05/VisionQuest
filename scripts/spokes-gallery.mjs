// scripts/spokes-gallery.mjs
// node scripts/spokes-gallery.mjs <before-dir|-> <after-dir> <out-dir>
// Builds a before/after page from two `spokes-visual` CI artifacts for Britt's review.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [beforeDir, afterDir, outDir] = process.argv.slice(2);
if (!beforeDir || !afterDir || !outDir) {
  console.error("usage: node scripts/spokes-gallery.mjs <before-dir|-> <after-dir> <out-dir>");
  process.exit(2);
}

const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function figure(side, file, label) {
  return `<figure><img src="${side}/${file}" alt="${side === "before" ? "Before" : "After"}: ${label}" loading="lazy"><figcaption>${side === "before" ? "Before" : "After"}</figcaption></figure>`;
}

mkdirSync(join(outDir, "after"), { recursive: true });
mkdirSync(join(outDir, "before"), { recursive: true });
const shots = readdirSync(afterDir).filter((f) => f.endsWith(".png")).sort();
const sections = shots.map((file) => {
  copyFileSync(join(afterDir, file), join(outDir, "after", file));
  const hasBefore = beforeDir !== "-" && existsSync(join(beforeDir, file));
  if (hasBefore) copyFileSync(join(beforeDir, file), join(outDir, "before", file));
  const label = escapeHtml(file.replace(/\.png$/, "").replaceAll("-", " "));
  return `<section><h2>${label}</h2><div class="pair">${hasBefore ? figure("before", file, label) : ""}${figure("after", file, label)}</div></section>`;
});

writeFileSync(join(outDir, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPOKES Design Review</title>
<style>
:root { --bg: #edf3f7; --ink: #004071; --muted: #60636b; --card: #ffffff; --line: #d1d3d4; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #00133f; --ink: #ffffff; --muted: rgba(255, 255, 255, 0.75); --card: #004071; --line: rgba(255, 255, 255, 0.12); } }
:root[data-theme="dark"] { --bg: #00133f; --ink: #ffffff; --muted: rgba(255, 255, 255, 0.75); --card: #004071; --line: rgba(255, 255, 255, 0.12); }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, sans-serif; }
h1 { font-family: Georgia, serif; font-weight: 400; margin: 0 0 24px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 0 auto 24px; max-width: 1400px; }
h2 { font-size: 17px; margin: 0 0 12px; text-transform: capitalize; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; }
figure { margin: 0; } img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; }
figcaption { color: var(--muted); font-size: 13px; margin-top: 4px; }
</style></head><body><h1>SPOKES Design Review</h1>
${sections.join("\n")}
</body></html>
`);
console.log(`${shots.length} screenshot(s) written to ${join(outDir, "index.html")}`);
