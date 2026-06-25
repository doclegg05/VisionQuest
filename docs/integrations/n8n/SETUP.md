# n8n setup — VisionQuest concern → Teams (self-hosted)

First-timer guide. ~10 minutes of clicks for you, then I can finish/verify the
workflow against your live instance. End state: when Sage records a `concern`,
staff get a "check in with this student" card in a Teams channel — and the
student's sensitive detail never leaves VisionQuest (the card is a deep link).

```
VisionQuest ──HMAC-signed POST──▶ n8n Webhook ──verify sig──▶ Post Adaptive Card ──▶ Teams channel
 (concern fired)                   (your container)            (deep link only)
```

## Step 1 — Deploy n8n (pick one)

### Railway (easiest)
1. Go to **railway.app** → New Project → **Deploy a Template** → search **"n8n"** → Deploy.
2. In the service **Variables**, set:
   - `N8N_ENCRYPTION_KEY` = a long random string (encrypts stored creds — keep it safe)
   - `N8N_BASIC_AUTH_ACTIVE=true`, `N8N_BASIC_AUTH_USER`, `N8N_BASIC_AUTH_PASSWORD` (locks the editor)
   - `N8N_PUBLIC_API_DISABLED=false` (lets me build the workflow via API later)
   - `WEBHOOK_URL` = your Railway public URL (e.g. `https://your-n8n.up.railway.app/`)
   - `VISIONQUEST_WEBHOOK_SECRET` = the shared secret (same value you'll put in Render — generate with `openssl rand -hex 32`)
   - `VISIONQUEST_BASE_URL` = `https://visionquest.onrender.com`
   - `TEAMS_WEBHOOK_URL` = (from Step 2)
3. Railway gives you a public domain — that's your n8n base URL.

### Render (alternative)
New → **Web Service** → Docker image `n8nio/n8n` → add a **Persistent Disk** (so workflows survive restarts) → set the same env vars as above → deploy.

## Step 2 — Create the Teams inbound URL
Microsoft is retiring the classic "Incoming Webhook" connector, so use **Workflows** (Power Automate), which is the current method:
1. In Teams, go to the target channel → **⋯ → Workflows**.
2. Pick the template **"Post to a channel when a webhook request is received."**
3. Finish the wizard — it gives you an **HTTPS URL**. That's your `TEAMS_WEBHOOK_URL`.

(The workflow JSON sends an Adaptive Card, which is what this trigger expects.)

## Step 3 — Import the workflow
1. In n8n: **Workflows → Import from File** → upload
   `docs/integrations/n8n/visionquest-concern-teams.json`.
2. Open the **VisionQuest Webhook** node → copy its **Production URL**
   (looks like `https://your-n8n.up.railway.app/webhook/visionquest-concern`).
3. **Activate** the workflow (toggle top-right).

## Step 4 — Point VisionQuest at it (Render env)
Set on the VisionQuest service:
- `AUTOMATIONS_ENABLED=true`
- `AUTOMATION_WEBHOOK_URL` = the n8n **Production URL** from Step 3
- `AUTOMATION_WEBHOOK_SECRET` = the **same** secret as `VISIONQUEST_WEBHOOK_SECRET` in n8n

Redeploy. Done — the next `concern` insight will light up Teams.

## Step 5 — Test it
- In n8n, use **"Listen for test event,"** then trigger a concern in VisionQuest
  (or `curl` a signed sample — ask me and I'll generate one).
- Watch the execution: green = delivered. A **401** means the secret differs
  between n8n and Render. No execution at all means `AUTOMATIONS_ENABLED` isn't
  `true` or the URL is wrong.

## Want me to finish it for you?
Once n8n is running, give me the **instance URL + an n8n API key**
(Settings → n8n API → Create) and I'll create/verify/activate the workflow via
the n8n REST API against your actual version — and generate a signed test event
so we can watch a card land in Teams together. Use a dedicated key and rotate it
after; it controls your whole n8n instance.

## Signature note (the usual gotcha)
The `Verify signature` node recomputes `HMAC-SHA256` over the JSON body and
compares it to `X-VisionQuest-Signature`. For VisionQuest's ASCII payloads,
re-stringifying the parsed body reproduces the exact signed bytes. If you ever
add non-ASCII fields, switch the webhook node to **Raw Body** and HMAC the raw
string instead.
