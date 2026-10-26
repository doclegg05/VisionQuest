#!/usr/bin/env bash
# Delete or archive remote branches listed in a manifest, refusing any branch
# whose tip moved since the manifest was written.
#
# Usage: branch-cleanup.sh <manifest.tsv> [--apply] [--remote origin]
#
# Manifest rows: branch<TAB>sha<TAB>action, action is "delete" or "archive".
# Blank lines and lines starting with # are skipped.
# Dry run is the default and changes nothing. --apply is the owner's step.
# Exit 1 if any row was refused or failed, otherwise 0.

set -u

manifest=""
apply=0
remote="origin"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --remote)
      shift
      if [ $# -eq 0 ]; then echo "--remote needs a value" >&2; exit 2; fi
      remote="$1"
      ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      if [ -n "$manifest" ]; then echo "only one manifest allowed" >&2; exit 2; fi
      manifest="$1"
      ;;
  esac
  shift
done

if [ -z "$manifest" ] || [ ! -f "$manifest" ]; then
  echo "usage: branch-cleanup.sh <manifest.tsv> [--apply] [--remote origin]" >&2
  exit 2
fi

failures=0

# Delete a remote branch only if its tip is still $2.
delete_branch() {
  local branch="$1" sha="$2" out
  out=$(git push --force-with-lease="refs/heads/${branch}:${sha}" "$remote" ":refs/heads/${branch}" 2>&1)
  if [ $? -eq 0 ]; then
    echo "DELETED $branch"
    return 0
  fi
  case "$out" in
    *"stale info"*|*"[rejected]"*)
      echo "REFUSED $branch"
      ;;
    *)
      echo "FAILED $branch: $(printf '%s' "$out" | tr '\n' ' ')"
      ;;
  esac
  return 1
}

# Tag the branch tip and push the tag, using fully qualified refs.
archive_tag() {
  local branch="$1" sha="$2" out existing
  # A tag left by an earlier partial run is reused if it points at the same
  # commit; at a different commit it is an error and the branch is kept.
  existing=$(git rev-parse -q --verify "refs/tags/archive/${branch}^{commit}" 2>/dev/null)
  if [ -z "$existing" ]; then
    out=$(git tag "archive/${branch}" "$sha" 2>&1) || {
      echo "FAILED $branch: $(printf '%s' "$out" | tr '\n' ' ')"
      return 1
    }
  elif [ "$existing" != "$sha" ]; then
    echo "FAILED $branch: archive tag exists at a different commit"
    return 1
  fi
  out=$(git push "$remote" "refs/tags/archive/${branch}:refs/tags/archive/${branch}" 2>&1) || {
    echo "FAILED $branch: $(printf '%s' "$out" | tr '\n' ' ')"
    return 1
  }
  echo "ARCHIVED $branch as archive/$branch"
  return 0
}

while IFS=$'\t' read -r branch sha action || [ -n "${branch:-}" ]; do
  case "${branch:-}" in
    ""|"#"*) continue ;;
  esac

  if [ -z "${sha:-}" ] || [ -z "${action:-}" ]; then
    echo "FAILED $branch: malformed row"
    failures=$((failures + 1))
    continue
  fi

  case "$action" in
    delete|archive) ;;
    *)
      echo "FAILED $branch: unknown action $action"
      failures=$((failures + 1))
      continue
      ;;
  esac

  if [ "$apply" -eq 0 ]; then
    echo "WOULD $action $branch @ $sha"
    continue
  fi

  if [ "$action" = "archive" ]; then
    if ! archive_tag "$branch" "$sha"; then
      failures=$((failures + 1))
      continue
    fi
  fi

  if ! delete_branch "$branch" "$sha"; then
    failures=$((failures + 1))
  fi
done < "$manifest"

if [ "$failures" -gt 0 ]; then
  exit 1
fi
exit 0
