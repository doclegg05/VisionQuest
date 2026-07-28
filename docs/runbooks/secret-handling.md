# Secret Handling and Scanning

VisionQuest must not publish credentials, student records, or local runtime
configuration. This applies to commits, pull requests, Actions artifacts,
screenshots, logs, issues, and AI conversations.

## Storage rules

- Local development secrets belong only in ignored local environment files.
- Production secrets belong in Render environment variables.
- Cloudflare tunnel certificates, credential JSON, and service tokens stay in
  Cloudflare-managed profile directories or the Render dashboard.
- Never put a real value in documentation, a config example, a command line, or
  a tracked file.
- Never open or paste real student exports, database dumps, or filled forms
  while preparing documentation.

The repository ignores every `.env*` path, private-key formats, and the local
Cloudflare credential/config paths. The Docker build context excludes the same
material.

## Before staging

Review paths without printing file contents:

```powershell
git status --short
git diff --stat
git diff --check
```

Confirm that no environment file, tunnel credential, private key, database
dump, or credential screenshot is present. If an unexpected path appears,
stop and inspect only the path and file type until you know it is safe.

## Gitleaks

The `Secret scan` GitHub Actions workflow scans the commits introduced by every
push or pull request, plus the current commit on a manual run. It downloads a
version- and checksum-pinned Gitleaks binary, uses `--redact`, and does not
upload a findings artifact.

Install the [Gitleaks CLI](https://github.com/gitleaks/gitleaks/releases) for a
local pre-push scan, then run:

```powershell
gitleaks git --redact --verbose .
gitleaks dir --redact --no-banner .
```

`--redact` is required. Do not paste raw scanner output into an issue or chat.
Report only the rule identifier and affected path after removing any value.

## If a secret is detected

1. Do not push.
2. Revoke or rotate the credential immediately.
3. Remove the material from the working tree and Git history.
4. Rerun both Gitleaks commands.
5. If it reached GitHub, follow the provider's incident process and coordinate
   repository history cleanup. Deleting only the current file is not enough.

Treat any credential committed to local history as exposed, even if the branch
was never pushed.
