# VisionQuest Frontend Redesign — Design Spec

**Date:** 2026-03-30
**Approach:** Foundation-Up (tokens → icons → motion → components → dashboard → mobile)
**Aesthetic:** Refined Evolution — dark-mode-first, keep navy/green/gold identity

---

## 1. Design Tokens & Theme System

Dual-value CSS variable system supporting dark (default) and light themes.

### Color Tokens

| Token | Dark Mode | Light Mode | Usage |
|-------|-----------|------------|-------|
| `--surface-base` | `#0a1628` | `#f4f6f9` | Page background |
| `--surface-raised` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.86)` | Cards, panels |
| `--surface-overlay` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.04)` | Hover states, modals |
| `--ink-strong` | `#f0f2f5` | `#00133f` | Primary text |
| `--ink-muted` | `rgba(255,255,255,0.5)` | `#4a4d54` | Secondary text |
| `--ink-faint` | `rgba(255,255,255,0.25)` | `rgba(0,0,0,0.25)` | Tertiary/disabled |
| `--border` | `rgba(255,255,255,0.08)` | `rgba(18,38,63,0.12)` | Dividers, card borders |
| `--accent-green` | `#37b550` | `#2a8a3c` | Primary CTA, success |
| `--accent-blue` | `#007baf` | `#005d8a` | Links, secondary accent |
| `--accent-gold` | `#d3b257` | `#ad8806` | Awards, premium, SPOKES |
| `--accent-red` | `#e05555` | `#c43c3c` | Errors, alerts |
| `--glow-green` | `rgba(55,181,80,0.25)` | `rgba(55,181,80,0.15)` | Button glow, active states |
| `--glow-gold` | `rgba(211,178,87,0.2)` | `rgba(211,178,87,0.1)` | Achievement glow |

### Implementation

- CSS variables on `:root` (light) and `[data-theme="dark"]` (dark)
- Default to dark: `<html data-theme="dark">`
- Toggle stored in `localStorage` + a cookie so server components can read it
- Tailwind `@theme inline` updated to reference new tokens
- Existing `--primary`, `--accent`, `--dark` etc. aliased to new tokens for backward compat during migration

### Existing CSS Class Migration

Existing utility classes in `globals.css` (`.surface-section`, `.primary-button`, `.page-hero`, `.field`, etc.) are updated in-place to reference new tokens. They are NOT deleted or renamed — this avoids a mass find-replace across 77 components. The classes just point to the new token values, which automatically respond to the `data-theme` attribute.

### Typography

No changes — keep Sora (display) + Manrope (body). Works well in both themes.

### Spacing/Radius

No changes — keep existing clamp() values. Already responsive and well-calibrated.

---

## 2. Icon System

**Library:** `@phosphor-icons/react` (tree-shakeable, ~10KB typical)

### Weight Hierarchy

| Context | Phosphor Weight | Example |
|---------|----------------|---------|
| Active nav item | `fill` | Solid filled icon, paired with bold label |
| Inactive nav item | `regular` (1.5px stroke) | Outlined icon, muted color |
| Card headers / section icons | `bold` (2px stroke) | Slightly heavier for visual anchoring |
| Inline text / metadata | `regular` | Standard weight alongside body text |
| Decorative / background | `light` (1px stroke) | Subtle, low-contrast |
| Disabled states | `thin` + `--ink-faint` | Nearly invisible |

### Migration

- Create `src/lib/icons.ts` mapping old emoji usage to Phosphor components
- Key mappings: target emoji→`Target`, book→`BookOpen`, briefcase→`Briefcase`, fire→`Fire`, star→`Star`, users→`Users`, gear→`Gear`, graduation→`GraduationCap`
- Achievement badges keep a small emoji accent alongside the Phosphor icon for personality — emojis demoted from primary icon role, not banned

### Sizing Convention

- Nav icons: 20px
- Card header icons: 18px
- Inline icons: 16px
- Small badges/tags: 14px

