# /project:review

Review the current branch for code quality, security, and consistency.

## Automated Checks
1. Run `npx eslint .` and report any issues
2. Run `npx prisma validate` to check schema integrity
3. Run `npm run typecheck` to catch type errors

## Manual Review
4. Scan `git diff` for hardcoded secrets, API keys, or credentials
5. Check that all new API routes have:
   - JWT auth validation via `src/lib/auth.ts`
   - CSRF Origin header check on mutating methods
   - Zod validation on request bodies
   - Ownership checks (`where: { studentId }`) on student data queries
   - Error wrapping (no raw Prisma errors to client)
6. Verify TypeScript strict mode compliance — no `any` types without justification
7. Check for `console.log` statements that should be removed before merge
8. Verify new client components have `"use client"` directive only if truly needed
9. Check that new route segments have `error.tsx` boundary

## Output Format
Summarize findings with severity labels:
- **CRITICAL**: security holes, data leaks, auth bypass
- **WARNING**: missing validation, potential N+1, missing error handling
- **SUGGESTION**: code style, naming, performance optimization
