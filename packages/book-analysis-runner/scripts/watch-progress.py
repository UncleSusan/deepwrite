#!/usr/bin/env python3
"""Monitor a headless book-analysis task and power off after a verified finish."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def read_task(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict) or not isinstance(value.get("items"), list):
        raise ValueError("task.json has an invalid shape")
    return value


def is_finished(task: dict[str, Any], result_path: Path) -> bool:
    items = task["items"]
    return (
        task.get("status") == "completed"
        and bool(items)
        and all(
            isinstance(item, dict)
            and item.get("status") == "completed"
            and item.get("completedUnits", 0) >= item.get("estimatedUnits", 0)
            for item in items
        )
        and result_path.is_file()
        and result_is_readable(result_path)
    )


def result_is_readable(path: Path) -> bool:
    try:
        with path.open(encoding="utf-8") as stream:
            value = json.load(stream)
        return isinstance(value, dict) and value.get("format") == "deepwrite-long-book-analysis"
    except (OSError, json.JSONDecodeError):
        return False


def print_status(task: dict[str, Any]) -> None:
    completed = sum(
        item.get("completedUnits", 0)
        for item in task["items"]
        if isinstance(item, dict)
    )
    estimated = sum(
        item.get("estimatedUnits", 0)
        for item in task["items"]
        if isinstance(item, dict)
    )
    percent = completed / estimated * 100 if estimated else 0
    stamp = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    print(f"[{stamp}] Task Status: {task.get('status', 'unknown')} ({completed}/{estimated}, {percent:.1f}%)")
    for item in task["items"]:
        if not isinstance(item, dict):
            continue
        checkpoint = item.get("checkpoint") or {}
        print(
            f"  - {item.get('presetName', item.get('presetId', '?'))} | "
            f"{item.get('status', 'unknown')} | "
            f"{item.get('completedUnits', 0)}/{item.get('estimatedUnits', 0)} | "
            f"Phase: {checkpoint.get('phase', '-')} | "
            f"Error: {item.get('error', '-')}"
        )
    sys.stdout.flush()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", type=Path, required=True, help="Path to task.json")
    parser.add_argument("--result", type=Path, help="Result bundle path")
    parser.add_argument("--interval", type=float, default=30, help="Polling interval in seconds")
    parser.add_argument("--stale-seconds", type=float, default=1800, help="Warn after this time without progress")
    parser.add_argument("--once", action="store_true", help="Print one status and exit")
    parser.add_argument("--dry-run", action="store_true", help="Report shutdown without executing it")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    task_path = args.task.resolve()
    result_path = (args.result or task_path.parent / "result.deepwrite-book-analysis.json").resolve()
    last_updated = None
    last_change_at = time.monotonic()

    while True:
        try:
            task = read_task(task_path)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            print(f"Unable to read task: {error}", file=sys.stderr, flush=True)
            if args.once:
                return 1
            time.sleep(args.interval)
            continue

        print_status(task)
        updated_at = task.get("updatedAt")
        if updated_at != last_updated:
            last_updated = updated_at
            last_change_at = time.monotonic()
        elif time.monotonic() - last_change_at >= args.stale_seconds:
            print(f"Warning: no task.json update for {args.stale_seconds:.0f}s", flush=True)
            last_change_at = time.monotonic()

        if is_finished(task, result_path):
            print(f"Verified complete. Result: {result_path}", flush=True)
            if args.dry_run:
                print("Dry run: shutdown -h now", flush=True)
            else:
                subprocess.run(["shutdown", "-h", "now"], check=False)
            return 0
        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
