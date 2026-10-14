#!/bin/zsh
set -euo pipefail
PROJECT_DIR="/Users/myunghoon/my-stock-scheduler"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$PROJECT_DIR"
exec "$PROJECT_DIR/.venv/bin/python3" -u scripts/collect_yahoo_review_markets.py "$@"
