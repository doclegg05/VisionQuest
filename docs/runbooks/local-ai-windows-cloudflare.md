# Windows Ollama + Cloudflare Runbook

**Audience:** VisionQuest operators
**Supported topology:** Render → Cloudflare Access/Tunnel → Windows relay → Windows Ollama
**Chat model:** a pinned local Gemma 4 tag (the repository default is `gemma4:26b`)

This is the canonical production setup for Sage chat that can contain student
education records. It uses a Windows host that stays on, an Ollama service bound
to loopback, the repository relay on port `11435`, and a named Cloudflare Tunnel
protected by a service token.

## Routing policy

| Data class | Examples | Allowed provider |
|---|---|---|
| `student_record` | Student Sage chat, goals, memories, uploaded student content | Local Gemma 4 through Ollama only |
| `staff_entered` | Teacher-entered notes or prompts about a student | Local Gemma 4 through Ollama only |
| `public_program` / non-FERPA | Public program information with no student or staff-entered content | Gemini API may be used |
| `system` | Operational prompts that contain no protected records | Gemini API may be used after a data review |

The rule is based on the data in the request, not the screen or user role. A
prompt is not safe for Gemini merely because a teacher submitted it.

For FERPA-protected requests:

- Never fall back to Gemini when the Windows host, relay, tunnel, or model is
  unavailable.
- Return an unavailable/offline response and restore the local path.
- Never copy the prompt into a cloud troubleshooting tool, issue, log, or chat.
- Keep **Local AI Server** selected in production Program Setup.

### Current enforcement status

`resolveAiProvider()` labels `student_record` and `staff_entered` as sensitive,
but the current implementation still honors the operator-selected cloud
provider for alpha/pre-hardware testing. Therefore, this policy is operationally
enforced only while production Program Setup remains set to **Local AI Server**.
Do not switch production to cloud during a local outage. A separate production
code change is required before this can be described as a hard, automatic
fail-closed invariant.

## Traffic path

```text
VisionQuest on Render
  -> HTTPS hostname protected by Cloudflare Access
  -> named Cloudflare Tunnel (outbound connection from Windows)
  -> http://127.0.0.1:11435 (ollama-relay.mjs)
  -> http://127.0.0.1:11434 (Ollama)
  -> pinned Gemma 4 model
```

Do not expose ports `11434` or `11435` on the router or Windows Firewall.
`cloudflared` makes an outbound connection; the Ollama and relay listeners stay
on loopback.

## 1. Prepare the Windows host

Use a dedicated, patched Windows 11 workstation with enough RAM/VRAM for the
selected Gemma 4 tag. Log on with the Windows account that will own the Ollama
model files.

Install Git, Node.js LTS, Ollama, and `cloudflared`. The documented
`cloudflared` location is:

```text
C:\Cloudflared\bin\cloudflared.exe
```

Install Ollama, then pull a pinned local model:

```powershell
ollama pull gemma4:26b
ollama pull nomic-embed-text
ollama list
```

Do not select a `-cloud` model tag. If hardware requires a different local
Gemma 4 size, pin that exact tag and use the same value in Program Setup.
Avoid `:latest`, because it can move to different weights without an explicit
configuration change.

Confirm Ollama is healthy before configuring the relay:

```powershell
Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing
```

Expected result: HTTP 200 and the pinned Gemma 4 tag in the installed-model
list.

## 2. Create the named Cloudflare Tunnel

Use a hostname dedicated to the model endpoint, such as
`llm.example.org`. Do not use a Quick Tunnel or an ephemeral ngrok URL.

From an elevated PowerShell:

```powershell
Set-Location C:\Cloudflared\bin
.\cloudflared.exe tunnel login
.\cloudflared.exe tunnel create visionquest-ollama
.\cloudflared.exe tunnel route dns visionquest-ollama llm.example.org
```

The login certificate and tunnel credential JSON are secrets. Keep them in the
Cloudflare profile directories only; never copy them into this repository.

Create the service profile directory:

```powershell
$cfServiceDir = "C:\Windows\System32\config\systemprofile\.cloudflared"
New-Item -ItemType Directory -Path $cfServiceDir -Force
```

Copy the generated tunnel credential JSON to that directory. Copy
[`config/cloudflared/config.example.yml`](../../config/cloudflared/config.example.yml)
to `$cfServiceDir\config.yml`, then edit the copy—not the repository
example—with:

- the tunnel UUID;
- the absolute path to the credential JSON in `$cfServiceDir`;
- the dedicated hostname.

The ingress service must remain `http://127.0.0.1:11435`, followed by the
catch-all `http_status:404` rule.

Validate the configuration without printing credential contents:

