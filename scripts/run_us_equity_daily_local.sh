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
# At 06:10 KST the prior Korean calendar date is the intended US session date
# in both EDT and EST. KIS supplies the latest available rows on holidays.
log "Collecting the latest closed US session via KIS"
"$PYTHON_BIN" scripts/collect_us_equity_kis.py
log "Calculating separate US RS rankings"
"$PYTHON_BIN" scripts/calculate_us_rs.py
log "Job completed"
