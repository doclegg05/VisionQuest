# Sage Chat Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Graft next-generation chat UX (focus glow, slash-command palette, starter chips, animated typing dots, spring send button) onto the existing `ChatWindow`, and expose a full-page Sage experience to teachers and admins. All three portals share the same enhanced component.

**Architecture:** Enhance `ChatWindow` in place. Add two new presentational components (`CommandPalette`, `StarterChips`) wired through `ChatInput`. Introduce a role-aware command registry (`src/lib/chat/commands.ts`). Add `/teacher/chat` and `/admin/chat` route pages that reuse the same `ChatWindow` with a `role` prop. Default new conversations on those routes to role-appropriate system-prompt stages.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4, `framer-motion@12` (installed), `@phosphor-icons/react` (installed), `clsx` + `tailwind-merge` (to install). Test runner: `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-04-17-sage-chat-redesign-design.md`

---

## File map

### Create

| Path | Responsibility |
|------|----------------|
| `src/lib/utils.ts` | `cn(...inputs)` helper |
| `src/lib/chat/commands.ts` | Slash-command registry + starter-chip registry + filter helpers |
| `src/lib/chat/commands.test.ts` | Unit tests for filter logic |
| `src/components/chat/CommandPalette.tsx` | Slash palette UI (dropdown, keyboard nav, role-filtered) |
| `src/components/chat/CommandPalette.test.tsx` | Palette behavior tests |
| `src/components/chat/StarterChips.tsx` | 4 starter chips on empty state |
| `src/components/chat/StarterChips.test.tsx` | Chip rendering tests |
| `src/app/(teacher)/teacher/chat/page.tsx` | Teacher full-page chat route |
| `src/app/(admin)/admin/chat/page.tsx` | Admin full-page chat route |

### Modify

| Path | Change |
|------|--------|
| `package.json` | Add `clsx` + `tailwind-merge` |
| `src/components/chat/ChatInput.tsx` | Integrate palette, focus glow, spring send button |
| `src/components/chat/TypingIndicator.tsx` | Swap CSS `animate-bounce` for framer-motion stagger |
| `src/components/chat/ChatWindow.tsx` | Accept `role` + `defaultStage` props, mount `StarterChips` on empty state |
| `src/lib/sage/system-prompts.ts` | Add `admin_assistant` stage |
| `src/components/ui/NavBar.tsx` | Add `Sage` entry to `STAFF_ITEMS` and `ADMIN_ITEMS` |

### Dependencies between tasks

```
Task 1 (deps + cn)
  └─ Task 2 (commands.ts) ──┐
                            ├─ Task 3 (CommandPalette)
                            └─ Task 4 (StarterChips)
                                      ├─ Task 5 (ChatInput refactor)
                                      ├─ Task 6 (TypingIndicator)
                                      └─ Task 7 (ChatInput visuals)
                                                ├─ Task 8 (ChatWindow role + empty state)
                                                ├─ Task 9 (admin_assistant stage)
                                                ├─ Task 10 (teacher page)
                                                └─ Task 11 (admin page)
                                                          └─ Task 12 (NavBar)
                                                                    └─ Task 13 (verify stage defaulting)
```

---

## Task 1: Install deps + create `cn` helper

**Files:**
- Modify: `package.json`
- Create: `src/lib/utils.ts`

- [ ] **Step 1: Install clsx and tailwind-merge**

Run:
```bash
npm install clsx tailwind-merge
```

Expected: both packages appear under `dependencies` in `package.json`. No build errors.

- [ ] **Step 2: Create the `cn` helper**

Create `src/lib/utils.ts` with:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/utils.ts
git commit -m "feat(chat): add cn helper + clsx/tailwind-merge deps"
```

---

## Task 2: Command data + filter helpers

**Files:**
- Create: `src/lib/chat/commands.ts`
- Create: `src/lib/chat/commands.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/chat/commands.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMMANDS,
  STARTER_CHIPS,
  filterCommands,
  getStarterChips,
} from "./commands";

describe("filterCommands", () => {
  it("returns only commands matching the current role", () => {
    const student = filterCommands("", "student");
    assert.ok(student.length > 0, "expected student commands");
    assert.ok(student.every((c) => c.roles.includes("student")));

    const teacher = filterCommands("", "teacher");
    assert.ok(teacher.every((c) => c.roles.includes("teacher")));
    assert.notDeepEqual(
      student.map((c) => c.slash).sort(),
      teacher.map((c) => c.slash).sort(),
      "student and teacher should have different command sets",
    );
  });

  it("filters by prefix match on the slash token", () => {
    const result = filterCommands("/go", "student");
    assert.ok(result.length >= 1);
    assert.ok(result.every((c) => c.slash.startsWith("/go")));
  });

  it("is case-insensitive for the prefix", () => {
    const lower = filterCommands("/goal", "student");
    const upper = filterCommands("/GOAL", "student");
    assert.deepEqual(
      lower.map((c) => c.slash),
      upper.map((c) => c.slash),
    );
  });

  it("returns empty array when input has no leading slash", () => {
    const result = filterCommands("hello", "student");
    assert.deepEqual(result, []);
  });
});

