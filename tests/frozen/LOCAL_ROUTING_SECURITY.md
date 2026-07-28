# Local routing security test freeze

Frozen on 2026-07-28 immediately after the intentionally failing baseline.

The immutable contract covers:

- route-level denial of Qwen when an existing conversation may contain
  protected history;
- route-level omission of student bundles, conversation history, and RAG from
  the only Qwen-eligible minimal casual-chat payload;
- protected payload, RAG, attachment, crisis, staff, and uncertain-task
  fail-closed selection;
- inventory validation before rollout activation; and
- one activation operation that owns configuration changes and its audit record
  atomically.

Verify the files against `local-routing-security.sha256`. Do not edit the three
listed test files to make implementation pass; add separate tests for any new
coverage.
