# Sage Chat Redesign — Design Spec

**Status:** Approved (Sections 1–3)
**Date:** 2026-04-17
**Author:** Britt Legg + Claude

---

## Problem

The student-facing Sage chat (`ChatWindow`) works correctly but looks utilitarian. Teachers and admins have no full-page Sage surface — they can only use the floating `SageMiniChat` pop-over. A 21st.dev `AnimatedAIChat` component was considered as inspiration; its aesthetic (dark glassmorphism, violet/fuchsia blur, mock commands) clashes with the SPOKES/Khan-Academy brand direction and fails WCAG AA contrast on multiple surfaces.

## Approved approach — "Port the vibe, not the code"

Graft the source component's *motion and interaction language* (focus glow, slash-command palette, starter chips, animated typing dots, spring-animated send button) onto the existing `ChatWindow`. Keep the SPOKES warm, green-accented palette. All three portals (student, teacher, admin) inherit the enhanced look from one shared component.

### Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Port motion/interaction patterns only; reject the dark violet aesthetic | Brand consistency + WCAG AA compliance |
| 2 | Enhance `ChatWindow` in place; all 3 portals inherit | One code path, one source of truth |
| 3 | Full command palette with role-specific slash commands | Users pick the prompt pattern, Sage gets a strong prefill |
| 4 | Keep SPOKES green-first palette (`--accent-green`, `--accent-blue`), no coral/cream tokens | Those tokens don't exist in the codebase |
| 5 | `cn` helper via `clsx` + `tailwind-merge` (Option α) | Standard shadcn-style; conflict-merge matters as palette/chips/glow classes compose |
| 6 | Icons via `@phosphor-icons/react` (already installed); no `lucide-react` | Stay on existing icon system; map source component icons to Phosphor equivalents |

---

## Section 2 — Architecture

### New files

| Path | Purpose |
|------|---------|
| `src/lib/utils.ts` | `cn(...inputs)` helper — `twMerge(clsx(inputs))` |
| `src/app/(teacher)/teacher/chat/page.tsx` | Full-page chat wrapper, teacher copy, mounts `<ChatWindow role="teacher">` |
| `src/app/(admin)/admin/chat/page.tsx` | Same shape, admin copy |
| `src/components/chat/CommandPalette.tsx` | Slash-triggered dropdown, keyboard nav (↑/↓/Enter/Esc), role-filtered suggestions, prefill on select |
| `src/components/chat/StarterChips.tsx` | 4 suggestion chips beneath input on empty state, role-filtered, click → prefill |

### Modified files

| Path | Change |
|------|--------|
| `src/components/chat/ChatWindow.tsx` | Accept `role` prop; mount `<CommandPalette>` + `<StarterChips>`; focus-glow wrapper around textarea; replace typing indicator with framer-motion dots; spring-scale send button |
| `src/components/chat/ChatInput.tsx` | Palette integration hook (detect leading `/`, open palette, feed back selection) |
| `src/components/chat/TypingIndicator.tsx` | Swap CSS bounce for framer-motion stagger (smoother) |
| `src/components/ui/NavBar.tsx` | Add `{ href: "/teacher/chat", label: "Sage", icon: Chat }` to `STAFF_ITEMS`; same for `ADMIN_ITEMS` |
| `src/lib/sage/system-prompts.ts` | Add `admin_assistant` stage (teacher already exists) |
| `src/app/api/chat/send/route.ts` | Default `stage` based on referer route group when starting a new conversation (`/teacher/chat` → `teacher_assistant`, `/admin/chat` → `admin_assistant`) |

### Data model changes

None. `Conversation.stage` already accepts arbitrary strings.

### New dependencies

```
npm i clsx tailwind-merge
```

Both are standard shadcn deps (~2KB gzipped combined).

### Visual tokens (corrected from yesterday)

| Element | Token / effect |
|---------|----------------|
| Focus glow | `radial-gradient` from `--accent-green` through `--accent-blue`, 25% opacity, `filter: blur(24px)` halo behind textarea wrapper |
| Palette surface | `--surface-raised` + `backdrop-blur-md`, `--border` border |
| Palette hover row | `--surface-interactive-hover` |
| Starter chip | `--surface-soft` bg, `--border` border, hover → `--surface-interactive` |
| Typing dots | `--chat-typing-dot` (already exists; keep token, swap animation engine) |
| Send button | `--accent-green` fill, spring scale 1 → 0.92 on press, `motion.button` |
| Send button disabled | `--surface-interactive`, `--ink-muted` icon |

### Icon mapping (Phosphor replacements for source component)

| Source (lucide) | Phosphor |
|-----------------|----------|
| `Sparkles` | `Sparkle` |
| `ArrowUpIcon` / `SendIcon` | `PaperPlaneTilt` |
| `Paperclip` | `Paperclip` |
| `Command` | `Command` |
| `XIcon` | `X` |
| `LoaderIcon` | `CircleNotch` (with `animate-spin`) |

