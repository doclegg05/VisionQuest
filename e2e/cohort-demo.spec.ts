import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Response as PlaywrightResponse,
} from "@playwright/test";
import { z } from "zod";
import {
  DEMO_CONTINUE_AS_PREFIX,
  DEMO_ENTER_INSTRUCTOR,
  DEMO_ENTER_STUDENT,
  DEMO_ENTRY_PENDING,
  DEMO_PRIVACY_NOTICE,
  DEMO_READ_ONLY_REFUSAL,
} from "../src/lib/demo/copy";
import { BENCH_CLASS, BENCH_INSTRUCTOR } from "./bench-fixtures";
import { E2E_CLASS, E2E_STUDENT, E2E_TEACHER } from "./fixtures";
import { BASE_URL } from "./helpers/auth";
import { createPrisma } from "./helpers/db";

/**
 * E2E: cohort demo mode, switch on.
 *
 * Runs in its own step of the e2e job in .github/workflows/ci.yml, which sets
 * COHORT_DEMO_MODE=true for the server and for this process. The build step
 * does NOT set it: the sign-in page and the proxy read the switch when a
 * request arrives, and this spec is the proof that they do.
 *
 * Its twin, e2e/cohort-demo-off.spec.ts, covers the switch off.
 *
 * Every button label and notice is looked up through src/lib/demo/copy.ts, so
 * a wording change there cannot leave a check passing on text nobody renders.
 *
 * No test here signs in through /api/auth/login. A demo session is a cookie the
 * demo endpoints set, so this step spends none of the 10-per-IP or 5-per-user
 * login budget the other e2e steps share.
 *
 * Fixtures: the e2e seed (scripts/seed-e2e-users.ts) and the bench cohort seed
 * (scripts/bench/seed-cohort.ts), both run earlier in the job. They are the
 * "other classes" the demo instructor must not be able to see.
 */
// Skips only off CI. Playwright exits 0 when every test in the named file is
// skipped, so a skip in CI would turn a lost or mistyped switch into a green step.
test.skip(
  process.env.COHORT_DEMO_MODE !== "true" && !process.env.CI,
  "Needs the app started with COHORT_DEMO_MODE=true (the 'E2E gate: cohort demo on' CI step).",
);

/** The answer to POST /api/demo/student. */
const StudentEntryBody = z.object({
  redirectTo: z.string(),
  student: z.object({ displayName: z.string().min(1) }),
});

const ClassListBody = z.object({
  classes: z.array(z.object({ name: z.string().min(1) })),
});

const DashboardBody = z.object({
  students: z.array(z.object({ id: z.string().min(1), displayName: z.string() })),
});

/**
 * Names, emails and class names that belong to people and classes OUTSIDE the
 * demo class. The demo instructor must see none of them anywhere.
 */
const OUTSIDE_THE_DEMO_CLASS = [
  E2E_STUDENT.displayName,
  E2E_STUDENT.email,
  E2E_TEACHER.displayName,
  E2E_TEACHER.email,
  BENCH_INSTRUCTOR.displayName,
  BENCH_INSTRUCTOR.email,
  E2E_CLASS.name,
  BENCH_CLASS.name,
] as const;

/** Every browser context a test opened, so one hook can close them all. */
const openContexts: BrowserContext[] = [];

