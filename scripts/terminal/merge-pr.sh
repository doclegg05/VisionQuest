#!/usr/bin/env bash
# Merge a PR and judge success by the PR's API state, not gh's exit code.
# gh pr merge can exit 1 after the merge landed (its local branch switch fails
# inside a git worktree), and can print nothing on success.
#
# Usage: merge-pr.sh <pr-number> [squash|merge]
# Env:   MERGE_PR_POLL_SECONDS  seconds between state checks (default 3)
set -u

usage() {
  echo "usage: merge-pr.sh <pr-number> [squash|merge]" >&2
  exit 2
}

pr="${1:-}"
method="${2:-squash}"

case "$pr" in
  ''|*[!0-9]*) usage ;;
esac
case "$method" in
  squash|merge) ;;
  *) usage ;;
esac

poll="${MERGE_PR_POLL_SECONDS:-3}"

merge_out="$(gh pr merge "$pr" "--$method" 2>&1)"

state=""
i=0
while [ "$i" -lt 10 ]; do
  state="$(gh pr view "$pr" --json state,mergeCommit --jq '.state + " " + (.mergeCommit.oid // "")' 2>&1)"
  case "$state" in
    MERGED*)
      echo "$state"
      exit 0
      ;;
  esac
  i=$((i + 1))
  [ "$i" -lt 10 ] && sleep "$poll"
done

echo "not merged, last state: $state"
echo "gh pr merge output:"
echo "$merge_out"
exit 1
