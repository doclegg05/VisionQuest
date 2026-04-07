# Code Style

- TypeScript strict mode — avoid `any` unless explicitly justified
- Use Next.js App Router conventions: `page.tsx`, `layout.tsx`, `route.ts` for API
- Prefer server components by default; use `"use client"` only when needed
- Tailwind CSS 4 for all styling — no inline styles or CSS modules
- Named exports for components, default exports only for pages
- Prisma queries go in `src/lib/` helper modules, not directly in route handlers
- Error boundaries: use `error.tsx` at route segment level
