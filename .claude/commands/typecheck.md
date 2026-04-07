# /project:typecheck

Full type-checking pass across the codebase.

## Steps
1. Run `npx tsc --noEmit` (or `npm run typecheck`)
2. If errors found:
   - Group by file path
   - Prioritize: missing types > wrong types > implicit any
   - Fix automatically where safe (adding return types, explicit generics)
   - Flag where manual decision needed (e.g., Prisma type mismatches after schema change)
3. Run `npx eslint .` as follow-up to catch style issues the type checker misses
4. Report: total errors fixed, remaining errors needing attention
