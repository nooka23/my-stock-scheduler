#!/bin/zsh
set -euo pipefail
PROJECT_DIR="/Users/myunghoon/my-stock-scheduler"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PYTHONUNBUFFERED=1
cd "$PROJECT_DIR"
PYTHON_BIN="$PROJECT_DIR/.venv/bin/python3"
if [[ ! -x "$PYTHON_BIN" || ! -f "$PROJECT_DIR/.env.local" ]]; then
  echo "FRED job requires project .venv and .env.local" >&2
  exit 1
fi
printf '%s [fred-daily] Job started\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
"$PYTHON_BIN" scripts/collect_daily_review_fred.py "$@"
printf '%s [fred-daily] Job completed\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
