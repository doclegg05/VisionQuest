/**
 * Browser harness for the goals roadmap layout. e2e/goals-layout.spec.ts
 * bundles this with esbuild, compiles the app's real globals.css through
 * Tailwind, and hit-tests the per-goal controls at phone, tablet, and desktop
 * widths. Network calls are stubbed; no app server or login is involved.
 */
import { createRoot } from "react-dom/client";
import GoalsPageClient from "@/components/goals/GoalsPageClient";
import { goal } from "@/components/goals/__tests__/fixtures";

const goals = [
  goal("b1", "bhag", "Become a certified welder"),
  goal("m1", "monthly", "Finish my resume and apply to jobs"),
  goal("w1", "weekly", "Draft the work history section", { parentId: "m1" }),
  goal("t1", "task", "List my last three jobs", { parentId: "w1" }),
  goal("t2", "task", "Ask Ms. Rivera to review it", { parentId: "w1" }),
  goal("m2", "monthly", "Get my GED math score above 145"),
  goal("w2", "weekly", "Practice fractions three nights", { parentId: "m2" }),
  goal("t3", "task", "Finish worksheet 4", { parentId: "w2" }),
  goal("m3", "monthly", "Earn my forklift certification"),
  goal("w3", "weekly", "Book the safety class", { parentId: "m3" }),
  goal("t5", "task", "Read the operator handbook chapter two", { parentId: "w3" }),
];

window.fetch = async () => new Response(JSON.stringify({}), { status: 200 });

createRoot(document.getElementById("root")!).render(<GoalsPageClient initialGoals={goals} initialGoalPlans={[]} />);