test.afterAll(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

/**
 * A fresh browser context with its own cookies and its own network address.
 *
 * The per-network limit on new demo students (10 an hour) counts the first
 * X-Forwarded-For hop, and a request with no such header lands in one shared
 * bucket. Without a header per visitor, the retries this job runs after any
 * failure (retries: 2 under CI) could use up the hour's ten and turn one real
 * failure into a wall of 429s. The unit tests cover that limit; this spec is
 * about what a visitor sees, so each visitor gets an address of their own.
 */
async function newVisitor(browser: Browser): Promise<BrowserContext> {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  const context = await browser.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` },
  });
  openContexts.push(context);
  return context;
}

/**
 * Opens the sign-in page and waits until its buttons work.
 *
 * The demo block asks /api/auth/session once, from an effect, after the page
 * hydrates. That answer (a 401 for a visitor with no session) is the signal
 * that React has attached the click handlers. A click before it is silently
 * lost.
 */
async function openSignInPage(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/session"),
    page.goto("/"),
  ]);
}

function isPostTo(response: PlaywrightResponse, pathname: string): boolean {
  return response.request().method() === "POST" && new URL(response.url()).pathname === pathname;
}

/** Every path the page requests or navigates to, in order. The array fills as the page runs. */
function watchPaths(page: Page): string[] {
  const paths: string[] = [];
  page.on("request", (request) => paths.push(new URL(request.url()).pathname));
  page.on("framenavigated", (frame) => paths.push(new URL(frame.url()).pathname));
  return paths;
}

/** Starts a demo student straight from the endpoint, as a script or a second browser would. */
async function startStudent(context: BrowserContext): Promise<string> {
  const response = await context.request.post("/api/demo/student", { headers: { Origin: BASE_URL } });
  expect(response.status(), await response.text()).toBe(200);
  return StudentEntryBody.parse(await response.json()).student.displayName;
}

test.describe("A visitor's demo: the student, then the instructor", () => {
  // The tests below hand one student from the student side to the instructor
  // side, so a failure stops the rest, and a retry starts the whole group over.
  test.describe.configure({ mode: "serial" });

  let studentVisitor: { context: BrowserContext; displayName: string } | null = null;
  let instructorContext: BrowserContext | null = null;

  function requireStudentVisitor() {
    if (!studentVisitor) throw new Error("The student test did not finish, so there is no demo student to use.");
    return studentVisitor;
  }

  function requireInstructor() {
    if (!instructorContext) throw new Error("The instructor test did not finish, so there is no instructor session.");
    return instructorContext;
  }

  test("student button lands on welcome with the notice", async ({ browser }) => {
    const context = await newVisitor(browser);
    const page = await context.newPage();
    const paths = watchPaths(page);

    await openSignInPage(page);
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => isPostTo(candidate, "/api/demo/student")),
      page.getByRole("button", { name: DEMO_ENTER_STUDENT, exact: true }).click(),
    ]);
    expect(response.status()).toBe(200);
    const { student } = StudentEntryBody.parse(await response.json());

    // /dashboard sends a day-one student on to /welcome.
    await page.waitForURL(/\/welcome(\?|$)/);
    await expect(page.getByText(DEMO_PRIVACY_NOTICE)).toBeVisible();

    // A staff-made student is stopped at recovery setup before any other page.
    // A demo student has no password to recover, so no request or navigation
    // on the way to /welcome may touch it.
    expect(paths.filter((path) => path.startsWith("/recovery-setup"))).toEqual([]);

    studentVisitor = { context, displayName: student.displayName };
    await page.close();
  });

  test("returning visitor sees Continue as", async () => {
    const { context, displayName } = requireStudentVisitor();
    const page = await context.newPage();

    await page.goto("/");

    // The session cookie is SameSite strict, so the page cannot know who is
    // visiting until it asks once after loading. The link appears then.
    const continueLink = page.getByRole("link", { name: `${DEMO_CONTINUE_AS_PREFIX} ${displayName}`, exact: true });
    await expect(continueLink).toBeVisible({ timeout: 15_000 });
    await expect(continueLink).toHaveAttribute("href", "/dashboard");

    // The visitor can still start over as someone new.
    await expect(page.getByRole("button", { name: DEMO_ENTER_STUDENT, exact: true })).toBeEnabled();
    await page.close();
  });

  test("instructor sees the new student and nothing else", async ({ browser }) => {
    const { displayName } = requireStudentVisitor();
    const context = await newVisitor(browser);
    instructorContext = context;
    const page = await context.newPage();

    await openSignInPage(page);
    await page.getByRole("button", { name: DEMO_ENTER_INSTRUCTOR, exact: true }).click();
    await page.waitForURL(/\/teacher(\?|$)/);

    // The student made a few tests ago is on this page. Class data loads on
    // the page itself, so this waits for it.
    const studentOnPage = page.getByText(displayName, { exact: true }).filter({ visible: true });
    await expect(studentOnPage.first()).toBeVisible({ timeout: 20_000 });
    await page.close();
  });

  test("instructor sees nothing from outside the demo class", async () => {
    const instructor = requireInstructor();

    // A check that something is absent proves nothing if the thing was never
    // there. These rows come from the two seed steps earlier in the job, so
    // confirm they exist before looking for them.
    const prisma = createPrisma();
    try {
      for (const displayName of [E2E_STUDENT.displayName, E2E_TEACHER.displayName, BENCH_INSTRUCTOR.displayName]) {
        const found = await prisma.student.count({ where: { displayName } });
        expect(found, `"${displayName}" is not in the database, so its absence below proves nothing`).toBeGreaterThan(0);
      }
      for (const name of [E2E_CLASS.name, BENCH_CLASS.name]) {
        const found = await prisma.spokesClass.count({ where: { name } });
        expect(found, `Class "${name}" is not in the database, so its absence below proves nothing`).toBeGreaterThan(0);
      }
    } finally {
      await prisma.$disconnect();
    }

    // The demo instructor teaches one class.
    const classesResponse = await instructor.request.get("/api/teacher/classes");
    expect(classesResponse.status()).toBe(200);
    const { classes } = ClassListBody.parse(await classesResponse.json());
    expect(classes).toHaveLength(1);
    const demoClassName = classes[0].name;

    // The data behind the teacher pages, read straight from the API.
    for (const path of ["/api/teacher/classes", "/api/teacher/dashboard?page=1&limit=50", "/api/teacher/intervention-queue"]) {
      const response = await instructor.request.get(path);
      expect(response.status(), path).toBe(200);
      const text = await response.text();
      for (const outside of OUTSIDE_THE_DEMO_CLASS) {
        expect(text, `${path} carries "${outside}"`).not.toContain(outside);
      }
    }

    // The teacher pages that list students, classes or staff. The check reads
    // the page's whole text, hidden text and the data Next sends along
    // included, because a leak that is only hidden is still a leak. Each page
    // is waited on until the demo class shows, so the absence is not just a
    // page that has not loaded yet.
    const page = await instructor.newPage();
    // /teacher/connect matches students to job leads across a roster, which
    // once read every class's enrollments rather than the instructor's own.
    for (const path of ["/teacher", "/teacher/classes", "/teacher/orientation", "/teacher/connect"]) {
      await page.goto(path);
      const body = page.locator("body");
      await expect(body, `${path} never showed the demo class`).toContainText(demoClassName, { timeout: 20_000 });
      for (const outside of OUTSIDE_THE_DEMO_CLASS) {
        await expect(body, `${path} shows "${outside}"`).not.toContainText(outside);
      }
    }
    await page.close();
  });

  test("instructor can add a note", async () => {
    const { displayName } = requireStudentVisitor();
    const instructor = requireInstructor();
    const page = await instructor.newPage();

    // The student's database id, so the click below can aim at the one link
    // that opens the plain student page. Other links on the teacher home go to
    // the same student but land on other tabs (forms, goals), and the case
    // note form is on the Coach tab.
    const dashboardResponse = await instructor.request.get("/api/teacher/dashboard?page=1&limit=50");
    expect(dashboardResponse.status()).toBe(200);
    const { students } = DashboardBody.parse(await dashboardResponse.json());
    const demoStudent = students.find((student) => student.displayName === displayName);
    if (!demoStudent) throw new Error(`"${displayName}" is not on the demo instructor's dashboard.`);

    await page.goto("/teacher");
    await page.locator(`a[href="/teacher/students/${demoStudent.id}"]`).first().click();
    await page.waitForURL(new RegExp(`/teacher/students/${demoStudent.id}(\\?|#|$)`));

    // The student page loads its data on the page itself; the tab bar means
    // it has.
    await expect(page.getByRole("tab", { name: "Coach" })).toBeVisible({ timeout: 20_000 });

    const note = `Demo walkthrough note ${Date.now()}`;
    const noteForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add Note" }) });
    await noteForm.locator("textarea").fill(note);

    const [saved] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /^\/api\/teacher\/students\/[^/]+\/notes$/.test(new URL(response.url()).pathname),
      ),
      page.getByRole("button", { name: "Add Note" }).click(),
    ]);

    // Adding a note to a demo student is one of the few writes the demo
    // instructor is allowed. A 403 here means the fence is too tight.
    expect(saved.ok(), `The notes route answered ${saved.status()}`).toBe(true);
    await expect(page.getByText(note)).toBeVisible({ timeout: 20_000 });
    await page.close();
  });

  test("instructor cannot change program-wide content", async () => {
    const instructor = requireInstructor();

    const response = await instructor.request.post("/api/teacher/sage-snippets", {
      headers: { Origin: BASE_URL },
      data: { title: "Not allowed", content: "A demo instructor cannot add this." },
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ error: DEMO_READ_ONLY_REFUSAL });
  });
});

