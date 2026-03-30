# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign VisionQuest's frontend with dark-mode-first theming, Phosphor icons, cinematic animations, Journey Flow dashboard, and a mobile bottom tab bar.

**Architecture:** Foundation-Up — build design tokens and theme toggle first, then layer icons, motion, component refactors, dashboard redesign, and mobile nav on top. Each task builds on the previous. Existing CSS classes (`.surface-section`, `.primary-button`, etc.) are updated in-place to reference new tokens.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, `@phosphor-icons/react`, `framer-motion`, CSS custom properties for theming.

**Spec:** `docs/superpowers/specs/2026-03-30-frontend-redesign-design.md`

---

## Task 1: Install New Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Phosphor and Framer Motion**

```bash
cd C:/Users/Instructor/Dev/VisionQuest
npm install @phosphor-icons/react framer-motion
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('@phosphor-icons/react'); console.log('phosphor OK')"
node -e "require('framer-motion'); console.log('framer-motion OK')"
```

Expected: Both print OK.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @phosphor-icons/react and framer-motion"
```

---

## Task 2: Design Tokens — Dark & Light Theme CSS Variables

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace the `:root` block with dual-theme tokens**

Replace the existing `:root` block (lines 2–30) and `@media (prefers-color-scheme: dark)` block (lines 51–56) with:

```css
:root,
[data-theme="light"] {
  /* Brand Colors (unchanged) */
  --primary: #007baf;
  --accent: #37b550;
  --dark: #004071;
  --light: #FFFFFF;
  --muted: #EDF3F7;
  --gray: #4a4d54;
  --gold: #d3b257;
  --royal: #00133f;
  --mauve: #a7253f;
  --offwhite: #d1d3d4;
  --muted-gold: #ad8806;

  /* Theme tokens — Light */
  --surface-base: #f4f6f9;
  --surface-raised: rgba(255, 255, 255, 0.86);
  --surface-overlay: rgba(0, 0, 0, 0.04);
  --ink-strong: #00133f;
  --ink-muted: #4a4d54;
  --ink-faint: rgba(0, 0, 0, 0.25);
  --border: rgba(18, 38, 63, 0.12);
  --border-strong: rgba(0, 64, 113, 0.15);
  --accent-green: #2a8a3c;
  --accent-blue: #005d8a;
  --accent-gold: #ad8806;
  --accent-red: #c43c3c;
  --glow-green: rgba(55, 181, 80, 0.15);
  --glow-gold: rgba(211, 178, 87, 0.1);

  /* Legacy aliases */
  --background: var(--surface-base);
  --foreground: var(--ink-strong);
  --surface: var(--surface-raised);
  --surface-strong: #ffffff;
  --surface-dark: rgba(0, 64, 113, 0.88);
  --accent-strong: var(--accent-green);
  --accent-secondary: var(--accent-blue);
  --accent-tertiary: var(--accent-gold);

  /* Animation tokens */
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-spring: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 200ms;
  --duration-normal: 450ms;
  --duration-slow: 800ms;
  --stagger-gap: 120ms;
}

[data-theme="dark"] {
  --surface-base: #0a1628;
  --surface-raised: rgba(255, 255, 255, 0.06);
  --surface-overlay: rgba(255, 255, 255, 0.10);
  --ink-strong: #f0f2f5;
  --ink-muted: rgba(255, 255, 255, 0.5);
  --ink-faint: rgba(255, 255, 255, 0.25);
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.12);
  --accent-green: #37b550;
  --accent-blue: #007baf;
  --accent-gold: #d3b257;
  --accent-red: #e05555;
  --glow-green: rgba(55, 181, 80, 0.25);
  --glow-gold: rgba(211, 178, 87, 0.2);

  /* Legacy aliases */
  --background: var(--surface-base);
  --foreground: var(--ink-strong);
  --surface: var(--surface-raised);
  --surface-strong: rgba(255, 255, 255, 0.1);
  --surface-dark: rgba(10, 22, 40, 0.95);
  --accent-strong: var(--accent-green);
  --accent-secondary: var(--accent-blue);
  --accent-tertiary: var(--accent-gold);
}
```

- [ ] **Step 2: Update body styles to use new tokens**

Replace the existing `body` block (lines 63–71) with:

```css
body {
  min-height: 100vh;
  background: var(--surface-base);
  color: var(--foreground);
  font-family: var(--font-body), sans-serif;
  position: relative;
  transition: background-color 300ms var(--ease-smooth), color 300ms var(--ease-smooth);
}
```

- [ ] **Step 3: Update body::before for dark mode compatibility**

Replace the existing `body::before` block (lines 73–86) with:

```css
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 12% 12%, rgba(211, 178, 87, 0.15), transparent 24%),
    radial-gradient(circle at 82% 8%, rgba(0, 123, 175, 0.15), transparent 22%);
  opacity: 0.6;
  transition: opacity 300ms var(--ease-smooth);
}

[data-theme="dark"] body::before {
  opacity: 0.3;
}
```

- [ ] **Step 4: Update surface-section to use tokens**

Replace the `.surface-section` block (lines 220–226) with:

```css
.surface-section {
  border-radius: 1.5rem;
  border: 1px solid var(--border);
  background: var(--surface-raised);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 50px rgba(16, 37, 62, 0.1);
  transition: background-color 300ms var(--ease-smooth), border-color 300ms var(--ease-smooth);
}
```

- [ ] **Step 5: Update field styles to use tokens**

Replace the `.field, .textarea-field, .select-field` block (lines 280–289) with:

```css
.field,
.textarea-field,
.select-field {
  width: 100%;
  border-radius: 1rem;
  border: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--foreground);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transition: background-color 300ms var(--ease-smooth), border-color 300ms var(--ease-smooth);
}

