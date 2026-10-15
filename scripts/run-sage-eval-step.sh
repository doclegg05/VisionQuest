#!/usr/bin/env bash
# One model-backed Sage eval step in CI, run through OpenRouter.
#
#   scripts/run-sage-eval-step.sh "<label>" <command> [args...]
#
# - No OPENROUTER_API_KEY secret: skip with a notice and a NOT RUN summary
#   line, so forks and secret-less runs stay green without claiming a pass.
# - Exit 3 (credits or the key's spending limit ran out) and exit 4
#   (OpenRouter, the model or the key was unavailable) mean the eval did not
#   run. They get a warning and a NOT RUN summary line, and still fail the
#   step, because an ungraded scenario is not a pass. SAGE_EVAL_SOFT_FAIL=1
#   (a repo variable) lets those two pass instead.
# - Any other exit code passes through unchanged.
#
# The budget is the OpenRouter key's own spending limit; see
# docs/runbooks/sage-eval-budget.md.
set -uo pipefail

label=$1
shift
summary=${GITHUB_STEP_SUMMARY:-/dev/null}

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "::notice::OPENROUTER_API_KEY not set, skipping ${label}."
  echo "- **${label}**: NOT RUN, OPENROUTER_API_KEY is not set" >> "$summary"
  exit 0
fi

"$@"
status=$?

case $status in
  3) reason="OpenRouter credits or the key's spending limit ran out" ;;
  4) reason="OpenRouter, the model or the key was unavailable" ;;
  *) exit "$status" ;;
esac

echo "::warning::${label} NOT RUN: ${reason} (not a pass, not a code failure)"
echo "- **${label}**: NOT RUN, ${reason}" >> "$summary"
if [ "${SAGE_EVAL_SOFT_FAIL:-}" = "1" ]; then
  exit 0
fi
exit "$status"
