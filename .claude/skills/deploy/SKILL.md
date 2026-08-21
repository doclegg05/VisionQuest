---
name: deploy
description: Deploying VisionQuest to Render — build and start commands, standalone output mode, env vars, migration-on-deploy, and post-deploy verification. Use when shipping to production or debugging a deploy.
---
# Deploy Skill

Automatically invoked for deployment-related tasks.

## Render Deployment
- **Build**: `npm ci && npx prisma generate && npm run build`
- **Start**: `npm run prisma:migrate:deploy && node .next/standalone/server.js`
- **Auto-deploy**: Push to `main` triggers deploy on Render

## Pre-deploy Checks
1. `npx prisma validate` passes
2. `npm run build` succeeds locally
3. All new env vars added to Render dashboard
4. New Prisma migrations committed and pushed
5. No `console.log` debugging statements left in production code

## Post-deploy Verification
1. Visit https://visionquest.onrender.com — check for cold start
2. Test Sage chat responds (verifies Gemini key + streaming)
3. Test student login flow
4. Check Sentry for new errors