test.describe("Starting a demo", () => {
  test("two fresh visitors get two different students", async ({ browser }) => {
    const first = await startStudent(await newVisitor(browser));
    const second = await startStudent(await newVisitor(browser));

    expect(first).not.toBe(second);
  });

  test("both buttons stay disabled while the request is slow", async ({ browser }) => {
    const context = await newVisitor(browser);
    const page = await context.newPage();

    // Holds the answer until the test lets it go.
    let letItThrough = () => {};
    const held = new Promise<void>((resolve) => {
      letItThrough = resolve;
    });
    await page.route("**/api/demo/student", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await held;
      await route.continue();
    });

    try {
      await openSignInPage(page);
      await page.getByRole("button", { name: DEMO_ENTER_STUDENT, exact: true }).click();

      // The pressed button says the demo is starting, and a second request
      // cannot be started from either button.
      await expect(page.getByRole("button", { name: DEMO_ENTRY_PENDING, exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: DEMO_ENTER_INSTRUCTOR, exact: true })).toBeDisabled();
      await expect(page.getByRole("status")).toContainText(DEMO_ENTRY_PENDING);
    } finally {
      letItThrough();
    }

    // The held request was a real one, so the visitor now gets in.
    await page.waitForURL(/\/welcome(\?|$)/);
  });

  test("a refused request shows the server's message", async ({ browser }) => {
    const context = await newVisitor(browser);
    const page = await context.newPage();

    // Not one of the demo strings, so seeing it proves the page relays the
    // endpoint's own words and did not fall back to its generic message.
    const refusal = "The test endpoint says the demo is closed.";
    await page.route("**/api/demo/student", (route) =>
      route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: refusal }) }),
    );

    await openSignInPage(page);
    await page.getByRole("button", { name: DEMO_ENTER_STUDENT, exact: true }).click();

    await expect(page.getByRole("status")).toContainText(refusal);
    await expect(page.getByRole("button", { name: DEMO_ENTER_STUDENT, exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: DEMO_ENTER_INSTRUCTOR, exact: true })).toBeEnabled();
    await expect(page).toHaveURL(/\/$/);
  });
});
