#!/bin/zsh

set -euo pipefail

PROJECT_DIR="/Users/myunghoon/my-stock-scheduler"
LOG_DIR="$PROJECT_DIR/scripts/output/dart_backfill_logs"
LOG_PREFIX="[dart-backfill]"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PYTHONUNBUFFERED=1

mkdir -p "$LOG_DIR"
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

LOG_FILE="$LOG_DIR/$(date '+%Y%m%d')_backfill.log"

log "Job started" | tee -a "$LOG_FILE"
"$PYTHON_BIN" scripts/export_dart_financials_backfill_daily.py "$@" 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${pipestatus[1]}

if [[ $EXIT_CODE -eq 0 ]]; then
  log "Job completed" | tee -a "$LOG_FILE"
else
  log "Job failed with exit code $EXIT_CODE" | tee -a "$LOG_FILE"
fi

exit $EXIT_CODE
