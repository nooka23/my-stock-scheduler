from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = PROJECT_ROOT / "scripts" / "export_dart_financials_by_account_id.py"
DEFAULT_STATE_PATH = PROJECT_ROOT / "scripts" / "output" / "dart_financials_backfill_state.json"


@dataclass
class Period:
    year: int
    quarter: int


def previous_period(period: Period) -> Period | None:
    if period.quarter > 1:
        return Period(year=period.year, quarter=period.quarter - 1)
    if period.year <= 0:
        return None
    return Period(year=period.year - 1, quarter=4)


def is_before(a: Period, b: Period) -> bool:
    return (a.year, a.quarter) < (b.year, b.quarter)


def build_period_batch(start: Period, end: Period, batch_size: int) -> list[Period]:
    periods: list[Period] = []
    current: Period | None = start
    while current and len(periods) < batch_size and not is_before(current, end):
        periods.append(current)
        current = previous_period(current)
    return periods


def next_start_after_success(period: Period, end: Period) -> Period | None:
    candidate = previous_period(period)
    if candidate is None or is_before(candidate, end):
        return None
    return candidate


def load_state(state_path: Path) -> dict:
    if not state_path.exists():
        return {}
    return json.loads(state_path.read_text(encoding="utf-8"))


def save_state(state_path: Path, state: dict) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def build_base_command(args: argparse.Namespace) -> list[str]:
    command = [
        sys.executable,
        str(SCRIPT_PATH),
        "--api-limit",
        str(args.api_limit),
        "--sleep",
        str(args.sleep),
        "--fs-div-mode",
        args.fs_div_mode,
    ]
    if args.max_companies is not None:
        command.extend(["--max-companies", str(args.max_companies)])
    if args.codes:
        command.extend(["--codes", *args.codes])
    elif args.markets:
        command.extend(["--markets", *args.markets])
    if args.include_etf:
        command.append("--include-etf")
    if args.include_spac:
        command.append("--include-spac")
    if args.include_preferred:
        command.append("--include-preferred")
    return command


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run DART financial backfill in daily batches and remember progress."
    )
    parser.add_argument("--start-year", type=int, default=2022, help="first backfill year to run")
    parser.add_argument("--start-quarter", type=int, choices=(1, 2, 3, 4), default=4, help="first backfill quarter to run")
    parser.add_argument("--end-year", type=int, default=2000, help="last backfill year to include")
    parser.add_argument("--end-quarter", type=int, choices=(1, 2, 3, 4), default=1, help="last backfill quarter to include")
    parser.add_argument("--batch-size", type=int, default=11, help="quarters to process per run")
    parser.add_argument("--state-file", default=str(DEFAULT_STATE_PATH), help="json file that stores next period")
    parser.add_argument("--reset-state", action="store_true", help="ignore saved progress and restart from start period")
    parser.add_argument("--dry-run", action="store_true", help="print planned periods without running child scripts")
    parser.add_argument("--api-limit", type=int, default=9500, help="forwarded to child script")
    parser.add_argument("--sleep", type=float, default=0.2, help="forwarded to child script")
    parser.add_argument("--max-companies", type=int, default=None, help="forwarded to child script")
    parser.add_argument("--codes", nargs="*", default=None, help="forwarded to child script")
    parser.add_argument("--markets", nargs="*", default=["KOSPI", "KOSDAQ"], help="forwarded to child script")
    parser.add_argument("--include-etf", action="store_true", help="forwarded to child script")
    parser.add_argument("--include-spac", action="store_true", help="forwarded to child script")
    parser.add_argument("--include-preferred", action="store_true", help="forwarded to child script")
    parser.add_argument(
        "--fs-div-mode",
        choices=("all", "cfs", "ofs"),
        default="all",
        help="forwarded to child script",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    state_path = Path(args.state_file).expanduser().resolve()
    configured_start = Period(year=args.start_year, quarter=args.start_quarter)
    configured_end = Period(year=args.end_year, quarter=args.end_quarter)

    if is_before(configured_start, configured_end):
        raise SystemExit("start period must be the same as or later than end period")

    state = {} if args.reset_state else load_state(state_path)
    next_period_data = state.get("next_period")
    current_start = (
        Period(year=next_period_data["year"], quarter=next_period_data["quarter"])
        if next_period_data
        else configured_start
    )

    if is_before(current_start, configured_end):
        print("Backfill already completed.")
        return 0

    periods = build_period_batch(current_start, configured_end, args.batch_size)
    if not periods:
        print("No periods left to process.")
        return 0

    print(
        f"Planned periods: {', '.join(f'{period.year}Q{period.quarter}' for period in periods)}"
    )
    print(f"State file: {state_path}")

    if args.dry_run:
        return 0

    base_command = build_base_command(args)
    completed_periods: list[str] = []

    state_payload = {
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "configured_start_period": asdict(configured_start),
        "configured_end_period": asdict(configured_end),
        "batch_size": args.batch_size,
        "next_period": asdict(current_start),
        "last_completed_period": state.get("last_completed_period"),
        "completed_periods": state.get("completed_periods", []),
    }
    save_state(state_path, state_payload)

    for period in periods:
        command = [
            *base_command,
            "--year",
            str(period.year),
            "--quarter",
            str(period.quarter),
        ]
        print("")
        print(f"=== Running {period.year}Q{period.quarter} ===")
        print("Command:", " ".join(command))

        result = subprocess.run(command, cwd=PROJECT_ROOT, check=False)
        if result.returncode != 0:
            state_payload["updated_at"] = datetime.now().isoformat(timespec="seconds")
            state_payload["next_period"] = asdict(period)
            save_state(state_path, state_payload)
            print(f"Stopped on failure at {period.year}Q{period.quarter}")
            return result.returncode

        completed_periods.append(f"{period.year}Q{period.quarter}")
        next_period = next_start_after_success(period, configured_end)
        state_payload["updated_at"] = datetime.now().isoformat(timespec="seconds")
        state_payload["last_completed_period"] = asdict(period)
        state_payload["next_period"] = asdict(next_period) if next_period else None
        state_payload["completed_periods"] = [*state_payload["completed_periods"], f"{period.year}Q{period.quarter}"]
        save_state(state_path, state_payload)

    print("")
    print(f"Completed periods: {', '.join(completed_periods)}")
    if state_payload["next_period"]:
        next_period = state_payload["next_period"]
        print(f"Next period: {next_period['year']}Q{next_period['quarter']}")
    else:
        print("Backfill completed through configured end period.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
