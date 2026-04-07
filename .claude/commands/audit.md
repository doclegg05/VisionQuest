# /project:audit

Security and quality audit of recent changes.

## Steps
1. Run `git diff main --name-only` to identify changed files
2. For each changed file, check:
   - **API routes**: CSRF Origin check present, JWT auth validated, no raw Prisma errors leaked
   - **Prisma queries**: parameterized (no raw SQL interpolation), proper `where` ownership checks
   - **Client components**: no `dangerouslySetInnerHTML`, no secrets in client bundles
   - **Env usage**: `process.env.*` only in server code, `NEXT_PUBLIC_*` prefix for client vars
3. Run `npx eslint .` and `npx prisma validate`
4. Scan for common issues:
   - `console.log` left in production code
   - Hardcoded URLs (should use `APP_BASE_URL`)
   - Missing error boundaries on new route segments
5. Output findings as: CRITICAL / WARNING / SUGGESTION with file:line references
