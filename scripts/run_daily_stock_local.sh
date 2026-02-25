#!/bin/zsh

set -euo pipefail

PROJECT_DIR="/Users/myunghoon/my-stock-scheduler"
LOG_PREFIX="[daily-stock]"

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
  log "WARNING: .env.local not found. Python scripts may fail due to missing env vars."
fi

run_step() {
  local name="$1"
  local script_path="$2"

  log "START ${name}"
  "$PYTHON_BIN" "$script_path"
  log "DONE  ${name}"
}

log "Job started"
run_step "Update Stock Data (V3)" "scripts/update_today_v3.py"
run_step "Calculate Trading Value Rank" "scripts/calculate_trading_value_rank.py"
run_step "Calculate RS (V2)" "scripts/calculate_rs_v2.py"
run_step "Calculate Leader Stocks (Daily)" "scripts/calculate_leader_stocks_daily.py"
run_step "Update Market Indices (Daily)" "scripts/update_group_indices_daily.py"
log "Job completed"
