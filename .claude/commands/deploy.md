# /project:deploy

Pre-deployment checklist for Render.

## Pre-deploy
1. `git status` — ensure working tree is clean, all changes committed
2. `npx prisma validate` — schema must parse cleanly
3. `npm run typecheck` — no type errors
4. `npx eslint .` — no lint errors
5. `npm run build` — build succeeds locally
6. Compare `.env.example` keys against Render env vars — any new vars must be added to Render dashboard
7. If new Prisma migrations exist, confirm they are committed and will run safely on existing prod data

## Deploy
8. `git push origin main` — Render auto-deploys from `main`

## Post-deploy Verification
9. Wait 30-60s for cold start, then visit https://visionquest.onrender.com
10. Test Sage chat responds (verifies Gemini key + SSE streaming)
11. Test student login flow (verifies DB connection + JWT)
12. Check Sentry dashboard for new errors
13. If new seed data needed, run scripts via Render shell or local connection
