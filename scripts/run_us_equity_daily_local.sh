#!/bin/zsh

set -euo pipefail

PROJECT_DIR="/Users/myunghoon/my-stock-scheduler"
LOG_PREFIX="[us-equity-daily]"

# launchd starts with a minimal PATH, so set common locations explicitly.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PYTHONUNBUFFERED=1

cd "$PROJECT_DIR"

timestamp() {
  date "+%Y-%m-%d %H:%M:%S"
}

log() {
  echo "$(timestamp) ${LOG_PREFIX} $*"
}

if [[ -x "$PROJECT_DIR/.venv/bin/python3" ]]; then
  PYTHON_BIN="$PROJECT_DIR/.venv/bin/python3"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
else
  log "ERROR: python3 not found"
  exit 1
fi

if [[ ! -f "$PROJECT_DIR/.env.local" ]]; then
  log "ERROR: .env.local not found"
  exit 1
fi

log "Job started"
log "Collecting the active US common-stock universe and the latest 3 calendar days"
"$PYTHON_BIN" scripts/collect_us_equity_massive.py --lookback-days 3
log "Job completed"