---

## 3. Motion System

**Libraries:** CSS animations for simple effects. `framer-motion` (Motion) for orchestrated sequences and scroll-triggered reveals.

### Animation Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-bounce` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Card entrances, XP pop, level-up |
| `--ease-spring` | `cubic-bezier(0.22, 1, 0.36, 1)` | Page load stagger, slide-ups |
| `--ease-smooth` | `cubic-bezier(0.4, 0, 0.2, 1)` | Hover transitions, theme toggle |
| `--duration-fast` | `200ms` | Hover, active, micro-interactions |
| `--duration-normal` | `450ms` | Card entrances, reveals |
| `--duration-slow` | `800ms` | Progress bar fills, hero transitions |
| `--stagger-gap` | `120ms` | Delay between sequential card entrances |

### Animation Inventory

| Moment | Effect | Trigger |
|--------|--------|---------|
| Page load | Staggered slide-up + fade (120ms gap) with bounce overshoot | Mount |
| Progress bars | Animate 0 to value with spring curve, gradient shimmer on complete | Mount |
| XP gain | Number pops with scale bounce (0.5→1.15→1.0), gold glow pulse | XP event |
| Level up | Full-screen celebration — scale burst, floating particles, pulse glow ring | Level event |
| Achievement unlock | Card slides in from right with bounce, gold shimmer sweep | Achievement event |
| Scroll reveals | Cards fade + slide up as they enter viewport | Scroll |
| Hover on cards | translateY(-3px) + elevated shadow + subtle saturate | Hover |
| Active/click | scale(0.96) + brightness(0.95) | Active |
| Streak fire | Gentle float animation (translateY 0→-4px→0, 3s loop) | Continuous |
| Theme toggle | Smooth 300ms cross-fade on all color tokens | Toggle |
| Nav item switch | Active icon morphs from regular to fill with 200ms scale pop | Route change |

### Accessibility

- All animations wrapped in `@media (prefers-reduced-motion: no-preference)`
- Reduced-motion fallback: instant renders, no motion, opacity-only fades
- No animation blocks interaction — all purely decorative

### Framer Motion Usage

- `AnimatePresence` for page transitions between routes
- `motion.div` with `whileInView` for scroll-triggered card reveals
- `useSpring` for progress bar and XP counter animations
- CSS-only for simple hover/active states

---

## 4. Component Refactor

### Large Component Splits

| Component | Current Lines | Split Into |
|-----------|--------------|------------|
| `StudentDetail.tsx` | 1,999 | Header, GoalsTab, ProgressTab, InterventionsTab, SPOKESTab, ActivityTab |
| `ClassOverview.tsx` | 1,029 | KPICards, RosterSummary, InterventionQueueSummary, QuickActions |
| `ResumeBuilder.tsx` | 817 | ContactSection, ExperienceSection, EducationSection, SkillsSection, PreviewPanel |
| `SpokesStudentWorkspace.tsx` | 805 | ModuleList, ActiveModule, ProgressTracker |
| `ClassRosterManager.tsx` | 710 | RosterTable, AddImportDialog, BulkActionsBar |
| `GoalsPageClient.tsx` | 643 | GoalTree, GoalDetailPanel, AddGoalForm |

### Pattern Standardization

- **Surface component:** Reusable component applying `--surface-raised`, `--border`, border-radius, backdrop-blur. Replaces ad-hoc `surface-section` class.
- **Color references:** All hardcoded `rgba(18,38,63,...)`, `bg-white/70`, `text-amber-500` etc. replaced with design token variables.
- **Emoji → Phosphor:** All icon-role emojis swapped using the icon map.
- **Inline styles → Tailwind:** Remaining inline `style=` attributes converted to Tailwind utilities or CSS variables.

### Unchanged

- Component file organization (by feature domain)
- Server/client component boundary decisions
- Data fetching patterns
- All business logic and API interactions

---

## 5. Dashboard Redesign

