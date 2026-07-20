"use client";

import { useState } from "react";
import { useProgression } from "@/components/progression/ProgressionProvider";
import {
  GOAL_LEVEL_META,
  type GoalLevel,
  type GoalStatus,
} from "@/lib/goals";
import {
  GOAL_RESOURCE_LINK_STATUS_LABELS,
  type GoalPlanEntry,
  type GoalResourceLinkStatus,
} from "@/lib/goal-resource-links";
import { apiFetch } from "@/lib/api";
import {
  Square,
  CheckSquare,
  PencilSimple,
  X,
  Plus,
  Sparkle,
  FolderOpen,
  SpeakerHigh,
} from "@phosphor-icons/react";

interface GoalRecord {
  id: string;
  level: GoalLevel;
  content: string;
  status: GoalStatus;
  parentId: string | null;
  createdAt: string;
}

interface GoalsPageClientProps {
  initialGoals: GoalRecord[];
  initialGoalPlans: GoalPlanEntry[];
}

const STUDENT_LINK_STATUSES: GoalResourceLinkStatus[] = ["assigned", "in_progress", "completed", "blocked"];

function createLinkStatusLookup(goalPlans: GoalPlanEntry[]) {
  return Object.fromEntries(
    goalPlans.flatMap((plan) => plan.links.map((link) => [link.id, link.status])),
  ) as Record<string, GoalResourceLinkStatus>;
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function resourceStatusOptions(currentStatus: GoalResourceLinkStatus): GoalResourceLinkStatus[] {
  return [...new Set([...STUDENT_LINK_STATUSES, currentStatus])];
}

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  rotation: number;
  rotationSpeed: number;
}

const activeParticles: ConfettiParticle[] = [];
let animationFrameId: number | null = null;

function triggerConfetti(clientX: number, clientY: number) {
  const canvas = document.getElementById("confetti-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Sync canvas size to screen
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ["#37b550", "#2a8a3c", "#007baf", "#d3b257", "#ad8806"];

  for (let i = 0; i < 40; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 5;
    activeParticles.push({
      x: clientX,
      y: clientY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2.5, // upward bias
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 5 + Math.random() * 5,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: -0.1 + Math.random() * 0.2,
    });
  }

  function update() {
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = activeParticles.length - 1; i >= 0; i--) {
      const p = activeParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.2; // gravity
      p.vx *= 0.97; // friction
      p.rotation += p.rotationSpeed;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();

      if (p.y > canvas.height || p.x < 0 || p.x > canvas.width) {
        activeParticles.splice(i, 1);
      }
    }

    if (activeParticles.length > 0) {
      animationFrameId = requestAnimationFrame(update);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      animationFrameId = null;
    }
  }

  if (animationFrameId === null) {
    update();
  }
}