```powershell
$cloudflared = "C:\Cloudflared\bin\cloudflared.exe"
$config = "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"
& $cloudflared --config $config tunnel ingress validate
& $cloudflared --config $config tunnel ingress rule https://llm.example.org
```

## 3. Protect the hostname with Cloudflare Access

In Cloudflare Zero Trust:

1. Create a self-hosted Access application for the dedicated model hostname.
2. Create a Service Token under **Access controls → Service credentials**.
3. Add a **Service Auth** policy that includes that service token.
4. Do not add an **Allow Everyone** or **Bypass** policy.
5. Record the token expiration date and create a renewal alert.

Cloudflare displays the client secret only once. Store both values directly in
Render environment variables:

- `AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_ID`
- `AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_SECRET`

The shorter aliases `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` also
work, but use one naming pair consistently. Do not place values in docs,
screenshots, terminal transcripts, source files, or any `.env` file intended
for Git.

## 4. Install Ollama, relay, and tunnel as services

Clone VisionQuest to a stable path on the Windows host. From an elevated
PowerShell at the repository root:

```powershell
& .\scripts\install-local-ai-services.ps1
```

The installer:

- installs `VisionQuest-Ollama` through NSSM;
- binds Ollama to `127.0.0.1:11434`;
- installs `VisionQuest-OllamaRelay` on `127.0.0.1:11435`;
- installs/starts `cloudflared`;
- sets automatic restart behavior; and
- smoke-tests Ollama and the relay.

If `cloudflared.exe`, the model directory, or the repository is in a
non-default location, use the script parameters. For example:

```powershell
& .\scripts\install-local-ai-services.ps1 `
  -CloudflaredExe "D:\Tools\cloudflared.exe" `
  -OllamaModels "D:\Ollama\models"
```

Do not pass credentials on the command line.

Check service state and local endpoints:

```powershell
Get-Service VisionQuest-Ollama, VisionQuest-OllamaRelay, cloudflared
Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:11435/api/tags -UseBasicParsing
```

All three services should be running; both local requests should return HTTP
200. The public hostname should reject requests that do not have the Cloudflare
Access service token.

## 5. Configure VisionQuest

In Render, store the Gemini credential for non-FERPA calls and the Cloudflare
Access service-token pair. Do not use Render Secret Files and do not print
values in deploy logs.

In VisionQuest, sign in as an admin and open **Program Setup → AI Provider**:

1. Select **Local AI Server**.
2. Set **Server URL** to the HTTPS Cloudflare hostname.
3. Set **Model name** to the exact pinned local Gemma 4 tag.
4. Select **Ollama** API style.
5. Set **Embedding model** to `nomic-embed-text`.
6. Select **Cloudflare service token** authentication.
7. Leave credential fields empty when the Render environment variables are
   present.
8. Save, then run **Test Connection**.

Do not select the cloud provider in production. Gemini remains available only
to code paths explicitly classified as non-FERPA.

## 6. Acceptance checks

Before real student traffic:

```powershell
npx tsx scripts/sage-chat-harness.mjs --provider=ollama --strict
```

Then verify in Program Setup that chat, tool calling, JSON output, and
768-dimensional embeddings pass. Complete a test with synthetic data only.
Never use a real student record as a connectivity test.

Required production checks:

- The configured model name starts with the approved pinned Gemma 4 tag.
- Program Setup is set to **Local AI Server**.
- Stopping the tunnel causes protected chat to fail closed; it must not produce
  a Gemini response.
- Public/non-FERPA prompts may use Gemini only when no student or staff-entered
  content is included.
- Cloudflare Access logs show service-token-authenticated requests.
- No tunnel credential, service token, API key, or `.env` file appears in
  `git status`.

## 7. Recovery and rotation

If protected chat is unavailable:

1. Keep Program Setup on **Local AI Server**.
2. Check services, then ports `11434` and `11435`, then Cloudflare Tunnel, then
   Access/Render credential configuration.
3. Restore the local path and rerun **Test Connection**.
4. Do not route protected prompts to Gemini as a workaround.

When rotating the Cloudflare service token, update Render first, run the
connection test, then revoke the old token. If a token or key appears in Git,
rotate/revoke it immediately even if the commit was not pushed.

See [Secret Handling and Scanning](./secret-handling.md) before staging changes.
For a repository-level handoff to a separate implementation agent, see the
[Local AI Implementation Packet for Mac Codex](../handoffs/2026-07-28-local-ai-implementation-packet.md).

## Official references

- [Ollama Gemma 4 model library](https://ollama.com/library/gemma4)
- [Cloudflare: run a tunnel as a Windows service](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/windows/)
- [Cloudflare: tunnel configuration files](https://developers.cloudflare.com/tunnel/advanced/local-management/configuration-file/)
- [Cloudflare Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