---

## Section 3 — Command palette content per role

### Student (`role === "student"`)

**Slash commands:**

| Command | Prefills |
|---------|----------|
| `/goal` | "Help me set a new goal for..." |
| `/plan` | "Plan my week — here's what I'm working on:" |
| `/reflect` | "Here's how today went:" |
| `/stuck` | "I'm stuck on..." |
| `/next` | "What should I work on next?" |
| `/cert` | "Tell me about the ___ certification." |

**Starter chips** (empty state, 4 visible):
`Set a goal` · `Plan my week` · `I'm stuck` · `What's next?`

### Teacher (`role === "teacher"`)

**Slash commands:**

| Command | Prefills |
|---------|----------|
| `/student` | "Tell me about [student name]'s progress." |
| `/class` | "Give me a snapshot of my current class." |
| `/intervene` | "Draft an intervention message for..." |
| `/email` | "Draft a student email about..." |
| `/policy` | "What's the SPOKES policy on...?" |
| `/form` | "Where's the ___ form and what's it for?" |

**Starter chips:**
`Class snapshot` · `Draft an intervention` · `Policy lookup` · `Find a form`

### Admin (`role === "admin"`)

**Slash commands:**

| Command | Prefills |
|---------|----------|
| `/usage` | "Show me platform usage for..." |
| `/report` | "Generate a report on..." |
| `/outcomes` | "Show me student outcomes for..." |
| `/audit` | "Audit recent activity in..." |

**Starter chips:**
`Usage this week` · `Report` · `Outcomes` · `Audit activity`

### Command data structure

```typescript
// src/lib/chat/commands.ts
export interface SlashCommand {
  slash: string;              // "/goal"
  label: string;              // "Set a goal"
  description: string;        // "Capture a new goal with Sage's help"
  prefill: string;            // What appears in the textarea
  roles: Array<"student" | "teacher" | "admin">;
}

export const COMMANDS: SlashCommand[] = [ /* per role */ ];

export const STARTER_CHIPS: Record<"student" | "teacher" | "admin", string[]> = { /* per role */ };
```

`CommandPalette.tsx` filters `COMMANDS` by matching `slash.startsWith(input)` AND `roles.includes(currentRole)`.

---

## Interaction patterns

### Palette open/close

1. User types `/` at position 0 of empty textarea → palette opens above input
2. Keystrokes filter the visible commands
3. `↑`/`↓` navigate, `Enter` or click selects, `Esc` closes
4. Selection replaces the `/...` input with the command's `prefill`, focus stays in textarea, user continues typing

### Focus glow

- Radial gradient halo positioned behind the textarea wrapper (absolute, `z-index: -1`)
- Opacity `0` at rest → `0.25` when textarea focused (framer-motion `animate` prop, 200ms ease-out)

### Typing dots

- Three `motion.span` elements with staggered `y` animation (0 → -4 → 0) via `transition={{ delay: i * 0.15, repeat: Infinity }}`
- Keep the `--chat-typing-dot` color token

### Send button

- `motion.button` with `whileTap={{ scale: 0.92 }}` and spring transition
- Disabled state removes the whileTap

---

## Accessibility

- Palette is a `role="listbox"` with `role="option"` children; arrow-key nav announced via `aria-activedescendant`
- Starter chips are plain `<button>` elements with descriptive text (not icon-only)
- Focus glow is purely decorative (`aria-hidden="true"`)
- Typing dots container has `role="status"` + `aria-label="Sage is typing"` (already present)
- All framer-motion animations respect `prefers-reduced-motion` via the `useReducedMotion()` hook

---

## Out of scope

- Rebuilding `SageMiniChat` — stays as-is for now (separate floating pop-over, uses `sage:open` event)
- Backend / API changes beyond the one-line `stage` default in `/api/chat/send`
- New system-prompt content for `admin_assistant` beyond a minimal stub (copy to be refined post-launch)

---

## Risk notes

| Risk | Mitigation |
|------|------------|
| Palette click closes input focus → awkward | On select, `textarea.focus()` explicitly after state update |
| Framer-motion bundle size on student route | Already loaded for progression animations; no new cost |
| Teacher/admin nav slot collision with existing items | Audit `STAFF_ITEMS` / `ADMIN_ITEMS` positions before insertion; place `Sage` in top 2 slots |
| `admin_assistant` stage lacks system prompt | Ship a minimal stub ("You are Sage assisting a VisionQuest admin..."); refine after usage patterns emerge |
| Regression to student chat (most-used surface) | Implement behind `role` prop default; student path identical unless role differs |

---

## Approval

- [x] Section 1 — approach + decisions
- [x] Section 2 — architecture (revised tokens)
- [x] Section 3 — palette content per role

**Next:** implementation plan via `superpowers:writing-plans`.
