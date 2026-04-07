# /project:smoke-test

Run smoke tests against public and authenticated routes.

## Steps
1. Run `node scripts/run-smoke-public-routes.mjs` — validates public pages return 200
2. If local server running, also test:
   - `GET /api/health` returns `{ status: "ok" }`
   - `GET /` returns landing page HTML
   - `POST /api/auth/login` with bad creds returns 401 (not 500)
   - `GET /api/session` with no cookie returns 401
3. Report any failures with route path, status code, and response snippet
4. If Python available, optionally run `python scripts/uat_auth_chat.py` for full auth + Sage chat flow
