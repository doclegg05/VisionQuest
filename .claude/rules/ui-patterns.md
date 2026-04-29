# UI Patterns

## Framework
- Tailwind CSS 4 for all styling — no inline styles, no CSS modules
- Server components by default — `"use client"` only when interactivity required
- Route groups: `(student)`, `(teacher)`, `(admin)` — each has its own layout

## Navigation (Post-Simplification)
- Student: Dashboard, Chat, Goals, Learning (merged Courses+Certs), Career (merged Jobs+Events), Orientation, Portfolio, Appointments, Settings, **Vision Board, Files, Resources** (retained per 2026-04-01 product decision — see `docs/PRODUCT_DECISIONS.md`)
- Teacher: Dashboard, Classes, Student Detail
- Out of active scope: SPOKES page (deprecated in favor of integrated SPOKES tab on Student Detail)

## Component Conventions
- Named exports for components: `export function GoalCard() {}`
- Default exports only for `page.tsx` files
- Error boundaries: `error.tsx` at each route segment level
- Loading states: `loading.tsx` or Suspense boundaries for async data

## Responsive Design
- Mobile-first approach — test at 375px width minimum
- Sidebar navigation collapses to bottom nav on mobile
- Cards stack vertically on mobile, grid on desktop
- Touch targets: minimum 44x44px for interactive elements

## Data Fetching
- Server components fetch directly with Prisma helpers from `src/lib/`
- Client components use `fetch('/api/...')` with proper error handling
- SSE for real-time: chat streaming (`/api/chat/send`), notifications (`/api/notifications/stream`)
- Optimistic updates for quick interactions (task completion, form toggles)

## Accessibility
- Semantic HTML: proper heading hierarchy, landmark regions
- ARIA labels on icon-only buttons
- Focus management on modal/dialog open/close
- Color contrast: WCAG AA minimum (4.5:1 for text)

## Forms
- Zod schemas shared between client validation and API validation where possible
- Error messages displayed inline next to the relevant field
- Submit buttons disabled during pending state
- Success/error toast notifications for async operations
