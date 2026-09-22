#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from replay import CASES


def classify(state: dict) -> str:
    error = str(state.get("error") or "").lower()
    code = str(state.get("error_code") or "").lower()
    tool = state.get("tool")

    if any(x in error for x in ("permission denied", "eacces", "unauthorized", "forbidden")):
        return "PERMISSION"
    if tool == "read" and (
        ("offset " in error and "beyond end of file" in error)
        or "eisdir" in error
        or "enoent" in error
    ):
        return "USER_ERROR"
    if any(x in error for x in (
        "no buffer space available",
        "no route to host",
        "timeout: no recent network activity",
    )):
        return "TRANSIENT"
    if "connect: connection refused" in error and state.get("component") == "cloudflared origin proxy":
        return "ENVIRONMENT"
    if code == "err_erl_permissive_trust_proxy":
        return "CODE_BUG"
    return "UNKNOWN"


def main() -> None:
    rows = []
    for case in CASES:
        prediction = classify(case["state"])
        rows.append({
            "id": case["id"],
            "gold": case["gold"],
            "prediction": prediction,
            "correct": prediction == case["gold"],
        })
    report = {
        "schema": "devspace-post-tool-deterministic-baseline-v1",
        "independent_cases": len(rows),
        "correct": sum(r["correct"] for r in rows),
        "accuracy": sum(r["correct"] for r in rows) / len(rows),
        "rows": rows,
    }
    out = Path("experiments/jev_post_tool_classifier/baseline-20260922.json")
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(out)


if __name__ == "__main__":
    main()

