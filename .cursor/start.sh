#!/usr/bin/env bash
# Cloud Agent start phase for VisionQuest.
#
# Per-boot reconciliation: bring the local PostgreSQL cluster online and wait
# until it accepts connections, then return. Durable setup (packages, schema,
# dependencies) is handled once in .cursor/install.sh.
set -euo pipefail

PG_VERSION=16

echo "==> [start] Ensuring the PostgreSQL cluster is online"
if ! sudo pg_lsclusters -h | awk '{print $4}' | grep -q '^online$'; then
  sudo pg_ctlcluster "${PG_VERSION}" main start || true
fi

echo "==> [start] Waiting for PostgreSQL to accept connections"
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then
    echo "==> [start] PostgreSQL is ready."
    exit 0
  fi
  sleep 1
done

echo "==> [start] PostgreSQL did not become ready in time." >&2
exit 1