.field::placeholder,
.textarea-field::placeholder {
  color: var(--ink-muted);
}
```

- [ ] **Step 6: Update the @theme inline block to reference new tokens**

Replace the `@theme inline` block (lines 32–49) with:

```css
@theme inline {
  --color-background: var(--surface-base);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-body);
  --font-display: var(--font-display);

  --color-brand-primary: var(--primary);
  --color-brand-accent: var(--accent);
  --color-brand-dark: var(--dark);
  --color-brand-light: var(--light);
  --color-brand-muted: var(--muted);
  --color-brand-gray: var(--gray);
  --color-brand-gold: var(--gold);
  --color-brand-royal: var(--royal);
  --color-brand-mauve: var(--mauve);
  --color-brand-offwhite: var(--offwhite);
  --color-brand-mutedgold: var(--muted-gold);

  --color-surface-base: var(--surface-base);
  --color-surface-raised: var(--surface-raised);
  --color-ink-strong: var(--ink-strong);
  --color-ink-muted: var(--ink-muted);
  --color-ink-faint: var(--ink-faint);
  --color-accent-green: var(--accent-green);
  --color-accent-blue: var(--accent-blue);
  --color-accent-gold: var(--accent-gold);
  --color-accent-red: var(--accent-red);
}
```

- [ ] **Step 7: Verify the CSS compiles**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && npx next build 2>&1 | head -20
```

Expected: No CSS compilation errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: design tokens — dual-theme CSS variables with animation tokens"
```

---

## Task 3: Theme Toggle — Provider, Hook, and Cookie

**Files:**
- Create: `src/lib/theme.ts`
- Create: `src/components/ui/ThemeProvider.tsx`
- Create: `src/components/ui/ThemeToggle.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create the theme utility**

Create `src/lib/theme.ts`:

```typescript
export type Theme = "dark" | "light";

export const THEME_COOKIE = "vq-theme";
export const THEME_DEFAULT: Theme = "dark";

export function getThemeFromCookie(cookieValue: string | undefined): Theme {
  if (cookieValue === "light" || cookieValue === "dark") return cookieValue;
  return THEME_DEFAULT;
}
```

- [ ] **Step 2: Create the ThemeProvider**

Create `src/components/ui/ThemeProvider.tsx`:

```typescript
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type Theme, THEME_COOKIE, THEME_DEFAULT } from "@/lib/theme";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEME_DEFAULT,
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.cookie = `${THEME_COOKIE}=${next};path=/;max-age=${365 * 24 * 60 * 60};SameSite=Strict`;
      return next;
    });
  }, []);

  return (
    <ThemeContext value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext>
  );
}
```

- [ ] **Step 3: Create the ThemeToggle button**

Create `src/components/ui/ThemeToggle.tsx`:

```typescript
"use client";

import { Sun, Moon } from "@phosphor-icons/react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      className={`rounded-full border border-[var(--border)] p-2 transition-colors hover:bg-[var(--surface-overlay)] ${className}`}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <Sun size={18} weight="bold" className="text-[var(--accent-gold)]" />
      ) : (
        <Moon size={18} weight="bold" className="text-[var(--accent-blue)]" />
      )}
    </button>
  );
}
```

- [ ] **Step 4: Update root layout to read theme cookie and wrap in ThemeProvider**

Replace `src/app/layout.tsx` with:

```typescript
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Manrope, Sora } from "next/font/google";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { getThemeFromCookie, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "VisionQuest — SPOKES Program Portal",
  description: "Your journey to self-sufficiency starts here. AI-powered goal coaching for workforce development.",
  applicationName: "VisionQuest",
  icons: {
    icon: "/spokes-logo.png",
    shortcut: "/spokes-logo.png",
    apple: "/spokes-logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#10253e",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const nonce = headerStore.get("x-csp-nonce") ?? "";
  const cookieStore = await cookies();
  const theme = getThemeFromCookie(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html lang="en" nonce={nonce} data-theme={theme}>
      <body className={`${manrope.variable} ${sora.variable} antialiased`} nonce={nonce}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]
                     focus:rounded-full focus:bg-[var(--ink-strong)] focus:px-4 focus:py-2
                     focus:text-sm focus:text-white"
        >
          Skip to main content
        </a>
        <ThemeProvider initialTheme={theme}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Verify the app builds and loads with dark theme by default**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && npx next build 2>&1 | tail -5
```

Expected: Build succeeds. When loaded in browser, `<html>` has `data-theme="dark"`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/theme.ts src/components/ui/ThemeProvider.tsx src/components/ui/ThemeToggle.tsx src/app/layout.tsx
git commit -m "feat: theme toggle — dark/light mode with cookie persistence"
```

---

## Task 4: Icon Map and NavBar Icon Swap

**Files:**
- Create: `src/lib/icons.ts`
- Modify: `src/lib/nav-progression.ts`
- Modify: `src/components/ui/NavBar.tsx`

- [ ] **Step 1: Create the icon map**

Create `src/lib/icons.ts`:

```typescript
import {
  ChartBar,
  Target,
  ClipboardText,
  BookOpen,
  Briefcase,
  Rocket,
  CalendarDots,
  Gear,
  Users,
  Buildings,
  Wrench,
  FolderOpen,
  ImageSquare,
  Archive,
  Star,
  Fire,
  ChatCircle,
  DotsThreeOutline,
  type Icon,
} from "@phosphor-icons/react";

