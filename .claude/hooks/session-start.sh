#!/bin/bash
# Installs dependencies in Claude Code cloud sessions so check, lint and tests can run.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
    echo "export PATH=\"$HOME/.bun/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  else
    npm install --global bun@1.4.2
  fi
fi

bun install
