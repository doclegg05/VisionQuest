# Terminal helpers

Scripts you run yourself in a normal terminal, for work the Claude Code session sandbox blocks. Run them from the repo root.

## Sandbox-blocked jobs

| Job | Command |
|---|---|
| Live Sage memory eval on OpenRouter | `node scripts/terminal/run-with-env.mjs sage:memory:eval --provider=openrouter` |
| Cron health check against the database | `node scripts/terminal/run-with-env.mjs cron:health` |
| Any database script | `node scripts/terminal/run-with-env.mjs <npm-script> [args...]` |
| Any script that needs the `tsx` CLI | `node scripts/terminal/run-with-env.mjs <npm-script> [args...]` |

Add `--yes` before the script name to skip the Enter-to-continue pause.

## Other helpers

- `scripts/terminal/merge-pr.sh`: merges a pull request and checks the result against the GitHub API.
- `scripts/terminal/branch-cleanup.sh <manifest.tsv> [--apply] [--remote origin]`: deletes or archives (tag, then delete) the remote branches in a manifest, refusing any whose tip moved since the manifest was written. It is a dry run by default, and `--apply` is Britt's step.

## How it works

The runner loads `.env.local`, prints the target database host (never credentials), waits for Enter, runs the npm script, and copies all output to `reports/terminal/<UTC timestamp>-<script>.log`. It ends by printing the log path. Tell the session that path afterwards and it can read the log. `.env.local` points at production, so check the host line before you press Enter.
