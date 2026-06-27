#!/usr/bin/env bash
# Sync this edition fork with the core/full upstream (centaurai-station).
# The edition is fixed by the AIONUI_EDITION repo variable, NOT by source changes,
# so merging upstream should stay conflict-free.
set -euo pipefail

UPSTREAM_URL="https://github.com/finewood2008/centaurai-station.git"
UPSTREAM_BRANCH="${1:-main}"

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "Adding upstream remote -> $UPSTREAM_URL"
  git remote add upstream "$UPSTREAM_URL"
fi

git fetch upstream "$UPSTREAM_BRANCH"
git merge --no-edit "upstream/$UPSTREAM_BRANCH"

echo "✅ Synced from upstream/$UPSTREAM_BRANCH. Edition is set by the AIONUI_EDITION repo variable."
