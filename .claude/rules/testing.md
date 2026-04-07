# Testing

- Run `npx eslint .` before every commit
- Run `npx prisma validate` after any schema change
- Smoke test public routes with `scripts/run-smoke-public-routes.mjs`
- UAT scripts in `scripts/` (Python) cover auth flows and chat
- Manual testing checklist: student registration, Sage chat, teacher dashboard, orientation flow
