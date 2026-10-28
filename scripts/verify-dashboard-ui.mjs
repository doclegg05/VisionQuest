// Isolated browser checks of actual dashboard/nav components. No database,
// authentication bypass, production request, or claim of API integration.
// Run: node scripts/verify-dashboard-ui.mjs
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { checkDashboardContrast } from "./dashboard-contrast-checks.mjs";

const root = process.cwd();
const contrastOnly = process.argv.includes("--contrast-only");
const temp = await mkdtemp(path.join(tmpdir(), "vq-dashboard-ui-"));
const evidence = path.join(root, "docs/audits/evidence/dashboard-ui");
await mkdir(evidence, { recursive: true });
const nextStep = { currentStepKey: "learn", title: "Complete your next learning milestone", description: "Work on the learning steps tied to your plan.", whyItMatters: "Build skills for the work you want to do.", actionLabel: "View My Learning", actionLink: "/learning", steps: [{ key: "orientation", label: "Orientation", status: "complete", description: "Program basics" }, { key: "discover", label: "Discover", status: "complete", description: "Explore careers" }, { key: "goal", label: "Goal", status: "complete", description: "Choose a direction" }, { key: "learn", label: "Learn", status: "active", description: "Build skills" }] };
const now = new Date().toISOString();
let tasks = Array.from({ length: 14 }, (_, i) => ({ id: `cm${String(i).padStart(23, "0")}`, studentId: "synthetic-student", title: i === 0 ? "Review your resume with your instructor" : `Practice task ${i + 1}`, description: "A synthetic task used only for UI checks.", personal: i !== 0, status: i % 3 === 0 ? "completed" : "open", priority: i % 2 === 0 ? "high" : "normal", dueAt: "2026-10-01T12:00:00.000Z", completedAt: i % 3 === 0 ? now : null, createdAt: now, updatedAt: now }));
const support = () => ({ nextStep, alertCount: 1, appointment: { id: "appointment", title: "Career planning check-in", startsAt: "2026-10-02T14:00:00.000Z", locationLabel: "Learning center" }, orientationItems: [], fetchedAt: new Date().toISOString() });
const overview = () => ({ fetchedAt: new Date().toISOString(), outcomes: [
  { label: "Learning", value: "2 certifications recorded", detail: "1 completed · 0 verified · 1 with unknown provenance. 1 confirmed goal linked to an active pathway.", href: "/learning" },
  { label: "Ready-to-Work", value: "3 of 8 requirements satisfied", detail: "Class applicability: required. 2 awaiting review. Completion: in progress; verification: self reported.", href: "/learning" },
  { label: "Employment", value: "2 applications recorded", detail: "Resume preparation is on file. Applications do not establish employment or placement.", href: "/career" },
  { label: "Education", value: "No education plan on file", detail: "Record your education goals in the existing planning workflow.", href: "/goals" },
] });
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import Dashboard from '${root}/src/app/(student)/dashboard/DashboardClient.tsx';
import NavBar from '${root}/src/components/ui/NavBar.tsx';
import {ThemeProvider} from '${root}/src/components/ui/ThemeProvider.tsx';
const params=new URLSearchParams(location.search); const role=params.get('role')||'student';
createRoot(document.getElementById('root')).render(<ThemeProvider initialTheme={params.get('theme')||'light'}><div className="app-frame min-h-screen"><NavBar role={role} studentName="Synthetic Student" navPhase={3} orientationComplete={true}/><main id="main-content" className="app-main min-h-screen overflow-y-auto pb-28 pt-20 md:ml-[19rem] md:pb-10 md:pr-5 md:pt-5"><div className="page-shell page-shell-wide min-w-0 space-y-6"><header><h1 className="font-display text-2xl font-semibold">Your dashboard</h1><p className="mt-1">Isolated synthetic browser check — no real student records.</p><a className="inline-flex min-h-11 items-center underline" href="/chat">Talk to Sage</a></header>{role==='student'?<Dashboard sessionId="synthetic-student"/>:<p>Staff navigation regression fixture</p>}</div></main></div></ThemeProvider>);`;
await build({ stdin: { contents: entry, loader: "tsx", resolveDir: root }, outfile: path.join(temp, "app.js"), bundle: true, format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "isolated-next", setup(b) {
  b.onResolve({ filter: /^next\/(link|image|navigation|dynamic)$/ }, (args) => ({ path: args.path, namespace: "shim" }));
  b.onLoad({ filter: /.*/, namespace: "shim" }, ({ path: name }) => ({ loader: "jsx", resolveDir: root, contents:
    name.endsWith("navigation") ? `export const usePathname=()=>location.pathname; const router={push:(url)=>location.assign(url),refresh:()=>{},replace:(url)=>location.replace(url)}; export const useRouter=()=>router; export const useSearchParams=()=>new URLSearchParams(location.search);` :
    name.endsWith("dynamic") ? `import React,{lazy,Suspense} from 'react'; export default function dynamic(loader,options){const C=lazy(loader);return function Dynamic(props){return <Suspense fallback={options?.loading?.()||null}><C {...props}/></Suspense>}}` :
    name.endsWith("image") ? `import React from 'react'; export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>}` :
    `import React from 'react'; export default React.forwardRef(function Link({prefetch,replace,scroll,...props},ref){return <a ref={ref} {...props}/>});` }));
} }] });
const css = await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") });
await writeFile(path.join(temp, "style.css"), css.css + '\n@font-face{font-family:VQBody;src:url(/body.woff2)}@font-face{font-family:VQDisplay;src:url(/display.woff2)}:root{--font-body:VQBody;--font-display:VQDisplay}');
let failures = { save: false, overview: false };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const json = (value, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/dashboard/overview") return failures.overview ? json({ error: "Synthetic overview outage" }, 503) : json(overview());
      if (url.pathname === "/api/dashboard/support") return json(support());
      if (url.pathname === "/api/dashboard/activity") return json({ statuses: ["open", "in_progress", "completed"].map((status) => ({ status, count: tasks.filter((t) => t.status === status).length })), completions: Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 29 + i); return { date: d.toISOString().slice(0, 10), count: i === 29 ? tasks.filter((t) => t.status === "completed").length : 0 }; }), unknownCompletionDates: 0, fetchedAt: new Date().toISOString() });
      if (url.pathname.startsWith("/api/tasks")) {
        if (req.method === "GET") {
          const q = url.searchParams; let filtered = tasks.filter((t) => (!q.get("search") || t.title.toLowerCase().includes(q.get("search").toLowerCase())) && (!q.get("status") || q.get("status") === "all" || t.status === q.get("status")) && (!q.get("priority") || q.get("priority") === "all" || t.priority === q.get("priority")));
          const sort = q.get("sort") || "dueAt"; filtered = filtered.sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * (q.get("direction") === "desc" ? -1 : 1));
          const page = Number(q.get("page") || 1), pageSize = Number(q.get("pageSize") || 10);
          return json({ tasks: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, fetchedAt: new Date().toISOString() });
        }
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        await new Promise((resolve) => setTimeout(resolve, contrastOnly ? 1500 : 100));
        if (failures.save) return json({ error: "Synthetic save failure. Try again." }, 503);
        if (req.method === "POST") { const task = { ...tasks[1], ...body, id: `cm${String(Date.now()).padStart(23, "0")}`, personal: true, updatedAt: new Date().toISOString() }; tasks.push(task); return json({ task, audited: true }); }
        if (url.pathname.endsWith("bulk-status")) {
          for (const selected of body.tasks) { const task = tasks.find((t) => t.id === selected.id); if (task.updatedAt !== selected.updatedAt) return json({ error: "Task changed" }, 409); }
          for (const selected of body.tasks) Object.assign(tasks.find((t) => t.id === selected.id), { status: body.status, updatedAt: new Date().toISOString(), completedAt: body.status === "completed" ? new Date().toISOString() : null });
          return json({ tasks, audited: true });
        }
        const task = tasks.find((t) => t.id === url.pathname.split("/").at(-1));
        if (task.updatedAt !== body.updatedAt) return json({ error: "Task changed" }, 409);
        if (req.method === "DELETE") { tasks = tasks.filter((t) => t.id !== task.id); return json({ deleted: true }); }
        Object.assign(task, body, { updatedAt: new Date().toISOString() }); return json({ task, audited: true });
      }
      return json({ notifications: [], unreadCount: 0 });
    }
    const assets = { "/app.css": [path.join(temp, "app.css"), "text/css"], "/app.js": [path.join(temp, "app.js"), "text/javascript"], "/style.css": [path.join(temp, "style.css"), "text/css"], "/body.woff2": [path.join(root, "prototypes/visionquest-redesign/assets/manrope-latin.woff2"), "font/woff2"], "/display.woff2": [path.join(root, "prototypes/visionquest-redesign/assets/sora-latin.woff2"), "font/woff2"] };
    if (assets[url.pathname]) { const [file, mime] = assets[url.pathname]; res.writeHead(200, { "Content-Type": mime }); return res.end(await readFile(file)); }
    if (/\.(svg|png|webp)$/.test(url.pathname)) { try { res.writeHead(200); return res.end(await readFile(path.join(root, "public", url.pathname))); } catch { res.end(); return; } }
    res.writeHead(200, { "Content-Type": "text/html" }); res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>VisionQuest synthetic dashboard check</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = { scope: "Actual UI components with isolated synthetic HTTP fixtures; NOT authentication, RLS, or database verification", checks: [], violations: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  // Fail closed on accidental external requests.
  await page.route("**/*", (route) => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.goto(`${url}/dashboard`);
  await page.getByRole("heading", { name: "My tasks" }).waitFor();
  await page.getByText("14 matching tasks").waitFor();
  if (contrastOnly) {
    await checkDashboardContrast({ page, url, evidence, report, failures });
  } else {
  // Capture both viewports/themes as one batch before interaction checks.
  for (const size of [{ name: "desktop", width: 1440, height: 1100 }, { name: "mobile", width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const theme of ["light", "dark"]) {
      await page.goto(`${url}/dashboard?theme=${theme}`);
      await page.getByText("14 matching tasks").waitFor();
      await page.getByText("View chart values as text").waitFor();
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      report.checks.push(`${size.name} ${theme}: page overflow ${overflow}`);
      const axe = await new AxeBuilder({ page }).include("#main-content").analyze();
      report.violations.push(...axe.violations.map((v) => ({ viewport: size.name, theme, id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })));
      await page.screenshot({ path: path.join(evidence, `${size.name}-${theme}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${url}/dashboard`);
  await page.getByRole("button", { name: "Add personal task", exact: true }).click();
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByText("Enter a task title.").waitFor();
  await page.getByLabel("Task title", { exact: true }).fill("Synthetic persistence check");
  await page.getByLabel("Details (optional)").fill("Only synthetic content.");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("Synthetic persistence");
  await page.getByText("1 matching tasks").waitFor();
  await page.reload();
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("Synthetic persistence");
  await page.getByText("1 matching tasks").waitFor(); report.checks.push("create + validation + persistence across reload (synthetic HTTP store)");
  await page.getByRole("button", { name: "Edit Synthetic persistence check" }).click();
  await page.getByLabel("Task title", { exact: true }).fill("Updated synthetic task");
  failures.save = true;
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Synthetic save failure" }).waitFor();
  assert.equal(await page.getByLabel("Task title", { exact: true }).inputValue(), "Updated synthetic task");
  failures.save = false;
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" }); report.checks.push("edit failure retains input; retry saves");
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("");
  await page.getByText("15 matching tasks").waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Page number" }).fill("1");
  await page.getByText("Show columns").click();
  await page.getByLabel("Due date", { exact: true }).uncheck();
  assert.equal(await page.getByRole("columnheader", { name: "Due date", exact: true }).count(), 0);
  await page.getByLabel("Due date", { exact: true }).check(); report.checks.push("search, explicit page, pagination, column visibility");
  await page.getByRole("checkbox", { name: "Select tasks on this page" }).check();
  await page.getByRole("button", { name: "Complete selected" }).click();
  await page.getByText("0 selected on this page").waitFor();
  await page.getByRole("button", { name: "Refresh dashboard" }).waitFor({ state: "visible" });
  failures.overview = true;
  await page.getByRole("button", { name: "Refresh dashboard" }).click();
  await page.getByText(/Showing last saved data/).waitFor();
  assert.equal(await page.getByText("2 applications recorded", { exact: true }).count(), 1);
  failures.overview = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click(); report.checks.push("bulk status and stale overview retains successful data");
  await page.waitForTimeout(700);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More navigation options" }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "More navigation options" }).evaluate((node) => node === document.activeElement), true);
  report.checks.push("mobile menu Escape and focus restoration");
  await page.getByRole("button", { name: "Add personal task", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "Add personal task", exact: true }).evaluate((node) => node === document.activeElement), true);
  report.checks.push("task dialog Escape and focus restoration");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${url}/teacher?role=teacher`);
  await page.getByRole("link", { name: "AI Review", exact: true }).waitFor();
  await page.getByRole("link", { name: "Classes", exact: true }).waitFor();
  report.checks.push("staff navigation retains Classes and AI Review");
  }
} catch (error) { report.errors.push(error.stack || String(error)); }
finally {
  await writeFile(path.join(evidence, contrastOnly ? "button-contrast.json" : "report.json"), JSON.stringify(report, null, 2));
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify(report, null, 2));
if (report.errors.length || report.violations.length || report.checks.some((c) => typeof c === "string" && c.endsWith("overflow true"))) process.exitCode = 1;