export const ICON_MAP: Record<string, Icon> = {
  "📊": ChartBar,
  "🎯": Target,
  "📋": ClipboardText,
  "📚": BookOpen,
  "💼": Briefcase,
  "🚀": Rocket,
  "🗓️": CalendarDots,
  "⚙️": Gear,
  "👥": Users,
  "🏫": Buildings,
  "🛠️": Wrench,
  "📁": FolderOpen,
  "🖼️": ImageSquare,
  "📦": Archive,
  "⭐": Star,
  "🔥": Fire,
  "💬": ChatCircle,
  "•••": DotsThreeOutline,
};

export {
  ChartBar,
  Target,
  ClipboardText,
  BookOpen,
  Briefcase,
  Rocket,
  CalendarDots,
  Gear,
  Users,
  Buildings,
  Wrench,
  FolderOpen,
  ImageSquare,
  Archive,
  Star,
  Fire,
  ChatCircle,
  DotsThreeOutline,
};

export type { Icon };
```

- [ ] **Step 2: Update nav-progression to use Phosphor icon component names**

Replace `src/lib/nav-progression.ts` with:

```typescript
import type { Icon } from "@phosphor-icons/react";
import {
  House,
  Target,
  ClipboardText,
  BookOpen,
  Briefcase,
  Rocket,
  CalendarDots,
} from "@phosphor-icons/react";

export type NavPhase = 1 | 2 | 3;

export interface NavProgressionState {
  hasGoals: boolean;
  orientationStarted: boolean;
  orientationComplete: boolean;
}

export function computeNavPhase(state: NavProgressionState): NavPhase {
  if (state.hasGoals && state.orientationComplete) return 3;
  if (state.orientationStarted) return 2;
  return 1;
}

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  phase: NavPhase;
}

export const STUDENT_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House, phase: 1 },
  { href: "/goals", label: "Goals", icon: Target, phase: 1 },
  { href: "/orientation", label: "Orientation", icon: ClipboardText, phase: 1 },
  { href: "/learning", label: "Learning", icon: BookOpen, phase: 1 },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase, phase: 2 },
  { href: "/career", label: "Career", icon: Rocket, phase: 3 },
  { href: "/appointments", label: "Advising", icon: CalendarDots, phase: 3 },
];

export function getVisibleNavItems(phase: NavPhase): NavItem[] {
  return STUDENT_NAV_ITEMS.filter((item) => item.phase <= phase);
}
```

- [ ] **Step 3: Update NavBar to render Phosphor icons with weight hierarchy**

In `src/components/ui/NavBar.tsx`, make these changes:

3a. Replace the imports and staff/admin item definitions at the top (lines 1–20):

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getRoleHomePath } from "@/lib/role-home";
import { getVisibleNavItems, type NavPhase, type NavItem } from "@/lib/nav-progression";
import {
  Users,
  Buildings,
  Gear,
  Wrench,
  ChatCircle,
  DotsThreeOutline,
  Sun,
  Moon,
  type Icon,
} from "@phosphor-icons/react";
import BrandLockup from "./BrandLockup";
import NotificationBell from "./NotificationBell";
import { SageMiniChat } from "@/components/chat/SageMiniChat";
import { ThemeToggle } from "./ThemeToggle";

const STAFF_ITEMS: NavItem[] = [
  { href: "/teacher", label: "Class Dashboard", icon: Users, phase: 1 },
  { href: "/teacher/classes", label: "Classes", icon: Buildings, phase: 1 },
  { href: "/teacher/manage", label: "Manage Content", icon: Gear, phase: 1 },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin", label: "Admin", icon: Wrench, phase: 1 },
];
```

3b. In the desktop sidebar nav links (the `primaryItems.map` around line 236), replace the icon `<span>` that renders `{item.icon}` (the emoji) with:

```tsx
{(() => {
  const IconComponent = item.icon;
  return (
    <span
      aria-hidden="true"
      className={`grid h-10 w-10 place-items-center rounded-2xl ${
        active ? "bg-[var(--ink-strong)] text-white" : "bg-white/10 text-white"
      }`}
    >
      <IconComponent size={20} weight={active ? "fill" : "regular"} />
    </span>
  );
})()}
```

3c. In the mobile bottom nav links (the `mobileMain.map` around line 132), replace the icon `<span>` with:

```tsx
{(() => {
  const IconComponent = item.icon;
  return (
    <span
      className={`mb-1 grid h-9 w-9 place-items-center rounded-2xl ${
        pathname === item.href || pathname.startsWith(item.href + "/")
          ? "bg-[rgba(16,37,62,0.1)]"
          : "bg-transparent"
      }`}
    >
      <IconComponent
        size={20}
        weight={pathname === item.href || pathname.startsWith(item.href + "/") ? "fill" : "regular"}
      />
    </span>
  );
})()}
```

3d. Replace the "More" button icon (`•••` around line 174) with:

```tsx
<DotsThreeOutline size={20} weight={isMoreActive ? "fill" : "regular"} />
```

3e. In the More drawer grid (around line 208), replace `<span className="mb-1 text-2xl">{item.icon}</span>` with:

```tsx
{(() => {
  const IconComponent = item.icon;
  return <IconComponent size={24} weight="regular" className="mb-1" />;
})()}
```

3f. Replace the settings emoji `⚙️` (lines ~110 and ~278) with:

