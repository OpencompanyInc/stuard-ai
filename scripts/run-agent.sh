#!/bin/bash
#
# Start the local Python agent (macOS/Linux)
# - Uses venv python directly
# - Bootstraps pip if missing
# - Installs requirements
#
set -e

echo "[agent] Preparing venv..."
cd "$(dirname "$0")/../apps/agent"

if [ ! -d .venv ]; then
  echo "[agent] Creating .venv"
  python3 -m venv .venv
fi

VENV_PYTHON=".venv/bin/python"
if [ ! -f "$VENV_PYTHON" ]; then
  echo "[agent] venv python not found at $VENV_PYTHON" >&2
  exit 1
fi

echo "[agent] Ensuring pip..."
"$VENV_PYTHON" -m ensurepip --upgrade 2>/dev/null || true
"$VENV_PYTHON" -m pip install --upgrade pip wheel setuptools

echo "[agent] Ensuring dependencies..."
"$VENV_PYTHON" -m pip install -r requirements.txt

export CLOUD_AI_WS="ws://127.0.0.1:8082/ws"
echo "[agent] Starting agent with CLOUD_AI_WS=$CLOUD_AI_WS"
"$VENV_PYTHON" -m app.main