describe("getStarterChips", () => {
  it("returns exactly 4 chips per role", () => {
    assert.equal(getStarterChips("student").length, 4);
    assert.equal(getStarterChips("teacher").length, 4);
    assert.equal(getStarterChips("admin").length, 4);
  });

  it("each chip has a non-empty label and prefill", () => {
    for (const role of ["student", "teacher", "admin"] as const) {
      for (const chip of getStarterChips(role)) {
        assert.ok(chip.label.trim().length > 0);
        assert.ok(chip.prefill.trim().length > 0);
      }
    }
  });
});

describe("COMMANDS registry", () => {
  it("every command has unique slash", () => {
    const slashes = COMMANDS.map((c) => c.slash);
    assert.equal(new Set(slashes).size, slashes.length);
  });

  it("every command has at least one role", () => {
    assert.ok(COMMANDS.every((c) => c.roles.length > 0));
  });
});

describe("STARTER_CHIPS registry", () => {
  it("has entries for all three roles", () => {
    assert.ok("student" in STARTER_CHIPS);
    assert.ok("teacher" in STARTER_CHIPS);
    assert.ok("admin" in STARTER_CHIPS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx tsx --test src/lib/chat/commands.test.ts
```

Expected: FAIL with "Cannot find module './commands'" or equivalent.

- [ ] **Step 3: Create the commands module**

Create `src/lib/chat/commands.ts`:

```typescript
export type ChatRole = "student" | "teacher" | "admin";

export interface SlashCommand {
  slash: string;
  label: string;
  description: string;
  prefill: string;
  roles: ChatRole[];
}

export interface StarterChip {
  label: string;
  prefill: string;
}

export const COMMANDS: SlashCommand[] = [
  // Student
  {
    slash: "/goal",
    label: "Set a goal",
    description: "Capture a new goal with Sage's help",
    prefill: "Help me set a new goal for ",
    roles: ["student"],
  },
  {
    slash: "/plan",
    label: "Plan my week",
    description: "Build a plan for the week ahead",
    prefill: "Plan my week — here's what I'm working on: ",
    roles: ["student"],
  },
  {
    slash: "/reflect",
    label: "Reflect on today",
    description: "Talk through how your day went",
    prefill: "Here's how today went: ",
    roles: ["student"],
  },
  {
    slash: "/stuck",
    label: "I'm stuck",
    description: "Ask Sage for help getting unstuck",
    prefill: "I'm stuck on ",
    roles: ["student"],
  },
  {
    slash: "/next",
    label: "What's next?",
    description: "Ask what to work on next",
    prefill: "What should I work on next?",
    roles: ["student"],
  },
  {
    slash: "/cert",
    label: "Ask about a certification",
    description: "Get info about a SPOKES certification",
    prefill: "Tell me about the ",
    roles: ["student"],
  },

  // Teacher
  {
    slash: "/student",
    label: "Ask about a student",
    description: "Discuss a specific student's progress",
    prefill: "Tell me about ",
    roles: ["teacher"],
  },
  {
    slash: "/class",
    label: "Class snapshot",
    description: "Overview of your current class",
    prefill: "Give me a snapshot of my current class.",
    roles: ["teacher"],
  },
  {
    slash: "/intervene",
    label: "Draft an intervention",
    description: "Draft an intervention message",
    prefill: "Draft an intervention message for ",
    roles: ["teacher"],
  },
  {
    slash: "/email",
    label: "Draft a student email",
    description: "Compose communication for a student",
    prefill: "Draft a student email about ",
    roles: ["teacher"],
  },
  {
    slash: "/policy",
    label: "Policy lookup",
    description: "Look up a SPOKES program policy",
    prefill: "What's the SPOKES policy on ",
    roles: ["teacher"],
  },
  {
    slash: "/form",
    label: "Find a form",
    description: "Locate a program form and its purpose",
    prefill: "Where's the ",
    roles: ["teacher"],
  },

  // Admin
  {
    slash: "/usage",
    label: "Platform usage",
    description: "Review platform usage data",
    prefill: "Show me platform usage for ",
    roles: ["admin"],
  },
  {
    slash: "/report",
    label: "Generate a report",
    description: "Build a custom report",
    prefill: "Generate a report on ",
    roles: ["admin"],
  },
  {
    slash: "/outcomes",
    label: "Student outcomes",
    description: "Review student outcome trends",
    prefill: "Show me student outcomes for ",
    roles: ["admin"],
  },
  {
    slash: "/audit",
    label: "Audit activity",
    description: "Review recent admin activity",
    prefill: "Audit recent activity in ",
    roles: ["admin"],
  },
];

export const STARTER_CHIPS: Record<ChatRole, StarterChip[]> = {
  student: [
    { label: "Set a goal", prefill: "Help me set a new goal for " },
    { label: "Plan my week", prefill: "Plan my week — here's what I'm working on: " },
    { label: "I'm stuck", prefill: "I'm stuck on " },
    { label: "What's next?", prefill: "What should I work on next?" },
  ],
  teacher: [
    { label: "Class snapshot", prefill: "Give me a snapshot of my current class." },
    { label: "Draft an intervention", prefill: "Draft an intervention message for " },
    { label: "Policy lookup", prefill: "What's the SPOKES policy on " },
    { label: "Find a form", prefill: "Where's the " },
  ],
  admin: [
    { label: "Usage this week", prefill: "Show me platform usage for this week." },
    { label: "Report", prefill: "Generate a report on " },
    { label: "Outcomes", prefill: "Show me student outcomes for " },
    { label: "Audit activity", prefill: "Audit recent activity in " },
  ],
};

export function filterCommands(input: string, role: ChatRole): SlashCommand[] {
  if (!input.startsWith("/")) return [];
  const needle = input.toLowerCase();
  return COMMANDS.filter(
    (c) => c.roles.includes(role) && c.slash.toLowerCase().startsWith(needle),
  );
}

export function getStarterChips(role: ChatRole): StarterChip[] {
  return STARTER_CHIPS[role];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx tsx --test src/lib/chat/commands.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/commands.ts src/lib/chat/commands.test.ts
git commit -m "feat(chat): add role-aware slash command + starter chip registry"
```

---

## Task 3: CommandPalette component

**Files:**
- Create: `src/components/chat/CommandPalette.tsx`
- Create: `src/components/chat/CommandPalette.test.tsx`

`CommandPalette` is a controlled UI component: parent owns the input state and the "is open" state. Palette renders a filtered list, emits selection events. Pure presentation, no backend.

- [ ] **Step 1: Write failing test**

Create `src/components/chat/CommandPalette.test.tsx`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const html = renderToString(
      <CommandPalette
        open={false}
        input="/"
        role="student"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    assert.equal(html, "");
  });

  it("renders student commands when open with student role", () => {
    const html = renderToString(
      <CommandPalette
        open={true}
        input="/"
        role="student"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    assert.ok(html.includes("/goal"), "expected /goal in markup");
    assert.ok(html.includes("Set a goal"), "expected label in markup");
  });

  it("filters list when input is more specific", () => {
    const html = renderToString(
      <CommandPalette
        open={true}
        input="/go"
        role="student"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    assert.ok(html.includes("/goal"));
    assert.ok(!html.includes("/reflect"), "should not include non-matching commands");
  });

  it("renders empty-state message when no commands match", () => {
    const html = renderToString(
      <CommandPalette
        open={true}
        input="/xyz-nomatch"
        role="student"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    assert.ok(html.toLowerCase().includes("no matching"));
  });

  it("only shows commands for the current role", () => {
    const html = renderToString(
      <CommandPalette
        open={true}
        input="/"
        role="admin"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    assert.ok(html.includes("/audit"), "admin command present");
    assert.ok(!html.includes("/goal"), "student command absent");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx tsx --test src/components/chat/CommandPalette.test.tsx
```

Expected: FAIL with "Cannot find module './CommandPalette'".

- [ ] **Step 3: Implement CommandPalette**

Create `src/components/chat/CommandPalette.tsx`:

```typescript
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type ChatRole, type SlashCommand } from "@/lib/chat/commands";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  input: string;
  role: ChatRole;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export function CommandPalette({ open, input, role, onSelect, onClose }: CommandPaletteProps) {
  const [highlightIndex, setHighlightIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => filterCommands(input, role), [input, role]);

  useEffect(() => {
    if (highlightIndex >= matches.length) {
      setHighlightIndex(0);
    }
  }, [matches, highlightIndex]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => (matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length));
      } else if (e.key === "Enter") {
        if (matches[highlightIndex]) {
          e.preventDefault();
          onSelect(matches[highlightIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, matches, highlightIndex, onSelect, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[0_24px_64px_rgba(7,23,43,0.18)] backdrop-blur-md"
      role="dialog"
      aria-label="Sage command palette"
    >
      {matches.length === 0 ? (
        <div className="px-4 py-3 text-sm text-[var(--ink-muted)]">
          No matching commands. Keep typing to send a regular message.
        </div>
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Available commands"
          className="max-h-64 overflow-y-auto py-1"
        >
          {matches.map((cmd, i) => (
            <li
              key={cmd.slash}
              role="option"
              aria-selected={i === highlightIndex}
              onMouseEnter={() => setHighlightIndex(i)}
              onClick={() => onSelect(cmd)}
              className={cn(
                "flex cursor-pointer items-baseline gap-3 px-4 py-2.5 text-sm",
                i === highlightIndex
                  ? "bg-[var(--surface-interactive-hover)] text-[var(--ink-strong)]"
                  : "text-[var(--ink-strong)]",
              )}
            >
              <span className="font-mono text-[13px] font-semibold text-[var(--accent-strong)]">
                {cmd.slash}
              </span>
              <span className="font-medium">{cmd.label}</span>
              <span className="truncate text-xs text-[var(--ink-muted)]">
                {cmd.description}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx tsx --test src/components/chat/CommandPalette.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/CommandPalette.tsx src/components/chat/CommandPalette.test.tsx
git commit -m "feat(chat): add role-aware slash command palette"
```

---

## Task 4: StarterChips component

**Files:**
- Create: `src/components/chat/StarterChips.tsx`
- Create: `src/components/chat/StarterChips.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/chat/StarterChips.test.tsx`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { StarterChips } from "./StarterChips";

describe("StarterChips", () => {
  it("renders 4 chips for student role", () => {
    const html = renderToString(<StarterChips role="student" onSelect={() => {}} />);
    const buttonCount = (html.match(/<button/g) ?? []).length;
    assert.equal(buttonCount, 4);
  });

  it("renders role-specific labels for teacher", () => {
    const html = renderToString(<StarterChips role="teacher" onSelect={() => {}} />);
    assert.ok(html.includes("Class snapshot"));
    assert.ok(!html.includes("Set a goal"));
  });

  it("renders role-specific labels for admin", () => {
    const html = renderToString(<StarterChips role="admin" onSelect={() => {}} />);
    assert.ok(html.includes("Outcomes"));
    assert.ok(!html.includes("Class snapshot"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx tsx --test src/components/chat/StarterChips.test.tsx
```

Expected: FAIL with "Cannot find module './StarterChips'".

- [ ] **Step 3: Implement StarterChips**

Create `src/components/chat/StarterChips.tsx`:

```typescript
"use client";

import { getStarterChips, type ChatRole } from "@/lib/chat/commands";

interface StarterChipsProps {
  role: ChatRole;
  onSelect: (prefill: string) => void;
}

export function StarterChips({ role, onSelect }: StarterChipsProps) {
  const chips = getStarterChips(role);

  return (
    <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Conversation starters">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={() => onSelect(chip.prefill)}
          className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2 text-sm font-medium text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-interactive)]"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx tsx --test src/components/chat/StarterChips.test.tsx
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/StarterChips.tsx src/components/chat/StarterChips.test.tsx
git commit -m "feat(chat): add role-aware starter chips for empty chat state"
```

---

## Task 5: Refactor ChatInput to integrate CommandPalette

**Files:**
- Modify: `src/components/chat/ChatInput.tsx`

`ChatInput` gains:
- A `role` prop (defaults to `"student"`)
- Palette-open state (`true` when input starts with `/`)
- `onSelect` handler that replaces the input with the command's prefill
- The palette mounted above the textarea (absolute positioning)

No new tests — existing tests (if any) + manual verification in Task 8.

- [ ] **Step 1: Replace the ChatInput file**

Overwrite `src/components/chat/ChatInput.tsx` with:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CommandPalette } from "./CommandPalette";
import { type ChatRole } from "@/lib/chat/commands";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  compact?: boolean;
  role?: ChatRole;
}

export default function ChatInput({ onSend, disabled, compact, role = "student" }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevDisabledRef = useRef(disabled);

  useEffect(() => {
    if (prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  // Open palette only when the FIRST char is "/" and there's no space yet.
  useEffect(() => {
    const shouldOpen = message.startsWith("/") && !message.includes(" ");
    setPaletteOpen(shouldOpen);
  }, [message]);

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setMessage("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
  }, [message, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // When palette is open, let it handle Enter/Arrow/Escape via its own listener.
    if (paletteOpen && (e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape")) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      const scrollHeight = el.scrollHeight;
      el.style.height = "auto";
      requestAnimationFrame(() => {
        el.style.height = Math.min(scrollHeight, 160) + "px";
      });
    }
  };

  const handleSelectCommand = useCallback(
    (command: { prefill: string }) => {
      setMessage(command.prefill);
      setPaletteOpen(false);
      // Keep focus in textarea and place caret at end
      const el = textareaRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(command.prefill.length, command.prefill.length);
        });
      }
    },
    [],
  );

  return (
    <div className={`border-t border-[var(--chat-input-border)] bg-[var(--chat-input-bg)] backdrop-blur ${compact ? "p-2" : "p-4"}`}>
      <div className={`flex items-end gap-2 ${compact ? "" : "mx-auto max-w-4xl gap-3"}`}>
        <div className="relative flex-1">
          <CommandPalette
            open={paletteOpen && !disabled}
            input={message}
            role={role}
            onSelect={handleSelectCommand}
            onClose={() => setPaletteOpen(false)}
          />
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={role === "student" ? "Type your message... (try /goal)" : "Type your message... (try /)"}
            disabled={disabled}
            rows={1}
            aria-label="Message to Sage"
            aria-autocomplete={paletteOpen ? "list" : undefined}
            aria-expanded={paletteOpen}
            className={`textarea-field w-full resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] overflow-y-auto ${compact ? "min-h-[42px] px-3 py-2 text-sm" : "min-h-[54px] px-4 py-3 text-base"}`}
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={disabled || !message.trim()}
          aria-label="Send message"
          type="button"
          className={`primary-button text-sm disabled:cursor-not-allowed disabled:opacity-60 ${compact ? "px-3 py-2.5" : "px-5 py-3.5"}`}
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ChatInput.tsx
git commit -m "feat(chat): integrate slash command palette into ChatInput"
```

---

## Task 6: Upgrade TypingIndicator with framer-motion

**Files:**
- Modify: `src/components/chat/TypingIndicator.tsx`

Keep the same outer layout and color tokens; swap the CSS `animate-bounce` for framer-motion staggered animation, which respects `useReducedMotion()` automatically when wrapped in a `MotionConfig`. Here we honor reduced-motion by using `useReducedMotion` directly.

- [ ] **Step 1: Replace the TypingIndicator file**

Overwrite `src/components/chat/TypingIndicator.tsx`:

```typescript
"use client";

import { motion, useReducedMotion } from "framer-motion";

export default function TypingIndicator() {
  const reduce = useReducedMotion();

  return (
    <div className="flex gap-3" role="status" aria-label="Sage is typing">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(249,115,22,0.18),var(--chat-bubble-assistant-bg))] text-sm font-bold text-[var(--accent-strong)] shadow-[var(--shadow-card)]">
        S
      </div>
      <div className="rounded-[1.4rem] rounded-bl-md border border-[var(--chat-bubble-assistant-border)] bg-[var(--chat-bubble-assistant-bg)] px-4 py-3">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-2 w-2 rounded-full bg-[var(--chat-typing-dot)]"
              animate={reduce ? { opacity: 1 } : { y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
              transition={reduce ? undefined : { duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npx tsc --noEmit && npx eslint src/components/chat/TypingIndicator.tsx
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/TypingIndicator.tsx
git commit -m "feat(chat): animate typing dots with framer-motion + reduced-motion support"
```

---

## Task 7: Focus glow + spring send button in ChatInput

**Files:**
- Modify: `src/components/chat/ChatInput.tsx`

Building on Task 5. Add:
- A decorative radial-gradient halo positioned behind the textarea wrapper, fades in on focus
- Replace the `<button>` send with `motion.button` for spring scale on press

- [ ] **Step 1: Replace ChatInput again**

Overwrite `src/components/chat/ChatInput.tsx` with the final version:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CommandPalette } from "./CommandPalette";
import { type ChatRole } from "@/lib/chat/commands";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  compact?: boolean;
  role?: ChatRole;
}

export default function ChatInput({ onSend, disabled, compact, role = "student" }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevDisabledRef = useRef(disabled);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    const shouldOpen = message.startsWith("/") && !message.includes(" ");
    setPaletteOpen(shouldOpen);
  }, [message]);

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setMessage("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
  }, [message, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (paletteOpen && (e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape")) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      const scrollHeight = el.scrollHeight;
      el.style.height = "auto";
      requestAnimationFrame(() => {
        el.style.height = Math.min(scrollHeight, 160) + "px";
      });
    }
  };

  const handleSelectCommand = useCallback((command: { prefill: string }) => {
    setMessage(command.prefill);
    setPaletteOpen(false);
    const el = textareaRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(command.prefill.length, command.prefill.length);
      });
    }
  }, []);

  return (
    <div className={`border-t border-[var(--chat-input-border)] bg-[var(--chat-input-bg)] backdrop-blur ${compact ? "p-2" : "p-4"}`}>
      <div className={`flex items-end gap-2 ${compact ? "" : "mx-auto max-w-4xl gap-3"}`}>
        <div className="relative flex-1">
          {/* Focus glow — decorative halo behind textarea */}
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 rounded-[1.1rem]"
            style={{
              background:
                "radial-gradient(ellipse at center, var(--accent-green) 0%, var(--accent-blue) 50%, transparent 75%)",
              filter: "blur(24px)",
            }}
            animate={{ opacity: focused && !reduce ? 0.25 : 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          />
          <CommandPalette
            open={paletteOpen && !disabled}
            input={message}
            role={role}
            onSelect={handleSelectCommand}
            onClose={() => setPaletteOpen(false)}
          />
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={role === "student" ? "Type your message... (try /goal)" : "Type your message... (try /)"}
            disabled={disabled}
            rows={1}
            aria-label="Message to Sage"
            aria-autocomplete={paletteOpen ? "list" : undefined}
            aria-expanded={paletteOpen}
            className={`textarea-field relative w-full resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] overflow-y-auto ${compact ? "min-h-[42px] px-3 py-2 text-sm" : "min-h-[54px] px-4 py-3 text-base"}`}
          />
        </div>
        <motion.button
          onClick={handleSubmit}
          disabled={disabled || !message.trim()}
          aria-label="Send message"
          type="button"
          whileTap={reduce || disabled || !message.trim() ? undefined : { scale: 0.92 }}
          transition={{ type: "spring", stiffness: 500, damping: 25 }}
          className={`primary-button text-sm disabled:cursor-not-allowed disabled:opacity-60 ${compact ? "px-3 py-2.5" : "px-5 py-3.5"}`}
        >
          Send
        </motion.button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
npx tsc --noEmit && npx eslint src/components/chat/ChatInput.tsx
```

Expected: zero errors.

- [ ] **Step 3: Manual smoke test**

Start dev server:
```bash
npm run dev
```

Navigate to `http://localhost:3000/chat` as a logged-in student. Verify:
- Typing `/` opens the palette
- Arrow keys navigate, Enter selects, Esc closes
- Selecting a command fills the textarea with the prefill
- Focus glow appears when textarea is focused
- Send button has a spring press
- Regular messages still send correctly

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatInput.tsx
git commit -m "feat(chat): add focus glow + spring send button to ChatInput"
```

---

## Task 8: ChatWindow accepts `role` + empty-state starter chips

**Files:**
- Modify: `src/components/chat/ChatWindow.tsx`

`ChatWindow` gains:
- `role` prop (defaults to `"student"`) → forwards to `ChatInput`
- `defaultStage` prop → used when starting a new conversation if no `?stage=` param present
- `<StarterChips>` in the empty state

- [ ] **Step 1: Edit ChatWindow imports**

In `src/components/chat/ChatWindow.tsx`, line 11, add the StarterChips import:

Replace:
```typescript
import BrandLockup from "@/components/ui/BrandLockup";
```

With:
```typescript
import BrandLockup from "@/components/ui/BrandLockup";
import { StarterChips } from "./StarterChips";
import type { ChatRole } from "@/lib/chat/commands";
```

- [ ] **Step 2: Add props to ChatWindowInner signature**

Find (around line 29):
```typescript
function ChatWindowInner() {
```

Replace with:
```typescript
interface ChatWindowInnerProps {
  role: ChatRole;
  defaultStage?: string;
}

function ChatWindowInner({ role, defaultStage }: ChatWindowInnerProps) {
```

- [ ] **Step 3: Use defaultStage when starting a new conversation**

Find the `handleSend` call that reads `stageParam` (around line 173):

```typescript
const stageParam = searchParams.get("stage") ?? undefined;
```

Replace with:
```typescript
const stageParam = searchParams.get("stage") ?? defaultStage;
```

- [ ] **Step 4: Wire the StarterChips into the empty state**

Find the empty-state block (around lines 326-340):

```tsx
            {messages.length === 0 && !isLoading && (
              <div className="mt-20 text-center text-[var(--ink-muted)]">
                <div className="mx-auto mb-5 flex justify-center">
                  <BrandLockup
                    size="md"
                    title="VisionQuest"
                    subtitle="SPOKES Workforce Development"
                    align="center"
                  />
                </div>
                <p className="font-display text-[clamp(1.9rem,6vw,3rem)] text-[var(--ink-strong)]">Welcome to VisionQuest</p>
                <p className="mt-3 text-sm leading-6">
                  Send a message to start talking with Sage about your goals, next steps, or what feels stuck.
                </p>
              </div>
            )}
```

Replace with:
```tsx
            {messages.length === 0 && !isLoading && (
              <div className="mt-20 text-center text-[var(--ink-muted)]">
                <div className="mx-auto mb-5 flex justify-center">
                  <BrandLockup
                    size="md"
                    title="VisionQuest"
                    subtitle="SPOKES Workforce Development"
                    align="center"
                  />
                </div>
                <p className="font-display text-[clamp(1.9rem,6vw,3rem)] text-[var(--ink-strong)]">Welcome to VisionQuest</p>
                <p className="mt-3 text-sm leading-6">
                  Send a message to start talking with Sage about your goals, next steps, or what feels stuck.
                </p>
                <div className="mt-8">
                  <StarterChips role={role} onSelect={(prefill) => handleSend(prefill)} />
                </div>
              </div>
            )}
```

- [ ] **Step 5: Forward `role` to ChatInput**

Find:
```tsx
        <ChatInput onSend={handleSend} disabled={isLoading} />
```

Replace with:
```tsx
        <ChatInput onSend={handleSend} disabled={isLoading} role={role} />
```

- [ ] **Step 6: Update the default export to accept props**

Find:
```typescript
export default function ChatWindow() {
  return (
    <Suspense>
      <ChatWindowInner />
    </Suspense>
  );
}
```

Replace with:
```typescript
interface ChatWindowProps {
  role?: ChatRole;
  defaultStage?: string;
}

export default function ChatWindow({ role = "student", defaultStage }: ChatWindowProps = {}) {
  return (
    <Suspense>
      <ChatWindowInner role={role} defaultStage={defaultStage} />
    </Suspense>
  );
}
```

- [ ] **Step 7: Typecheck + lint**

Run:
```bash
npx tsc --noEmit && npx eslint src/components/chat/ChatWindow.tsx
```

Expected: zero errors.

- [ ] **Step 8: Manual smoke test**

Start dev server (if not running):
```bash
npm run dev
```

Navigate to `http://localhost:3000/chat` as a logged-in student with a fresh conversation. Verify:
- Empty state shows 4 starter chips beneath the welcome text
- Clicking a chip sends the prefilled message to Sage
- Slash commands still work in the input

- [ ] **Step 9: Commit**

```bash
git add src/components/chat/ChatWindow.tsx
git commit -m "feat(chat): add role prop + starter chips to ChatWindow empty state"
```

---

## Task 9: Add `admin_assistant` stage to system-prompts

**Files:**
- Modify: `src/lib/sage/system-prompts.ts`

- [ ] **Step 1: Add to ConversationStage union**

Find (around line 4):
```typescript
export type ConversationStage =
  | "discovery"
  | "onboarding"
  | "bhag"
  | "monthly"
  | "weekly"
  | "daily"
  | "tasks"
  | "checkin"
  | "review"
  | "orientation"
  | "general"
  | "teacher_assistant"
  | "career_profile_review";
```

Replace with:
```typescript
export type ConversationStage =
  | "discovery"
  | "onboarding"
  | "bhag"
  | "monthly"
  | "weekly"
  | "daily"
  | "tasks"
  | "checkin"
  | "review"
  | "orientation"
  | "general"
  | "teacher_assistant"
  | "admin_assistant"
  | "career_profile_review";
```

- [ ] **Step 2: Add the admin_assistant stage prompt**

Find the `teacher_assistant` entry in `STAGE_PROMPTS` (ends around line 235 with `- You do not replace human judgment on student interventions — you inform it\``). Immediately after that entry, before `career_profile_review`, add:

```typescript
  admin_assistant: `You are Sage, an AI assistant for SPOKES program administrators.

Administrators oversee program health, outcome data, platform usage, and operational activity across classrooms. Help them:

OPERATIONAL QUESTIONS
- Summarize platform usage patterns when asked
- Help structure reports about program performance
- Suggest patterns worth investigating when usage or outcomes data looks off
- Draft operational communications to instructors or stakeholders

PROGRAM KNOWLEDGE
- Answer specific questions about SPOKES certifications, platforms, forms, and procedures
- Reference policy when asked
- Flag compliance-sensitive concerns when you notice them

OUTCOME ANALYSIS
- When given student outcome data, help identify trends, disparities, or areas of strength
- Never make promises about outcomes — support analysis, not prediction
- Connect outcomes to operational levers the admin actually controls

YOUR TONE WITH ADMINS:
- Professional and concise — admins are time-constrained
- Data-literate — use specific numbers and comparisons when context is provided
- Candid — if a plan or assumption looks weak, say so respectfully
- Action-oriented — every response should leave the admin closer to a decision

BOUNDARIES:
- Never share student-level data without explicit context from the admin
- Never contradict program policy — if unsure, flag it
- You support administrative judgment; you do not replace it`,
```

- [ ] **Step 3: Extend the streamlined-prompt branch**

Find (around line 335):
```typescript
  // Teacher assistant gets a streamlined prompt stack — no student personality/guardrails
  if (stage === "teacher_assistant") {
```

Replace with:
```typescript
  // Teacher and admin assistants get a streamlined prompt stack — no student personality/guardrails
  if (stage === "teacher_assistant" || stage === "admin_assistant") {
```

- [ ] **Step 4: Typecheck**

Run:
```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/system-prompts.ts
git commit -m "feat(sage): add admin_assistant conversation stage"
```

---

## Task 10: Teacher chat route page

**Files:**
- Create: `src/app/(teacher)/teacher/chat/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/(teacher)/teacher/chat/page.tsx`:

```typescript
import ChatWindow from "@/components/chat/ChatWindow";
import PageIntro from "@/components/ui/PageIntro";

export default function TeacherChatPage() {
  return (
    <div className="page-shell page-shell-wide">
      <PageIntro
        eyebrow="Sage for instructors"
        title="Ask Sage about your class"
        description="Pull program details, plan interventions, or draft student communications. Slash commands help — try /class or /intervene."
      />
      <div className="surface-section overflow-hidden p-0">
        <ChatWindow role="teacher" defaultStage="teacher_assistant" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Manual smoke test**

Start dev server:
```bash
npm run dev
```

Navigate to `http://localhost:3000/teacher/chat` as a logged-in teacher. Verify:
- Page renders with the teacher PageIntro
- Starter chips show teacher-specific labels (Class snapshot, Draft an intervention, etc.)
- Typing `/` shows only teacher commands
- Sending a message works end-to-end

- [ ] **Step 4: Commit**

```bash
git add src/app/\(teacher\)/teacher/chat/page.tsx
git commit -m "feat(teacher): add full-page Sage chat route"
```

---

## Task 11: Admin chat route page

**Files:**
- Create: `src/app/(admin)/admin/chat/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/(admin)/admin/chat/page.tsx`:

```typescript
import ChatWindow from "@/components/chat/ChatWindow";
import PageIntro from "@/components/ui/PageIntro";

export default function AdminChatPage() {
  return (
    <div className="page-shell page-shell-wide">
      <PageIntro
        eyebrow="Sage for admins"
        title="Review program health with Sage"
        description="Check usage, explore outcomes, generate reports, and audit activity. Slash commands help — try /usage or /outcomes."
      />
      <div className="surface-section overflow-hidden p-0">
        <ChatWindow role="admin" defaultStage="admin_assistant" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Manual smoke test**

Navigate to `http://localhost:3000/admin/chat` as a logged-in admin. Verify:
- Page renders with the admin PageIntro
- Starter chips show admin labels (Usage this week, Report, Outcomes, Audit activity)
- Typing `/` shows only admin commands
- Sending a message works end-to-end

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/chat/page.tsx
git commit -m "feat(admin): add full-page Sage chat route"
```

---

## Task 12: Wire Sage nav entries for teacher + admin

**Files:**
- Modify: `src/components/ui/NavBar.tsx`

Insert a `Sage` item at the top of `STAFF_ITEMS` and at the top of `ADMIN_ITEMS` so teachers and admins have one-click access from their sidebar.

- [ ] **Step 1: Edit STAFF_ITEMS and ADMIN_ITEMS**

Find (around lines 24-32):
```typescript
const STAFF_ITEMS: NavItem[] = [
  { href: "/teacher", label: "Students", icon: Users, phase: 1 },
  { href: "/teacher/classes", label: "Classes", icon: Buildings, phase: 1 },
  { href: "/teacher/manage", label: "Program Setup", icon: Gear, phase: 1 },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin", label: "Admin", icon: Wrench, phase: 1 },
];
```

Replace with:
```typescript
const STAFF_ITEMS: NavItem[] = [
  { href: "/teacher/chat", label: "Sage", icon: ChatCircle, phase: 1 },
  { href: "/teacher", label: "Students", icon: Users, phase: 1 },
  { href: "/teacher/classes", label: "Classes", icon: Buildings, phase: 1 },
  { href: "/teacher/manage", label: "Program Setup", icon: Gear, phase: 1 },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin/chat", label: "Sage", icon: ChatCircle, phase: 1 },
  { href: "/admin", label: "Admin", icon: Wrench, phase: 1 },
];
```

- [ ] **Step 2: Add the new nav hrefs to the active-detection set**

Find (around lines 153-160):
```typescript
  const allNavHrefs = Array.from(
    new Set<string>([
      ...primaryItems.map((i) => i.href),
      ...secondaryItems.map((i) => i.href),
      "/settings",
      "/chat",
    ]),
  );
```

Replace with:
```typescript
  const allNavHrefs = Array.from(
    new Set<string>([
      ...primaryItems.map((i) => i.href),
      ...secondaryItems.map((i) => i.href),
      "/settings",
      "/chat",
      "/teacher/chat",
      "/admin/chat",
    ]),
  );
```

- [ ] **Step 3: Update floating Sage FAB hide condition**

Find (around line 462):
```typescript
      {pathname !== "/chat" && (
```

Replace with:
```typescript
      {pathname !== "/chat" && pathname !== "/teacher/chat" && pathname !== "/admin/chat" && (
```

This hides the floating `SageMiniChat` FAB when on any full-page Sage route — otherwise the FAB would overlap with the full chat and look duplicative.

- [ ] **Step 4: Typecheck + lint**

Run:
```bash
npx tsc --noEmit && npx eslint src/components/ui/NavBar.tsx
```

Expected: zero errors.

- [ ] **Step 5: Manual smoke test**

Navigate as a teacher to any teacher page. Verify:
- The desktop sidebar shows a `Sage` item at the top
- Clicking it navigates to `/teacher/chat`
- The floating Sage FAB is hidden on `/teacher/chat`
- The floating FAB reappears on other teacher pages

Repeat for admin.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/NavBar.tsx
git commit -m "feat(nav): add Sage entry to teacher + admin sidebars"
```

---

## Task 13: Verify end-to-end stage defaulting

**Files:** (no file changes — verification only)

This task verifies that new conversations from `/teacher/chat` land on `teacher_assistant` and new conversations from `/admin/chat` land on `admin_assistant`. The existing `requestedStage` body param on `/api/chat/send` already handles this; the `defaultStage` prop added in Task 8 now feeds it.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify teacher stage**

1. Log in as a teacher
2. Navigate to `/teacher/chat`
3. Send a new message (starts a new conversation)
4. In a terminal, check the latest Conversation row:

```bash
npx prisma studio --schema prisma/schema.prisma
```

Open the `Conversation` table → find the most recent row → verify `stage` is `"teacher_assistant"`.

- [ ] **Step 3: Verify admin stage**

1. Log in as an admin
2. Navigate to `/admin/chat`
3. Send a new message
4. Verify the latest Conversation row has `stage = "admin_assistant"`.

- [ ] **Step 4: Verify student is untouched**

1. Log in as a student
2. Navigate to `/chat`
3. Send a new message
4. Verify the latest Conversation row still uses the computed stage (`discovery` / `onboarding` / etc., based on the student's goal state) — NOT one of the new stages.

- [ ] **Step 5: Run full lint + typecheck + unit tests**

```bash
npx tsc --noEmit && npx eslint . && npm test
```

Expected: zero errors, all tests pass.

- [ ] **Step 6: Commit (if anything changed)**

If adjustments were needed during verification, commit them:
```bash
git add -A
git commit -m "chore(chat): adjust stage defaulting based on verification"
```

If nothing changed, skip this step.

---

## Final verification checklist

- [ ] `npx tsc --noEmit` → zero errors
- [ ] `npx eslint .` → zero errors
- [ ] `npm test` → all tests pass
- [ ] Student `/chat` still works end-to-end (goal extraction, XP, history)
- [ ] Teacher `/teacher/chat` works end-to-end with `teacher_assistant` stage
- [ ] Admin `/admin/chat` works end-to-end with `admin_assistant` stage
- [ ] Slash commands filter to the current role
- [ ] Starter chips render the correct 4 items per role
- [ ] Focus glow appears only when textarea is focused
- [ ] Typing dots animate (framer-motion) and respect `prefers-reduced-motion`
- [ ] Send button has spring press (skipped when disabled or reduced-motion)
- [ ] Floating `SageMiniChat` FAB is hidden on full-page Sage routes
- [ ] Sage nav item appears in teacher + admin sidebars

## Self-review notes

**Spec coverage:**
- Section 1 decisions → applied across all tasks
- Section 2 architecture → every new file in Task 1-4, 10-11; every modified file in Task 5-9, 12
- Section 3 palette content → Task 2 registry
- Visual tokens (corrected) → Task 7 focus glow uses `--accent-green`/`--accent-blue`, not coral/cream
- Icon mapping (Phosphor) → Task 12 uses `ChatCircle` (already imported in NavBar)
- Accessibility requirements → palette `role="dialog"` + `role="listbox"` in Task 3; reduced-motion in Tasks 6-7; aria labels throughout

**Known gotchas for the executor:**
- The `@/` path alias is standard Next.js convention; configured in `tsconfig.json`
- Tests run via `tsx --test`; no jsdom — palette/chip tests use `renderToString` only, don't assert interactive behavior (that comes from manual smoke tests)
- `prisma studio` may not be available on all machines; alternative verification: `npx prisma db execute --stdin` with a SELECT on the Conversation table
- Framer Motion v12 is already installed; `useReducedMotion` and `motion.*` components work without extra setup