```tsx
<Gear size={16} weight="bold" />
```

3g. Replace the floating Sage button emoji `💬` / `✕` (around line 305) with:

```tsx
{sageMiniOpen ? "✕" : <ChatCircle size={24} weight="fill" />}
```

3h. Add the `<ThemeToggle />` in the desktop sidebar footer, next to the notification bell (around line 271):

```tsx
<div className="flex shrink-0 items-center gap-2">
  <ThemeToggle />
  <NotificationBell />
```

3i. Add the `<ThemeToggle />` in the mobile top bar, before the notification bell (around line 98):

```tsx
<div className="flex shrink-0 items-center gap-1.5 min-[430px]:gap-2">
  {/* ... studentName span ... */}
  <ThemeToggle className="hidden min-[390px]:block" />
  <div className="text-[var(--ink-strong)]">
    <NotificationBell />
  </div>
```

- [ ] **Step 4: Verify the build succeeds**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && npx next build 2>&1 | tail -5
```

Expected: Build succeeds. Nav shows Phosphor icons, theme toggle appears.

- [ ] **Step 5: Commit**

```bash
git add src/lib/icons.ts src/lib/nav-progression.ts src/components/ui/NavBar.tsx
git commit -m "feat: Phosphor icon system — NavBar emoji swap + weight hierarchy"
```

---

## Task 5: Motion System — Animation Utilities and Page Transitions

**Files:**
- Create: `src/components/ui/AnimatedSection.tsx`
- Create: `src/components/ui/PageTransition.tsx`
- Modify: `src/app/globals.css` (add animation keyframes)

- [ ] **Step 1: Add cinematic keyframes to globals.css**

Add before the `/* Reduced motion preference */` block at the end of `globals.css`:

```css
/* Cinematic animation keyframes */
@keyframes slide-up-bounce {
  0% { opacity: 0; transform: translateY(20px); }
  60% { opacity: 1; transform: translateY(-4px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes scale-pop {
  0% { opacity: 0; transform: scale(0.5) translateY(10px); }
  50% { transform: scale(1.15) translateY(-2px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--glow-green); }
  50% { box-shadow: 0 0 20px 4px var(--glow-green); }
}

@keyframes glow-pulse-gold {
  0%, 100% { box-shadow: 0 0 0 0 var(--glow-gold); }
  50% { box-shadow: 0 0 20px 4px var(--glow-gold); }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@keyframes progress-fill {
  from { width: 0; }
}

@keyframes gradient-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.animate-slide-up-bounce {
  animation: slide-up-bounce var(--duration-normal) var(--ease-bounce) both;
}

.animate-scale-pop {
  animation: scale-pop var(--duration-normal) var(--ease-bounce) both;
}

.animate-glow-pulse {
  animation: glow-pulse 2s ease-in-out infinite;
}

.animate-glow-pulse-gold {
  animation: glow-pulse-gold 2s ease-in-out infinite;
}

.animate-float {
  animation: float 3s ease-in-out infinite;
}
```

- [ ] **Step 2: Create AnimatedSection component for scroll-triggered reveals**

Create `src/components/ui/AnimatedSection.tsx`:

```typescript
"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface AnimatedSectionProps {
  children: ReactNode;
  delay?: number;
  className?: string;
}

export function AnimatedSection({ children, delay = 0, className = "" }: AnimatedSectionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{
        duration: 0.45,
        delay,
        ease: [0.34, 1.56, 0.64, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 3: Create PageTransition wrapper for route animations**

Create `src/components/ui/PageTransition.tsx`:

```typescript
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{
          duration: 0.3,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Wire PageTransition into the student layout**

In `src/app/(student)/layout.tsx`, add the import and wrap `{children}`:

```typescript
import { PageTransition } from "@/components/ui/PageTransition";
```

Then inside the `<main>` tag, wrap `{children}`:

```tsx
<main
  id="main-content"
  className="min-h-screen overflow-y-auto pb-24 pt-20 md:ml-[19rem] md:pb-10 md:pr-5 md:pt-5"
>
  <PageTransition>
    {children}
  </PageTransition>
</main>
```

- [ ] **Step 5: Verify the build**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && npx next build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/components/ui/AnimatedSection.tsx src/components/ui/PageTransition.tsx src/app/\(student\)/layout.tsx
git commit -m "feat: motion system — cinematic keyframes, scroll reveals, page transitions"
```

---

## Task 6: Dashboard Redesign — Journey Flow Layout

**Files:**
- Modify: `src/app/(student)/dashboard/DashboardClient.tsx`
- Modify: `src/app/(student)/dashboard/page.tsx`

- [ ] **Step 1: Update the dashboard page server component**

In `src/app/(student)/dashboard/page.tsx`, replace the return JSX (lines 125–187) with:

```tsx
return (
  <div className="page-shell">
    <DashboardClient
      studentName={session.displayName}
      level={state.level}
      xpProgress={xpProgress}
      currentStreak={state.currentStreak}
      longestStreak={state.longestStreak}
      achievements={achievements}
      nextAppointment={nextAppointment
        ? {
            ...nextAppointment,
            startsAt: nextAppointment.startsAt.toISOString(),
            endsAt: nextAppointment.endsAt.toISOString(),
          }
        : null}
      tasks={tasks.map((task) => ({
        ...task,
        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
      }))}
      alertCount={alertCount}
      lastLevelUp={lastLevelUp}
      xp={state.xp}
      hasGoals={goalCount > 0}
      orientationComplete={state.orientationComplete || false}
      certificationsStarted={state.certificationsStarted || 0}
      platformsVisited={state.platformsVisited?.length || 0}
      resumeCreated={state.resumeCreated || false}
      orientationProgress={{ completed: orientationDoneCount, total: orientationTotalCount }}
      goalSuggestions={goalMatchResult.suggestions}
      readinessScore={readiness.score}
      readinessBreakdown={readiness.breakdown}
      activityDays={activityDays}
    />
  </div>
);
```

Note: Add `studentName` to the props passed. Remove the `<PageIntro>` — the hero is now inside `DashboardClient`.

- [ ] **Step 2: Rewrite DashboardClient as Journey Flow**

Replace the entire `src/app/(student)/dashboard/DashboardClient.tsx` with the Journey Flow layout. This is a full rewrite — the new component renders:

1. Hero banner (welcome + level + XP + streak + readiness ring + Sage CTA)
2. Next Step card (dynamic based on student state)
3. Suggested Actions as horizontal scroll pills
4. Progress section (activity calendar + achievements side by side)
5. Advising card (appointment + tasks)
6. Goal suggestions (if any)

```typescript
"use client";

import Link from "next/link";
import {
  Fire,
  Star,
  Target,
  ArrowRight,
  CalendarDots,
  ChatCircle,
  BookOpen,
  Briefcase,
  ClipboardText,
  Certificate,
} from "@phosphor-icons/react";
import { AnimatedSection } from "@/components/ui/AnimatedSection";
import StreakCalendar from "@/components/ui/StreakCalendar";
import { type ReadinessBreakdown } from "@/lib/progression/readiness-score";

interface DashboardClientProps {
  studentName: string;
  level: number;
  xpProgress: {
    current: number;
    nextTarget: number;
    prevTarget: number;
    ratio: number;
  };
  currentStreak: number;
  longestStreak: number;
  achievements: { key: string; label: string; desc: string }[];
  nextAppointment: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    locationType: string;
    locationLabel: string | null;
  } | null;
  tasks: {
    id: string;
    title: string;
    dueAt: string | null;
    priority: string;
    status: string;
  }[];
  alertCount: number;
  lastLevelUp: { level: number; at: string; reason: string } | null;
  xp: number;
  hasGoals: boolean;
  orientationComplete: boolean;
  certificationsStarted: number;
  platformsVisited: number;
  resumeCreated: boolean;
  orientationProgress: { completed: number; total: number };
  goalSuggestions: string[];
  readinessScore: number;
  readinessBreakdown: ReadinessBreakdown;
  activityDays: Record<string, number>;
}

export default function DashboardClient({
  studentName,
  level,
  xpProgress,
  currentStreak,
  longestStreak,
  achievements,
  nextAppointment,
  tasks,
  alertCount,
  xp: _xp,
  hasGoals,
  orientationComplete,
  certificationsStarted,
  platformsVisited,
  resumeCreated,
  orientationProgress,
  goalSuggestions,
  readinessScore,
  readinessBreakdown: _readinessBreakdown,
  activityDays,
}: DashboardClientProps) {
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const recentAchievements = achievements.slice(-3).reverse();

  // Determine "next step" dynamically
  const nextStep = !orientationComplete
    ? {
        label: "Complete orientation checklist",
        detail: `${orientationProgress.completed} of ${orientationProgress.total} items done`,
        href: "/orientation",
        icon: ClipboardText,
      }
    : !hasGoals
      ? {
          label: "Set your first goal",
          detail: "Talk to Sage or add one manually",
          href: "/goals",
          icon: Target,
        }
      : certificationsStarted === 0
        ? {
            label: "Start a certification",
            detail: "Browse available certifications",
            href: "/learning",
            icon: Certificate,
          }
        : !resumeCreated
          ? {
              label: "Build your resume",
              detail: "Create your professional portfolio",
              href: "/portfolio",
              icon: Briefcase,
            }
          : {
              label: "Check in with Sage",
              detail: "Get coaching on your next move",
              href: "/chat",
              icon: ChatCircle,
            };

  // Suggested actions (context-aware pills)
  const actions: { label: string; href: string; icon: typeof Target }[] = [];
  if (!orientationComplete) actions.push({ label: "Orientation", href: "/orientation", icon: ClipboardText });
  if (!hasGoals) actions.push({ label: "Set Goals", href: "/goals", icon: Target });
  if (certificationsStarted === 0) actions.push({ label: "Certifications", href: "/learning", icon: Certificate });
  if (platformsVisited === 0) actions.push({ label: "Learning", href: "/learning", icon: BookOpen });
  if (!resumeCreated) actions.push({ label: "Resume", href: "/portfolio", icon: Briefcase });
  if (goalSuggestions.length > 0) actions.push({ label: "Career", href: "/career", icon: Target });

  const NextStepIcon = nextStep.icon;

  return (
    <div className="space-y-4">
      {/* 1. Hero Banner */}
      <AnimatedSection>
        <div className="page-hero">
          <div className="flex-1">
            <p className="page-eyebrow">
              Level {level} Explorer
            </p>
            <h1 className="page-title">
              Welcome back, {studentName}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-white/82">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <Fire size={16} weight="fill" className="animate-float text-orange-400" />
                {currentStreak} day streak
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <Star size={16} weight="fill" className="text-[var(--accent-gold)]" />
                {achievements.length} achievements
              </span>
            </div>
            <div className="mt-5">
              <Link href="/chat" prefetch={false} className="primary-button px-5 py-3 text-sm">
                <ChatCircle size={18} weight="fill" />
                Open Sage
              </Link>
            </div>
          </div>
          {/* Readiness ring */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[72px] w-[72px]">
              <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
                <circle
                  cx="18" cy="18" r="14" fill="none" stroke="#37b550" strokeWidth="2.5"
                  strokeDasharray={`${readinessScore} 100`} strokeLinecap="round"
                  className="transition-all"
                  style={{ animationName: "progress-fill", animationDuration: "var(--duration-slow)", animationTimingFunction: "var(--ease-spring)", animationFillMode: "both" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-base font-bold text-white">
                {readinessScore}%
              </div>
            </div>
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/50">Ready</span>
          </div>
          {/* XP bar inside hero */}
          <div className="w-full">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>{xpProgress.current} / {xpProgress.nextTarget} XP</span>
              <span>Level {level + 1}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-green)]"
                style={{ width: `${xpProgress.ratio * 100}%`, animationName: "progress-fill", animationDuration: "var(--duration-slow)", animationTimingFunction: "var(--ease-spring)", animationFillMode: "both" }}
              />
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* 2. Next Step Card */}
      <AnimatedSection delay={0.12}>
        <Link href={nextStep.href} prefetch={false} className="surface-section flex items-center gap-4 p-5 transition-transform hover:-translate-y-0.5 hover:shadow-lg">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent-green)] to-[#2a8a3c] text-white shadow-[0_4px_16px_var(--glow-green)]">
            <NextStepIcon size={22} weight="bold" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Your Next Step</p>
            <p className="mt-0.5 font-display text-lg font-bold text-[var(--ink-strong)]">{nextStep.label}</p>
            <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{nextStep.detail}</p>
          </div>
          <ArrowRight size={20} weight="bold" className="shrink-0 text-[var(--accent-green)]" />
        </Link>
      </AnimatedSection>

      {/* 3. Suggested Actions — horizontal scroll pills */}
      {actions.length > 0 && (
        <AnimatedSection delay={0.24}>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {actions.map((action) => {
              const ActionIcon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  prefetch={false}
                  className="surface-section inline-flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium text-[var(--ink-strong)] transition-transform hover:-translate-y-0.5"
                >
                  <ActionIcon size={16} weight="bold" className="text-[var(--accent-blue)]" />
                  {action.label}
                  <ArrowRight size={14} weight="bold" className="text-[var(--ink-faint)]" />
                </Link>
              );
            })}
          </div>
        </AnimatedSection>
      )}

      {/* 4. Progress Section — calendar + achievements */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AnimatedSection delay={0.36}>
          <div className="surface-section p-5">
            <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Activity</h3>
            <StreakCalendar days={activityDays} />
            <div className="mt-3 flex items-center gap-3 text-sm text-[var(--ink-muted)]">
              <Fire size={16} weight="fill" className="text-orange-400" />
              <span>{currentStreak} day streak</span>
              <span className="text-[var(--ink-faint)]">·</span>
              <span>Best: {longestStreak}</span>
            </div>
          </div>
        </AnimatedSection>

        <AnimatedSection delay={0.48}>
          <div className="surface-section p-5">
            <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Achievements</h3>
            {recentAchievements.length > 0 ? (
              <div className="space-y-2">
                {recentAchievements.map((a) => (
                  <div key={a.key} className="flex items-center gap-2.5 text-sm">
                    <Star size={16} weight="fill" className="shrink-0 text-[var(--accent-gold)]" />
                    <span className="font-medium text-[var(--ink-strong)]">{a.label}</span>
                    <span className="text-xs text-[var(--ink-muted)]">{a.desc}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">Complete actions to earn achievements.</p>
            )}
            {achievements.length > 3 && (
              <p className="mt-3 text-xs font-semibold text-[var(--accent-green)]">
                {achievements.length} total achievements
              </p>
            )}
          </div>
        </AnimatedSection>
      </div>

      {/* 5. Advising Card */}
      <AnimatedSection delay={0.6}>
        <div className="surface-section p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-[var(--ink-muted)]">Advising</h3>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Appointments and follow-ups.
              </p>
            </div>
            <Link href="/appointments" prefetch={false} className="text-sm font-semibold text-[var(--accent-green)]">
              Open
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              {nextAppointment ? (
                <div className="rounded-[1.2rem] border border-[rgba(15,154,146,0.15)] bg-[rgba(15,154,146,0.08)] p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                    <CalendarDots size={14} weight="bold" />
                    Next Appointment
                  </p>
                  <p className="mt-2 font-display text-xl text-[var(--ink-strong)]">{nextAppointment.title}</p>
                  <p className="mt-2 text-sm text-[var(--ink-muted)]">
                    {dateFormatter.format(new Date(nextAppointment.startsAt))}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    {nextAppointment.locationLabel || nextAppointment.locationType.replace("_", " ")}
                  </p>
                </div>
              ) : (
                <div className="rounded-[1.2rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                  No appointment scheduled. Your advising appointments will show up here.
                </div>
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-[var(--ink-strong)]">Follow-ups</p>
                {alertCount > 0 && (
                  <span className="rounded-full bg-[rgba(249,115,22,0.12)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-red)]">
                    {alertCount} alert{alertCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {tasks.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)]">No open follow-up tasks right now.</p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div key={task.id} className="rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-[var(--ink-strong)]">{task.title}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          task.priority === "high"
                            ? "bg-[rgba(224,85,85,0.12)] text-[var(--accent-red)]"
                            : task.priority === "low"
                              ? "bg-[var(--surface-overlay)] text-[var(--ink-muted)]"
                              : "bg-[rgba(211,178,87,0.12)] text-[var(--accent-gold)]"
                        }`}>
                          {task.priority}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
                        {task.dueAt ? `Due ${dateFormatter.format(new Date(task.dueAt))}` : "No due date"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* 6. Goal Suggestions */}
      {goalSuggestions.length > 0 && (
        <AnimatedSection delay={0.72}>
          <div className="surface-section p-5">
            <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Recommended for Your Goals</h3>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {goalSuggestions.map((suggestion) => (
                <Link
                  key={suggestion}
                  href="/learning"
                  prefetch={false}
                  className="shrink-0 rounded-[1rem] border border-[var(--accent-gold)]/20 bg-[var(--surface-raised)] px-4 py-3 text-sm font-medium text-[var(--ink-strong)] transition-transform hover:-translate-y-0.5"
                >
                  <BookOpen size={16} weight="bold" className="mb-1 text-[var(--accent-gold)]" />
                  <span className="block">{suggestion}</span>
                </Link>
              ))}
            </div>
          </div>
        </AnimatedSection>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Remove unused imports from page.tsx**

In `src/app/(student)/dashboard/page.tsx`, remove the `PageIntro` import since the hero is now inside `DashboardClient`:

```typescript
// Remove this line:
// import PageIntro from "@/components/ui/PageIntro";
```

Also remove the `MountainProgress` dynamic import and the `SuggestedActions` import from `DashboardClient.tsx` — they are no longer used there (MountainProgress moves to Goals in Task 7).

- [ ] **Step 4: Verify the build**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && npx next build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(student\)/dashboard/
git commit -m "feat: Journey Flow dashboard — hero banner, next step, scroll animations"
```

---

## Task 7: Relocate MountainProgress to Goals Page

**Files:**
- Modify: `src/app/(student)/goals/page.tsx`

- [ ] **Step 1: Update Goals page to include MountainProgress as the hero**

Replace `src/app/(student)/goals/page.tsx`:

```typescript
import Link from "next/link";
import dynamic from "next/dynamic";
import GoalsPageClient from "@/components/goals/GoalsPageClient";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
import { getStudentGoalPlanData } from "@/lib/goal-plan-data";
import { prisma } from "@/lib/db";
import { parseState, createInitialState } from "@/lib/progression/engine";
import { computeReadinessScore } from "@/lib/progression/readiness-score";

const MountainProgress = dynamic(
  () => import("@/components/ui/MountainProgress"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[200px] animate-pulse rounded-[1.5rem] bg-gradient-to-b from-[#1a2a4a] to-[#4a7cb8] md:h-[320px]" />
    ),
  },
);

export default async function GoalsPage() {
  const session = await getSession();
  if (!session) return null;

  const [{ goals: initialGoals, goalPlans: initialGoalPlans }, progression, orientationDoneCount, orientationTotalCount, bhagGoal] = await Promise.all([
    getStudentGoalPlanData(session.id),
    prisma.progression.findUnique({ where: { studentId: session.id }, select: { state: true } }),
    prisma.orientationProgress.count({ where: { studentId: session.id, completed: true } }),
    prisma.orientationItem.count(),
    prisma.goal.findFirst({ where: { studentId: session.id, level: "bhag", status: "completed" }, select: { id: true } }),
  ]);

  const state = progression ? parseState(progression.state) : createInitialState();
  const readiness = computeReadinessScore({
    ...state,
    bhagCompleted: !!bhagGoal,
    orientationProgress: { completed: orientationDoneCount, total: orientationTotalCount },
  });

  return (
    <div className="page-shell">
      <div className="surface-section mb-4 overflow-hidden p-0">
        <MountainProgress
          readinessScore={readiness.score}
          readinessBreakdown={readiness.breakdown}
          level={state.level}
        />
      </div>
      <PageIntro
        eyebrow="Goal map"
        title="My Goals"
        description="Build your goal ladder here, then use Sage whenever you want coaching help refining it."
        actions={(
          <Link href="/chat" prefetch={false} className="primary-button px-5 py-3 text-sm">
            Talk to Sage
          </Link>
        )}
      />
      <GoalsPageClient initialGoals={initialGoals} initialGoalPlans={initialGoalPlans} />
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && npx next build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(student\)/goals/page.tsx
git commit -m "feat: relocate MountainProgress hero to Goals page"
```

---

## Task 8: Mobile Bottom Tab Bar

**Files:**
- Modify: `src/components/ui/NavBar.tsx`

- [ ] **Step 1: Redesign the mobile bottom nav as a proper tab bar with Sage center FAB**

In `src/components/ui/NavBar.tsx`, replace the mobile bottom `<nav>` element (the `fixed bottom-3` nav around line 126–179) with:

```tsx
<nav
  className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--border)] bg-[var(--surface-base)]/95 backdrop-blur-xl md:hidden"
  role="navigation"
  aria-label="Main navigation"
  style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
>
  <div className="flex items-end justify-around px-2 pt-1.5 pb-2">
    {/* Tab 1: Home */}
    {mobileMain[0] && (() => {
      const item = mobileMain[0];
      const IconComponent = item.icon;
      const active = pathname === item.href || pathname.startsWith(item.href + "/");
      return (
        <Link href={item.href} prefetch={false} className="flex flex-col items-center gap-0.5 px-3 py-1" aria-current={active ? "page" : undefined}>
          <IconComponent size={22} weight={active ? "fill" : "regular"} className={active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"} />
          <span className={`text-[10px] font-medium ${active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"}`}>{item.label}</span>
          {active && <div className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent-green)]" />}
        </Link>
      );
    })()}

    {/* Tab 2: Goals */}
    {mobileMain[1] && (() => {
      const item = mobileMain[1];
      const IconComponent = item.icon;
      const active = pathname === item.href || pathname.startsWith(item.href + "/");
      return (
        <Link href={item.href} prefetch={false} className="flex flex-col items-center gap-0.5 px-3 py-1" aria-current={active ? "page" : undefined}>
          <IconComponent size={22} weight={active ? "fill" : "regular"} className={active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"} />
          <span className={`text-[10px] font-medium ${active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"}`}>{item.label}</span>
          {active && <div className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent-green)]" />}
        </Link>
      );
    })()}

    {/* Tab 3: Sage — elevated center FAB */}
    <Link
      href="/chat"
      prefetch={false}
      className="flex flex-col items-center gap-0.5 px-3"
      aria-label="Open Sage chat"
    >
      <div className={`-mt-4 grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#37b550] to-[#2a8a3c] text-white shadow-[0_4px_16px_var(--glow-green)] transition-transform active:scale-95 ${pathname === "/chat" ? "animate-glow-pulse" : ""}`}>
        <ChatCircle size={22} weight="fill" />
      </div>
      <span className={`text-[10px] font-medium ${pathname === "/chat" ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"}`}>Sage</span>
    </Link>

    {/* Tab 4: Learn */}
    {mobileMain[2] && (() => {
      const item = mobileMain.find(i => i.href === "/learning") || mobileMain[2];
      const IconComponent = item.icon;
      const active = pathname === item.href || pathname.startsWith(item.href + "/");
      return (
        <Link href={item.href} prefetch={false} className="flex flex-col items-center gap-0.5 px-3 py-1" aria-current={active ? "page" : undefined}>
          <IconComponent size={22} weight={active ? "fill" : "regular"} className={active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"} />
          <span className={`text-[10px] font-medium ${active ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"}`}>{item.label}</span>
          {active && <div className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent-green)]" />}
        </Link>
      );
    })()}

    {/* Tab 5: More */}
    <button
      ref={moreButtonRef}
      onClick={() => setMoreOpen(!moreOpen)}
      type="button"
      className="flex flex-col items-center gap-0.5 px-3 py-1"
      aria-expanded={moreOpen}
      aria-haspopup="dialog"
      aria-label="More navigation options"
    >
      <DotsThreeOutline size={22} weight={isMoreActive ? "fill" : "regular"} className={isMoreActive ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"} />
      <span className={`text-[10px] font-medium ${isMoreActive ? "text-[var(--accent-green)]" : "text-[var(--ink-faint)]"}`}>More</span>
      {isMoreActive && <div className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent-green)]" />}
    </button>
  </div>
</nav>
```

- [ ] **Step 2: Update the main content padding in the student layout**

In `src/app/(student)/layout.tsx`, update the bottom padding for mobile to account for the new tab bar height (64px + safe area):

```tsx
className="min-h-screen overflow-y-auto pb-28 pt-20 md:ml-[19rem] md:pb-10 md:pr-5 md:pt-5"
```

Change `pb-24` to `pb-28` to give enough clearance.

- [ ] **Step 3: Hide the floating Sage button on mobile (since Sage is now in the tab bar)**

In `src/components/ui/NavBar.tsx`, update the floating Sage button (around line 298) to only show on desktop:

Change:
```tsx
className={`fixed bottom-20 right-4 z-50 ...`}
```
To:
```tsx
className={`fixed bottom-6 right-6 z-50 hidden md:flex ...`}
```

This hides the floating button on mobile (where the tab bar Sage FAB takes over) and keeps it on desktop.

- [ ] **Step 4: Verify the build**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && npx next build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/NavBar.tsx src/app/\(student\)/layout.tsx
git commit -m "feat: mobile bottom tab bar with Sage center FAB"
```

---

## Deferred: Component Refactor (Spec Section 4)

The large component splits (StudentDetail → 6 subcomponents, ClassOverview → 4, etc.) are a separate follow-up plan. This plan establishes the foundation (tokens, icons, motion, dashboard, mobile nav) that the refactor builds on. Token migration within those components will happen naturally during the split.

---

## Task 9: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run linting**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && npx eslint .
```

Expected: No errors (warnings acceptable).

- [ ] **Step 2: Run Prisma validation**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && npx prisma validate
```

Expected: Schema is valid.

- [ ] **Step 3: Run the build**

```bash
cd C:/Users/Instructor/Dev/VisionQuest && npx next build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Manual smoke test checklist**

Test in browser at http://localhost:3000:

1. Dark mode loads by default (deep navy background)
2. Theme toggle switches to light mode (light blue-gray background)
3. Theme persists on page refresh
4. Phosphor icons show in sidebar nav (fill weight on active, regular on inactive)
5. Dashboard shows Journey Flow layout (hero → next step → pills → progress → advising)
6. Scroll animations fire on dashboard cards
7. Mobile view (< 768px) shows bottom tab bar with Sage center button
8. Sage FAB in tab bar navigates to /chat
9. "More" button opens drawer with remaining nav items
10. Mountain Progress appears on /goals page
11. Page transitions animate between routes

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A && git status
# Only commit if there are lint-related changes
```