export default function GoalsPageClient({ initialGoals, initialGoalPlans }: GoalsPageClientProps) {
  const { checkProgression } = useProgression();
  const [goals, setGoals] = useState(initialGoals);
  const [goalPlans, setGoalPlans] = useState(initialGoalPlans);
  const [linkStatusDrafts, setLinkStatusDrafts] = useState(() => createLinkStatusLookup(initialGoalPlans));
  const [, setSavingGoalId] = useState<string | null>(null);
  const [savingLinkId, setSavingLinkId] = useState<string | null>(null);
  const [, setCreatingGoal] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Redesign local interactive states
  const [expandedResources, setExpandedResources] = useState<Record<string, boolean>>({});
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingGoalContent, setEditingGoalContent] = useState("");

  const [addingWeeklyToParentId, setAddingWeeklyToParentId] = useState<string | null>(null);
  const [addingWeeklyContent, setAddingWeeklyContent] = useState("");

  const [addingTaskToParentId, setAddingTaskToParentId] = useState<string | null>(null);
  const [addingTaskContent, setAddingTaskContent] = useState("");

  const [addingMonthly, setAddingMonthly] = useState(false);
  const [addingMonthlyContent, setAddingMonthlyContent] = useState("");

  const [addingBhag, setAddingBhag] = useState(false);
  const [addingBhagContent, setAddingBhagContent] = useState("");

  // UX Enhancement state variables
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [sageModalGoal, setSageModalGoal] = useState<GoalRecord | null>(null);
  const [sageModalLoading, setSageModalLoading] = useState(false);
  const [sageResponse, setSageResponse] = useState<string>("");

  // Read Aloud Text-to-Speech Handler
  function handleReadAloud(id: string, text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    if (speakingId === id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  }

  // Localized Sage Scaffolding Modal Handler
  async function handleOpenAskSageModal(goal: GoalRecord) {
    setSageModalGoal(goal);
    setSageModalLoading(true);
    setSageResponse("");

    try {
      const promptText = `I have set a monthly goal: "${goal.content}". Can you suggest 3 to 4 actionable weekly milestones or tasks I can check off to achieve this goal? Please speak in encouraging, plain language suitable for a student.`;
      const res = await apiFetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: promptText }),
      });

      if (!res.ok) throw new Error("Could not contact Sage");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data?.text) {
                accumulated += data.text;
                setSageResponse(accumulated);
              }
            } catch {
              // Ignore chunk parse issues
            }
          }
        }
      }
    } catch {
      setSageResponse("Sorry, I had trouble reaching Sage right now. Please try again soon!");
    } finally {
      setSageModalLoading(false);
    }
  }

  function upsertGoalPlan(nextPlan: GoalPlanEntry) {
    setGoalPlans((current) => {
      const existingIndex = current.findIndex((plan) => plan.goalId === nextPlan.goalId);
      if (existingIndex === -1) {
        return [...current, nextPlan];
      }

      const updated = [...current];
      updated[existingIndex] = nextPlan;
      return updated;
    });
    setLinkStatusDrafts((current) => {
      const next = { ...current };
      for (const link of nextPlan.links) {
        next[link.id] = link.status;
      }
      return next;
    });
  }

  async function refreshGoalPlan(goalId: string) {
    const response = await fetch(`/api/goals/${goalId}/resources`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || "Could not load the updated goal plan.");
    }

    upsertGoalPlan({
      goalId,
      suggestions: payload?.suggestions || [],
      recommendations: payload?.recommendations || [],
      links: payload?.links || [],
    });
  }

  async function handleCreateGoal(level: GoalLevel, content: string, parentId: string | null = null) {
    const trimmed = content.trim();
    if (!trimmed) return;

    setCreatingGoal(true);
    setMessage(null);

    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level,
          content: trimmed,
          status: "active",
          parentId,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.goal) {
        throw new Error(payload?.error || "Could not create the goal.");
      }

      const createdGoal = payload.goal as GoalRecord;
      setGoals((current) => [...current, createdGoal]);
      await refreshGoalPlan(createdGoal.id);
      setMessage({ tone: "success", text: `${GOAL_LEVEL_META[level].label} added.` });
      await checkProgression();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not create the goal.",
      });
    } finally {
      setCreatingGoal(false);
    }
  }

  async function handleSaveInlineGoal(goalId: string, nextContent: string) {
    const trimmed = nextContent.trim();
    if (!trimmed) return;

    const goal = goals.find((item) => item.id === goalId);
    if (!goal) return;

    setSavingGoalId(goalId);
    setMessage(null);

    try {
      const response = await fetch(`/api/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: trimmed,
          status: goal.status,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.goal) {
        throw new Error(payload?.error || "Could not save the goal.");
      }

      const updatedGoal = payload.goal as GoalRecord;
      setGoals((current) =>
        current.map((item) => (item.id === goalId ? updatedGoal : item)),
      );
      setEditingGoalId(null);
      setMessage({ tone: "success", text: "Goal updated." });
      await checkProgression();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not save the goal.",
      });
    } finally {
      setSavingGoalId(null);
    }
  }

  async function handleToggleGoalStatus(goalId: string, currentStatus: GoalStatus, event?: React.MouseEvent) {
    const nextStatus: GoalStatus = currentStatus === "completed" ? "active" : "completed";
    
    if (nextStatus === "completed" && event) {
      triggerConfetti(event.clientX, event.clientY);
    }

    setSavingGoalId(goalId);
    setMessage(null);

    try {
      const response = await fetch(`/api/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.goal) {
        throw new Error(payload?.error || "Could not update goal status.");
      }

      const updatedGoal = payload.goal as GoalRecord;
      setGoals((current) =>
        current.map((item) => (item.id === goalId ? updatedGoal : item)),
      );
      await checkProgression();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not update status.",
      });
    } finally {
      setSavingGoalId(null);
    }
  }

  async function handleDismissGoal(goalId: string) {
    setSavingGoalId(goalId);
    setMessage(null);

    try {
      const response = await fetch(`/api/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "abandoned" }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.goal) {
        throw new Error(payload?.error || "Could not dismiss the goal.");
      }

      const updatedGoal = payload.goal as GoalRecord;
      setGoals((current) =>
        current.map((item) => (item.id === goalId ? updatedGoal : item)),
      );
      setMessage({ tone: "success", text: "Goal dismissed." });
      await checkProgression();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not dismiss the goal.",
      });
    } finally {
      setSavingGoalId(null);
    }
  }

  async function handleSaveLinkStatus(goalId: string, linkId: string) {
    const nextStatus = linkStatusDrafts[linkId];
    if (!nextStatus) return;

    setSavingLinkId(linkId);
    setMessage(null);

    try {
      const response = await fetch(`/api/goal-resource-links/${linkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update the resource status.");
      }

      await refreshGoalPlan(goalId);
      setMessage({ tone: "success", text: "Resource status updated." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not update the resource status.",
      });
    } finally {
      setSavingLinkId(null);
    }
  }

  // 1. Filter active goals
  const activeGoals = goals.filter((g) => g.status !== "abandoned");

  // 2. BHAG goals
  const bhags = activeGoals.filter((g) => g.level === "bhag");

  // 3. Build child mapping
  const childMap = new Map<string, GoalRecord[]>();
  for (const g of activeGoals) {
    if (g.parentId) {
      if (!childMap.has(g.parentId)) {
        childMap.set(g.parentId, []);
      }
      childMap.get(g.parentId)!.push(g);
    }
  }

  // 4. Monthly Goals
  const monthlyGoals = activeGoals.filter((g) => g.level === "monthly");

  // 5. Weekly Goals
  const weeklyGoals = activeGoals.filter((g) => g.level === "weekly");

  // 6. Daily Goals and Tasks
  const dailyGoals = activeGoals.filter((g) => g.level === "daily");
  const tasks = activeGoals.filter((g) => g.level === "task");

  // Helper to determine if a goal has a monthly goal ancestor
  const hasMonthlyAncestor = (g: GoalRecord): boolean => {
    let current: GoalRecord | undefined = g;
    while (current && current.parentId) {
      const parent: GoalRecord | undefined = activeGoals.find((p) => p.id === current!.parentId);
      if (parent && parent.level === "monthly") return true;
      current = parent;
    }
    return false;
  };

  // 7. Orphan/unsorted weekly/daily/tasks (not tied to any Monthly Goal)
  const orphanGoals = activeGoals.filter(
    (g) => g.level !== "bhag" && g.level !== "monthly" && !hasMonthlyAncestor(g)
  );

  return (
    <div className="space-y-6">
      {/* Confetti canvas overlay */}
      <canvas id="confetti-canvas" className="pointer-events-none fixed inset-0 z-50 h-screen w-screen" />

      <div className="surface-section p-5">
        <p className="text-sm leading-relaxed text-[var(--ink-muted)]">
          Build goals directly here, then use Sage when you want coaching help refining them into
          clearer next steps. Status changes stay visible to your instructor and keep your planning
          data aligned with the dashboard.
        </p>
      </div>

      {message ? (
        <div
          className={`surface-section p-4 text-sm ${
            message.tone === "success"
              ? "border border-[var(--border-strong)] bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
              : "border border-[var(--border-strong)] bg-[var(--urgency-critical-bg)] text-[var(--urgency-critical-text)]"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {/* BHAG Section — Gold-themed notepad card at top */}
      <div className="surface-section p-6 bg-gradient-to-br from-amber-50/80 to-orange-50/50 border-amber-200/80 dark:from-[#1b1c20] dark:to-[#171412] dark:border-amber-950/60 relative overflow-hidden rounded-2xl">
        <div className="tape-effect bg-amber-400/40 border-amber-400/20" />
        <div className="flex items-center gap-2 mb-3">
          <Sparkle className="text-amber-500 animate-pulse" size={24} weight="fill" />
          <h2 className="font-display text-2xl text-[var(--ink-strong)]">My Big Vision (BHAG)</h2>
        </div>
        <p className="text-sm text-[var(--ink-muted)] mb-4 leading-relaxed">
          Your Big Hairy Audacious Goal — the long-term career destination you are working toward.
        </p>

        {bhags.length > 0 ? (
          bhags.map((bhag) => (
            <div key={bhag.id} className="bg-white/80 dark:bg-black/20 p-4 rounded-xl border border-amber-200/60 dark:border-amber-900/40 shadow-sm">
              {editingGoalId === bhag.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSaveInlineGoal(bhag.id, editingGoalContent);
                  }}
                  className="flex flex-wrap gap-2"
                >
                  <input
                    type="text"
                    value={editingGoalContent}
                    onChange={(e) => setEditingGoalContent(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-amber-300 dark:border-amber-800 rounded-lg bg-[var(--surface-raised)] text-[var(--ink-strong)] focus:outline-none focus:ring-1 focus:ring-amber-500"
                    autoFocus
                  />
                  <button type="submit" className="primary-button px-4 py-2 text-xs">Save</button>
                  <button type="button" onClick={() => setEditingGoalId(null)} className="rounded-full border border-[var(--border)] px-4 py-2 text-xs text-[var(--ink-muted)]">Cancel</button>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-3 group">
                  <p className="text-lg font-medium text-[var(--ink-strong)] font-display italic leading-relaxed">
                    &ldquo;{bhag.content}&rdquo;
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleReadAloud(bhag.id, `My Big Vision: ${bhag.content}`)}
                      className={`p-1.5 rounded-full hover:bg-amber-100 dark:hover:bg-amber-950/60 text-[var(--ink-muted)] hover:text-amber-700 transition-colors ${speakingId === bhag.id ? "text-amber-600 animate-pulse bg-amber-50 dark:bg-amber-950/20" : ""}`}
                      aria-label="Read BHAG aloud"
                      title="Read BHAG aloud"
                    >
                      <SpeakerHigh size={16} weight={speakingId === bhag.id ? "fill" : "regular"} />
                    </button>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setEditingGoalId(bhag.id);
                          setEditingGoalContent(bhag.content);
                        }}
                        className="p-1.5 rounded-full hover:bg-amber-100 dark:hover:bg-amber-950/60 text-[var(--ink-muted)] hover:text-amber-700"
                        aria-label="Edit BHAG"
                      >
                        <PencilSimple size={16} />
                      </button>
                      <button
                        onClick={() => handleDismissGoal(bhag.id)}
                        className="p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-950/40 text-[var(--ink-muted)] hover:text-red-500"
                        aria-label="Dismiss BHAG"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="border border-dashed border-amber-300/60 dark:border-amber-900/40 rounded-xl p-4 text-center">
            {addingBhag ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreateGoal("bhag", addingBhagContent);
                  setAddingBhag(false);
                  setAddingBhagContent("");
                }}
                className="flex flex-wrap gap-2"
              >
                <input
                  type="text"
                  placeholder="What is your ultimate dream career? (e.g. Become a certified welder)"
                  value={addingBhagContent}
                  onChange={(e) => setAddingBhagContent(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-amber-300 dark:border-amber-800 rounded-lg bg-[var(--surface-raised)] text-[var(--ink-strong)] focus:outline-none focus:ring-1 focus:ring-amber-500"
                  autoFocus
                />
                <button type="submit" className="primary-button px-4 py-2 text-xs" disabled={!addingBhagContent.trim()}>Add</button>
                <button type="button" onClick={() => setAddingBhag(false)} className="rounded-full border border-[var(--border)] px-4 py-2 text-xs text-[var(--ink-muted)]">Cancel</button>
              </form>
            ) : (
              <button
                onClick={() => setAddingBhag(true)}
                className="text-amber-700 dark:text-amber-500 text-sm font-semibold hover:underline flex items-center gap-1.5 mx-auto"
              >
                <Plus size={16} weight="bold" /> Define your Big Vision
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Board Label */}
      <div className="pt-2 border-t border-[var(--border)]">
        <h2 className="font-display text-2xl text-[var(--ink-strong)]">My Goal Roadmap</h2>
        <p className="text-sm text-[var(--ink-muted)]">
          Manage your monthly plans, weekly milestones, and checklist items here.
        </p>
      </div>

      {/* Grid of Note Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        {monthlyGoals.map((monthly) => {
          const isMEditing = editingGoalId === monthly.id;
          const isMProposed = monthly.status === "proposed";
          const mWeekly = weeklyGoals.filter((w) => w.parentId === monthly.id);
          const mDirectTasks = orphanGoals.filter((o) => o.parentId === monthly.id);

          const goalPlan = goalPlans.find((p) => p.goalId === monthly.id) ?? {
            goalId: monthly.id,
            suggestions: [],
            recommendations: [],
            links: [],
          };

          // Find descendants (weekly goals and nested tasks)
          const descendants = activeGoals.filter((g) => {
            if (g.parentId === monthly.id && g.level === "weekly") return true;
            if (g.level === "task" || g.level === "daily") {
              const parent = activeGoals.find((p) => p.id === g.parentId);
              if (parent && parent.parentId === monthly.id) return true;
            }
            if (g.parentId === monthly.id && (g.level === "task" || g.level === "daily")) return true;
            return false;
          });

          const totalDescendants = descendants.length;
          const completedDescendants = descendants.filter((g) => g.status === "completed").length;
          const progressPercent = totalDescendants > 0 ? Math.round((completedDescendants / totalDescendants) * 100) : 0;

          return (
            <article key={monthly.id} className="organic-paper-card w-full shadow-md relative overflow-hidden transition-transform duration-300 hover:shadow-lg">
              <div className="tape-effect" />

              {/* Monthly Goal Header */}
              <div className="mb-4 pr-1">
                <div className="flex items-start justify-between gap-3 border-b border-dashed border-[var(--border)] pb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent-strong)]">
                        Monthly Plan
                      </span>
                      {isMProposed && (
                        <span className="rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 px-2 py-0.5 text-3xs font-semibold">
                          SAGE SUGGESTION
                        </span>
                      )}
                    </div>

                    {isMEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSaveInlineGoal(monthly.id, editingGoalContent);
                        }}
                        className="flex gap-2 mt-1"
                      >
                        <input
                          type="text"
                          value={editingGoalContent}
                          onChange={(e) => setEditingGoalContent(e.target.value)}
                          className="flex-1 px-2 py-1 text-sm border border-[var(--border)] rounded bg-[var(--surface-raised)] text-[var(--ink-strong)] focus:outline-none"
                          autoFocus
                        />
                        <button type="submit" className="text-xs text-[var(--accent-strong)] font-semibold">Save</button>
                        <button type="button" onClick={() => setEditingGoalId(null)} className="text-xs text-[var(--ink-muted)]">Cancel</button>
                      </form>
                    ) : (
                      <div className="group flex items-start justify-between mt-1">
                        <h3 className={`font-display text-lg text-[var(--ink-strong)] leading-snug break-words ${monthly.status === "completed" ? "line-through opacity-60" : ""}`}>
                          {monthly.content}
                        </h3>
                        <div className="opacity-0 group-hover:opacity-100 flex gap-2 ml-2 shrink-0">
                          <button
                            onClick={() => {
                              setEditingGoalId(monthly.id);
                              setEditingGoalContent(monthly.content);
                            }}
                            className="text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                            aria-label="Edit Monthly"
                          >
                            <PencilSimple size={16} />
                          </button>
                          <button
                            onClick={() => handleDismissGoal(monthly.id)}
                            className="text-[var(--ink-muted)] hover:text-red-500"
                            aria-label="Dismiss Monthly"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-xs text-[var(--ink-muted)]">
                      {formatCreatedAt(monthly.createdAt)}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleReadAloud(monthly.id, `Monthly Plan: ${monthly.content}`)}
                        className={`p-1.5 rounded-full hover:bg-[var(--border)] transition-colors text-[var(--ink-muted)] hover:text-[var(--ink-strong)] ${speakingId === monthly.id ? "text-emerald-500 animate-pulse bg-emerald-50 dark:bg-emerald-950/20" : ""}`}
                        aria-label="Read goal aloud"
                        title="Read goal aloud"
                      >
                        <SpeakerHigh size={15} weight={speakingId === monthly.id ? "fill" : "regular"} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenAskSageModal(monthly)}
                        className="flex items-center gap-1 px-2.5 py-1 text-3xs font-semibold rounded-full border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 transition-colors shrink-0"
                        title="Ask Sage to help break down this goal"
                      >
                        <Sparkle size={10} weight="fill" />
                        <span>Ask Sage</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Mountain Trail Progress Bar */}
                {totalDescendants > 0 && (
                  <div className="mt-3 mb-5 bg-slate-50/55 dark:bg-slate-900/30 p-2.5 rounded-xl border border-[var(--border)]/60">
                    <div className="flex justify-between items-center text-3xs font-bold uppercase tracking-wider text-[var(--ink-muted)] mb-1">
                      <span>Mountain Trail Progress</span>
                      <span>{progressPercent}% Complete ({completedDescendants}/{totalDescendants})</span>
                    </div>
                    <div className="relative h-2 w-full bg-slate-200 dark:bg-slate-800 rounded-full mt-3 mb-2 overflow-visible">
                      <div 
                        className="absolute top-0 left-0 h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${progressPercent}%` }}
                      />
                      <div 
                        className="absolute -top-3 flex items-center justify-center w-7 h-7 bg-white dark:bg-slate-900 border border-emerald-500 rounded-full shadow-sm transition-all duration-500 ease-out -ml-3.5 select-none"
                        style={{ left: `${progressPercent}%` }}
                      >
                        <span className="text-xs">🏃</span>
                      </div>
                      <div className="absolute -top-3.5 right-0 flex items-center justify-center w-7 h-7 text-xs select-none">
                        <span>🏔️</span>
                      </div>
                    </div>
                  </div>
                )}

                {isMProposed && (
                  <div className="mt-2 bg-indigo-50/80 dark:bg-indigo-950/20 p-2.5 rounded-lg border border-indigo-100 dark:border-indigo-950 text-xs text-indigo-900 dark:text-indigo-200">
                    <p className="font-semibold">Sage suggested this goal — ask your instructor to confirm it.</p>
                    <p className="mt-1">Not a good fit? You can dismiss it.</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleDismissGoal(monthly.id)}
                        className="border border-indigo-200 dark:border-indigo-900 bg-white dark:bg-black/30 text-indigo-700 dark:text-indigo-300 font-semibold rounded px-2.5 py-1 hover:bg-indigo-50 dark:hover:bg-indigo-950"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Checklist Items: Weekly Goals & Tasks */}
              <div className="space-y-3 mb-2">
                {/* Render Weekly Goals inside Monthly Card */}
                {mWeekly.map((weekly) => {
                  const isWEditing = editingGoalId === weekly.id;
                  const wTasks = dailyGoals.concat(tasks).filter((t) => t.parentId === weekly.id);

                  return (
                    <div key={weekly.id} className="pl-1">
                      {/* Weekly Goal Line */}
                      <div className="flex items-start gap-2.5 group">
                        <button
                          type="button"
                          onClick={(e) => handleToggleGoalStatus(weekly.id, weekly.status, e)}
                          className="p-2 -m-2 mt-0.5 text-[var(--ink-muted)] hover:text-[var(--accent-strong)] transition-colors shrink-0 flex items-center justify-center"
                          aria-label={weekly.status === "completed" ? "Mark incomplete" : "Mark complete"}
                        >
                          {weekly.status === "completed" ? (
                            <CheckSquare size={18} weight="fill" className="text-[var(--accent-strong)] animate-scale-pop" />
                          ) : (
                            <Square size={18} />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          {isWEditing ? (
                            <form
                              onSubmit={(e) => {
                                  e.preventDefault();
                                  handleSaveInlineGoal(weekly.id, editingGoalContent);
                                }}
                              className="flex gap-2"
                            >
                              <input
                                type="text"
                                value={editingGoalContent}
                                onChange={(e) => setEditingGoalContent(e.target.value)}
                                className="flex-1 px-2 py-0.5 text-sm border border-[var(--border)] rounded bg-[var(--surface-raised)] text-[var(--ink-strong)] focus:outline-none"
                                autoFocus
                              />
                              <button type="submit" className="text-xs text-[var(--accent-strong)] font-semibold">Save</button>
                              <button type="button" onClick={() => setEditingGoalId(null)} className="text-xs text-[var(--ink-muted)]">Cancel</button>
                            </form>
                          ) : (
                            <div className="flex items-start justify-between group/wline">
                              <span className={`text-sm font-semibold leading-relaxed break-words ${weekly.status === "completed" ? "line-through text-[var(--ink-muted)] opacity-60" : "text-[var(--ink-strong)]"}`}>
                                {weekly.content}
                              </span>
                              <div className="opacity-0 group-hover/wline:opacity-100 flex gap-1.5 ml-2 shrink-0">
                                <button
                                  onClick={() => {
                                    setEditingGoalId(weekly.id);
                                    setEditingGoalContent(weekly.content);
                                  }}
                                  className="p-2 -m-2 text-[var(--ink-muted)] hover:text-[var(--ink-strong)] flex items-center justify-center"
                                  aria-label="Edit Weekly"
                                >
                                  <PencilSimple size={14} />
                                </button>
                                <button
                                  onClick={() => handleDismissGoal(weekly.id)}
                                  className="p-2 -m-2 text-[var(--ink-muted)] hover:text-red-500 flex items-center justify-center"
                                  aria-label="Dismiss Weekly"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Sub-tasks under Weekly Goal */}
                      <div className="pl-6 border-l border-dashed border-[var(--border)] ml-2.5 mt-1.5 space-y-1.5">
                        {wTasks.map((task) => {
                          const isTEditing = editingGoalId === task.id;
                          return (
                            <div key={task.id} className="flex items-start gap-2 group/task">
                              <button
                                type="button"
                                onClick={(e) => handleToggleGoalStatus(task.id, task.status, e)}
                                className="p-2 -m-2 mt-0.5 text-[var(--ink-muted)] hover:text-[var(--accent-strong)] transition-colors shrink-0 flex items-center justify-center"
                                aria-label={task.status === "completed" ? "Mark incomplete" : "Mark complete"}
                              >
                                {task.status === "completed" ? (
                                  <CheckSquare size={16} weight="fill" className="text-[var(--accent-strong)] animate-scale-pop" />
                                ) : (
                                  <Square size={16} />
                                )}
                              </button>

                              <div className="flex-1 min-w-0">
                                {isTEditing ? (
                                  <form
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      handleSaveInlineGoal(task.id, editingGoalContent);
                                    }}
                                    className="flex gap-2"
                                  >
                                    <input
                                      type="text"
                                      value={editingGoalContent}
                                      onChange={(e) => setEditingGoalContent(e.target.value)}
                                      className="flex-1 px-2 py-0.5 text-sm border border-[var(--border)] rounded bg-[var(--surface-raised)] text-[var(--ink-strong)] focus:outline-none"
                                      autoFocus
                                    />
                                    <button type="submit" className="text-xs text-[var(--accent-strong)] font-semibold">Save</button>
                                    <button type="button" onClick={() => setEditingGoalId(null)} className="text-xs text-[var(--ink-muted)]">Cancel</button>
                                  </form>
                                ) : (
                                  <div className="flex items-start justify-between group/tline">
                                    <span className={`text-sm leading-relaxed break-words ${task.status === "completed" ? "line-through text-[var(--ink-muted)] opacity-60" : "text-[var(--ink-strong)]"}`}>
                                      {task.content}
                                    </span>
                                    <div className="opacity-0 group-hover/tline:opacity-100 flex gap-1.5 ml-2 shrink-0">
                                      <button
                                        onClick={() => {
                                          setEditingGoalId(task.id);
                                          setEditingGoalContent(task.content);
                                        }}
                                        className="p-2 -m-2 text-[var(--ink-muted)] hover:text-[var(--ink-strong)] flex items-center justify-center"
                                        aria-label="Edit Task"
                                      >
                                        <PencilSimple size={12} />
                                      </button>
                                      <button
                                        onClick={() => handleDismissGoal(task.id)}
                                        className="p-2 -m-2 text-[var(--ink-muted)] hover:text-red-500 flex items-center justify-center"
                                        aria-label="Dismiss Task"
                                      >
                                        <X size={12} />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {/* Add Task Creator */}
                        <div className="pl-6 py-0.5">
                          {addingTaskToParentId === weekly.id ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleCreateGoal("task", addingTaskContent, weekly.id);
                                setAddingTaskToParentId(null);
                                setAddingTaskContent("");
                              }}
                              className="flex gap-1.5"
                            >
                              <input
                                type="text"
                                placeholder="Type a task and press Enter..."
                                value={addingTaskContent}
                                onChange={(e) => setAddingTaskContent(e.target.value)}
                                className="flex-1 px-2 py-0.5 text-xs border border-[var(--border)] rounded bg-[var(--surface-raised)] text-[var(--ink-strong)] focus:outline-none"
                                autoFocus
                              />
                              <button type="submit" className="text-xs text-[var(--accent-strong)] font-semibold">Add</button>
                              <button type="button" onClick={() => setAddingTaskToParentId(null)} className="text-xs text-[var(--ink-muted)]">Cancel</button>
                            </form>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setAddingTaskToParentId(weekly.id);
                                setAddingTaskContent("");
                              }}
                              className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink-strong)] flex items-center gap-1 font-medium min-h-[48px]"
                            >
                              <Plus size={12} /> Add task
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Direct tasks/milestones on this Monthly Plan (not grouped by Weekly Goal) */}
                {mDirectTasks.map((item) => {
                  const isItemEditing = editingGoalId === item.id;
                  return (
                    <div key={item.id} className="pl-1 py-1 flex items-start gap-2.5 group">
                      <button
                        type="button"
                        onClick={(e) => handleToggleGoalStatus(item.id, item.status, e)}
                        className="p-2 -m-2 mt-0.5 text-[var(--ink-muted)] hover:text-[var(--accent-strong)] shrink-0 flex items-center justify-center"
                        aria-label={item.status === "completed" ? "Mark incomplete" : "Mark complete"}
                      >
                        {item.status === "completed" ? (
                          <CheckSquare size={16} weight="fill" className="text-[var(--accent-strong)] animate-scale-pop" />
                        ) : (
                          <Square size={16} />
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        {isItemEditing ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleSaveInlineGoal(item.id, editingGoalContent);
                            }}
                            className="flex gap-2"
                          >
                            <input
                              type="text"
                              value={editingGoalContent}
                              onChange={(e) => setEditingGoalContent(e.target.value)}
                              className="flex-1 px-2 py-0.5 text-sm border border-[var(--border)] rounded bg-[var(--surface-raised)] text-[var(--ink-strong)] focus:outline-none"
                              autoFocus
                            />
                            <button type="submit" className="text-xs text-[var(--accent-strong)] font-semibold">Save</button>
                            <button type="button" onClick={() => setEditingGoalId(null)} className="text-xs text-[var(--ink-muted)]">Cancel</button>
                          </form>
                        ) : (
                          <div className="flex items-start justify-between group/item">
                            <span className={`text-sm leading-relaxed break-words ${item.status === "completed" ? "line-through text-[var(--ink-muted)] opacity-60" : "text-[var(--ink-strong)]"}`}>
                              {item.content}
                            </span>
                            <div className="opacity-0 group-hover/item:opacity-100 flex gap-1.5 ml-2 shrink-0">
                              <button
                                onClick={() => {
                                  setEditingGoalId(item.id);
                                  setEditingGoalContent(item.content);
                                }}
                                className="p-2 -m-2 text-[var(--ink-muted)] hover:text-[var(--ink-strong)] flex items-center justify-center"
                                aria-label="Edit Item"
                              >
                                <PencilSimple size={12} />
                              </button>
                              <button
                                onClick={() => handleDismissGoal(item.id)}
                                className="p-2 -m-2 text-[var(--ink-muted)] hover:text-red-500 flex items-center justify-center"
                                aria-label="Dismiss Item"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Add Weekly Goal Creator inside Monthly Card */}
                <div className="pl-1 pt-1.5">
                  {addingWeeklyToParentId === monthly.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleCreateGoal("weekly", addingWeeklyContent, monthly.id);
                        setAddingWeeklyToParentId(null);
                        setAddingWeeklyContent("");
                      }}
                      className="flex gap-1.5"
                    >
                      <input
                        type="text"
                        placeholder="Type a weekly goal and press Enter..."
                        value={addingWeeklyContent}
                        onChange={(e) => setAddingWeeklyContent(e.target.value)}
                        className="flex-1 px-2.5 py-1 text-sm border border-[var(--border)] rounded bg-[var(--surface-raised)] text-[var(--ink-strong)] focus:outline-none"
                        autoFocus
                      />
                      <button type="submit" className="text-xs text-[var(--accent-strong)] font-semibold">Add</button>
                      <button type="button" onClick={() => setAddingWeeklyToParentId(null)} className="text-xs text-[var(--ink-muted)] font-medium">Cancel</button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAddingWeeklyToParentId(monthly.id);
                        setAddingWeeklyContent("");
                      }}
                      className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink-strong)] flex items-center gap-1 font-semibold"
                    >
                      <Plus size={14} /> Add weekly milestone
                    </button>
                  )}
                </div>
              </div>

              {/* Linked Resources Expandable Section */}
              {goalPlan.links.length > 0 && (
                <div className="border-t border-dashed border-[var(--border)] pt-2.5 mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedResources((prev) => ({
                        ...prev,
                        [monthly.id]: !prev[monthly.id],
                      }));
                    }}
                    className="w-full flex items-center justify-between text-2xs font-bold uppercase tracking-wider text-[var(--ink-muted)] hover:text-[var(--ink-strong)] py-1"
                  >
                    <span className="flex items-center gap-1">
                      <FolderOpen size={12} />
                      Learning Resources ({goalPlan.links.length})
                    </span>
                    <span>{expandedResources[monthly.id] ? "Collapse" : "Expand"}</span>
                  </button>

                  {expandedResources[monthly.id] && (
                    <div className="mt-2 space-y-2 pl-1 bg-[var(--surface-overlay)]/40 p-2.5 rounded-lg border border-[var(--border)]/60">
                      {goalPlan.links.map((link) => {
                        const draftStatus = linkStatusDrafts[link.id] ?? link.status;
                        const isSaving = savingLinkId === link.id;

                        return (
                          <div key={link.id} className="text-xs flex flex-col gap-1.5 border-b border-[var(--border)]/40 pb-2 last:border-b-0 last:pb-0">
                            <div className="flex justify-between items-start gap-2">
                              <div className="min-w-0">
                                <span className="font-semibold text-[var(--ink-strong)] break-words">
                                  {link.title}
                                </span>
                                {link.description && (
                                  <p className="text-[var(--ink-muted)] mt-0.5 break-words">{link.description}</p>
                                )}
                              </div>
                              {link.url && (
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 text-[var(--accent-blue)] hover:underline font-semibold"
                                >
                                  Open ↗
                                </a>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2 mt-1">
                              <select
                                value={draftStatus}
                                onChange={(e) => {
                                  const next = e.target.value as GoalResourceLinkStatus;
                                  setLinkStatusDrafts((prev) => ({
                                    ...prev,
                                    [link.id]: next,
                                  }));
                                }}
                                className="px-2 py-1 text-2xs border border-[var(--border)] rounded bg-[var(--surface-raised)] text-[var(--ink-strong)] focus:outline-none"
                              >
                                {resourceStatusOptions(link.status).map((status) => (
                                  <option key={status} value={status}>
                                    {GOAL_RESOURCE_LINK_STATUS_LABELS[status]}
                                  </option>
                                ))}
                              </select>

                              <button
                                type="button"
                                onClick={() => handleSaveLinkStatus(monthly.id, link.id)}
                                disabled={isSaving || draftStatus === link.status}
                                className="px-2 py-0.5 bg-[var(--accent-strong)] text-white font-semibold rounded text-3xs hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
                              >
                                {isSaving ? "Saving..." : "Update"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}

        {/* Orphan Goals Card — for tasks/weekly goals without a monthly parent */}
        {orphanGoals.length > 0 && (
          <article className="organic-paper-card w-full shadow-md relative overflow-hidden transition-transform duration-300 hover:shadow-lg">
            <div className="tape-effect bg-purple-400/30 border-purple-400/10" />

            <div className="mb-4 pr-1">
              <div className="flex items-start justify-between gap-3 border-b border-dashed border-[var(--border)] pb-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 block">
                    Additional Checklist
                  </span>
                  <h3 className="font-display text-lg text-[var(--ink-strong)] mt-1">
                    Other Tasks & Steps
                  </h3>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {orphanGoals.filter((g) => g.level === "weekly" || g.parentId === null).map((weeklyOrOrphan) => {
                const isItemEditing = editingGoalId === weeklyOrOrphan.id;
                return (
                  <div key={weeklyOrOrphan.id} className="pl-1 py-1 flex items-start gap-2.5 group">
                    <button
                      type="button"
                      onClick={() => handleToggleGoalStatus(weeklyOrOrphan.id, weeklyOrOrphan.status)}
                      className="mt-1 text-[var(--ink-muted)] hover:text-[var(--accent-strong)] shrink-0"
                    >
                      {weeklyOrOrphan.status === "completed" ? (
                        <CheckSquare size={16} weight="fill" className="text-[var(--accent-strong)]" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      {isItemEditing ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleSaveInlineGoal(weeklyOrOrphan.id, editingGoalContent);
                          }}
                          className="flex gap-2"
                        >
                          <input
                            type="text"
                            value={editingGoalContent}
                            onChange={(e) => setEditingGoalContent(e.target.value)}
                            className="flex-1 px-2 py-0.5 text-sm border border-[var(--border)] rounded bg-[var(--surface-raised)] text-[var(--ink-strong)] focus:outline-none"
                            autoFocus
                          />
                          <button type="submit" className="text-xs text-[var(--accent-strong)] font-semibold">Save</button>
                          <button type="button" onClick={() => setEditingGoalId(null)} className="text-xs text-[var(--ink-muted)]">Cancel</button>
                        </form>
                      ) : (
                        <div className="flex items-start justify-between group/item">
                          <span className={`text-sm leading-relaxed break-words ${weeklyOrOrphan.status === "completed" ? "line-through text-[var(--ink-muted)] opacity-60" : "text-[var(--ink-strong)]"}`}>
                            {weeklyOrOrphan.content}
                          </span>
                          <div className="opacity-0 group-hover/item:opacity-100 flex gap-1.5 ml-2 shrink-0">
                            <button
                              onClick={() => {
                                setEditingGoalId(weeklyOrOrphan.id);
                                setEditingGoalContent(weeklyOrOrphan.content);
                              }}
                              className="text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
                              aria-label="Edit Item"
                            >
                              <PencilSimple size={12} />
                            </button>
                            <button
                              onClick={() => handleDismissGoal(weeklyOrOrphan.id)}
                              className="text-[var(--ink-muted)] hover:text-red-500"
                              aria-label="Dismiss Item"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        )}

        {/* Add Monthly Goal Card — Styled like a dashed blank card */}
        <article className="rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-6 min-h-[220px] flex flex-col justify-center items-center text-center">
          {addingMonthly ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateGoal("monthly", addingMonthlyContent);
                setAddingMonthly(false);
                setAddingMonthlyContent("");
              }}
              className="w-full space-y-3"
            >
              <label htmlFor="new-monthly-goal" className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                Create Monthly Focus
              </label>
              <textarea
                id="new-monthly-goal"
                rows={3}
                placeholder="What milestone do you want to hit this month?"
                value={addingMonthlyContent}
                onChange={(e) => setAddingMonthlyContent(e.target.value)}
                className="textarea-field resize-none p-3 text-sm focus:outline-none"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button type="submit" className="primary-button px-4 py-2 text-xs" disabled={!addingMonthlyContent.trim()}>
                  Create Card
                </button>
                <button
                  type="button"
                  onClick={() => setAddingMonthly(false)}
                  className="rounded-full border border-[var(--border)] px-4 py-2 text-xs text-[var(--ink-muted)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div>
              <span className="text-3xl mb-2 block">📅</span>
              <h3 className="font-display text-lg text-[var(--ink-strong)] mb-1">Focus on a New Month</h3>
              <p className="text-xs text-[var(--ink-muted)] max-w-xs mb-4">
                Create a new monthly goal card to map out your weekly plans and checklist tasks.
              </p>
              <button
                type="button"
                onClick={() => setAddingMonthly(true)}
                className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--ink-strong)] transition hover:-translate-y-0.5 hover:bg-[var(--surface-raised)]"
              >
                Add Monthly Goal Card
              </button>
            </div>
          )}
        </article>
      </div>

      {/* Localized Sage Scaffolding Modal Helper */}
      {sageModalGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-[var(--surface)] border border-[var(--border-strong)] rounded-2xl max-w-lg w-full p-6 shadow-xl relative animate-scale-pop">
            <button
              onClick={() => {
                setSageModalGoal(null);
                setSageResponse("");
              }}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-[var(--surface-muted)] text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
              aria-label="Close modal"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                <Sparkle size={20} weight="fill" />
              </span>
              <div>
                <h3 className="font-display text-lg text-[var(--ink-strong)]">Scaffolding with Sage</h3>
                <p className="text-xs text-[var(--ink-muted)]">AI Coach guidance for breaking down your goal</p>
              </div>
            </div>

            <div className="bg-indigo-50/30 dark:bg-indigo-950/10 p-3.5 rounded-xl border border-indigo-100/50 dark:border-indigo-950/40 mb-4">
              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Goal Focus</p>
              <p className="text-sm font-medium text-[var(--ink-strong)] mt-1 italic">
                &ldquo;{sageModalGoal.content}&rdquo;
              </p>
            </div>

            <div className="max-h-[300px] overflow-y-auto border border-[var(--border)] rounded-xl p-4 bg-[var(--surface-muted)] text-sm text-[var(--ink-strong)] leading-relaxed whitespace-pre-line">
              {sageModalLoading && !sageResponse ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-[var(--ink-muted)]">
                  <div className="h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2" />
                  <p className="text-xs">Sage is thinking of active steps for you...</p>
                </div>
              ) : (
                sageResponse || "No suggestions received yet."
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setSageModalGoal(null);
                  setSageResponse("");
                }}
                className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)] px-5 py-2 text-xs font-semibold text-[var(--ink-strong)] hover:bg-[var(--border)] transition-colors min-h-[48px] flex items-center justify-center"
              >
                Got it, thanks!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