**Layout:** Journey Flow — single-column narrative.

### Section Order (top to bottom)

1. **Hero Banner** — Full-width gradient card
   - Welcome message + student name
   - Level badge + XP bar (animated fill on load)
   - Streak fire (floating animation) + achievement count
   - Readiness score ring (right side, animated draw)
   - "Open Sage" primary CTA button

2. **Next Step Card** — Single most important action
   - Large card with green accent arrow CTA
   - Dynamic content based on student state (orientation → goal-setting → next task)
   - Progress indicator (e.g., "3 of 8 items done")
   - Bouncy entrance animation

3. **Suggested Actions** — Horizontal scrollable row of compact action pills
   - Phosphor icon + short label + arrow per pill
   - Context-aware: only shows relevant actions

4. **Progress Section** — Two side-by-side cards (desktop), stacked (mobile)
   - Left: Activity calendar (streak heatmap) with scroll-reveal
   - Right: Recent achievements with gold glow, latest 3 + "View all"

5. **Advising Card** — Appointment + tasks combined
   - Next appointment with date/time/location
   - Follow-up tasks (max 3, "See all" link)
   - Alert badge count

6. **Goal Suggestions** — If BHAG goals match learning platforms
   - Horizontal scroll cards linking to recommended platforms
   - Subtle gold border, scroll-triggered entrance

### MountainProgress Relocation

- Removed from dashboard
- Moved to Goals page (`/goals`) as the full-width hero
- Replaces current PageIntro on Goals page
- Readiness breakdown displayed below the mountain
- Component itself unchanged — only its mount location moves

---

## 6. Mobile Navigation

**Pattern:** Bottom tab bar, 5 items, fixed to bottom edge.

### Tab Layout

| Position | Label | Icon | Behavior |
|----------|-------|------|----------|
| 1 | Home | `House` | → `/dashboard` |
| 2 | Goals | `Target` | → `/goals` |
| 3 | Sage | `ChatCircle` | → `/chat` — elevated 44px green circle FAB |
| 4 | Learn | `BookOpen` | → `/learning` |
| 5 | More | `DotsThree` | Opens bottom drawer |

### Sage Center Button

- 44px circle, `linear-gradient(135deg, #37b550, #2a8a3c)`
- Elevated 12px above tab bar baseline
- Persistent glow: `0 4px 16px var(--glow-green)`
- Gentle pulse when unread Sage suggestions exist
- Active: `scale(0.95)` with bounce back

### "More" Drawer

Contains: Career, Portfolio, Orientation, Appointments, Resources, Files, Vision Board, Settings. Single-column list with Phosphor icons. Slide-up with backdrop blur, swipe-down to dismiss.

### Tab Bar Styling

- Background: `var(--surface-base)` at 95% opacity + `backdrop-filter: blur(20px)`
- Top border: `1px solid var(--border)`
- Height: 64px (including safe area padding)
- Active: `--accent-green` icon + dot indicator, `fill` weight
- Inactive: `--ink-faint`, `regular` weight
- Icon weight transition: 200ms scale pop on route change
- Hides when keyboard is open via `env(keyboard-inset-height)`

### Breakpoints

- Tab bar visible: `< 768px`
- Sidebar visible: `≥ 768px` — gets new tokens + icons, no layout change

---

## Implementation Order

Foundation-Up approach:

1. **Design tokens & theme** — CSS variables, dark/light toggle, Tailwind theme update
2. **Icon system** — Install Phosphor, create icon map, swap NavBar + dashboard first
3. **Motion system** — Animation tokens in CSS, install framer-motion, add page load + scroll reveals
4. **Component refactor** — Split large components, apply tokens + icons, standardize Surface pattern
5. **Dashboard redesign** — Journey Flow layout, relocate MountainProgress to Goals
6. **Mobile navigation** — Bottom tab bar, Sage FAB, More drawer

Each step builds on the previous. Components get touched once with final tokens + icons.
