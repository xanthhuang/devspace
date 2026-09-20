#!/usr/bin/env python3
"""Choice-formulation replay for the frozen DevSpace completion cases."""

from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from replay import CASES, ENDPOINT, KEY_FILE, MODEL


OPTIONS = {
    "FINISH": (
        "All material task obligations are demonstrated as satisfied and the "
        "observable evidence is sufficient to allow the worker to stop."
    ),
    "CONTINUE": (
        "The evidence indicates at least one material task obligation is missing, "
        "incorrectly implemented, or materially contradicted by observable facts."
    ),
    "VERIFY": (
        "No material defect is established from the available evidence, but the "
        "evidence is insufficient to justify stopping; obtain further verification."
    ),
}


def payload_for(mode: str) -> tuple[dict[str, Any], dict[str, str]]:
    state_cases: dict[str, Any] = {}
    questions: dict[str, Any] = {}
    qmap: dict[str, str] = {}
    for idx, case in enumerate(CASES, start=1):
        key = f"c{idx:02d}"
        evidence = list(case["sparse_evidence"])
        if mode == "enriched":
            evidence.extend(case["enriched_evidence"])
        state_cases[key] = {
            "checkpoint": case["checkpoint"],
            "task_contract": case["task_contract"],
            "observable_evidence": evidence,
        }
        q = f"{key}_action"
        questions[q] = {
            "type": "choice",
            "instructions": (
                f"Choose the correct completion-control action for state.cases.{key}. "
                "Use only the task contract and observable evidence. Passing tests or "
                "a worker's self-report is not by itself proof that semantic or "
                "methodology obligations are satisfied."
            ),
            "criteria": OPTIONS,
        }
        qmap[q] = case["case_id"]
    return {
        "model": MODEL,
        "state": {"cases": state_cases},
        "questions": questions,
    }, qmap


def call(api_key: str, mode: str) -> tuple[dict[str, Any], dict[str, Any]]:
    payload, qmap = payload_for(mode)
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = json.loads(response.read())
            request_id = response.headers.get("x-typesafe-request-id")
            status = response.status
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"TypeSafe HTTP {exc.code}: {detail[:1200]}") from exc
    latency_ms = (time.perf_counter() - started) * 1000
    if status != 200 or not isinstance(body.get("answers"), dict):
        raise RuntimeError("invalid TypeSafe response")
    out = {}
    for q, case_id in qmap.items():
        ans = body["answers"].get(q)
        if not isinstance(ans, dict) or ans.get("choice") not in OPTIONS:
            raise RuntimeError(f"invalid Choice answer for {q}: {ans}")
        out[case_id] = {
            "choice": ans["choice"],
            "confidence": ans.get("confidence"),
            "probabilities": ans.get("probabilities"),
        }
    return out, {
        "request_id": request_id,
        "requested_model": MODEL,
        "resolved_model": body.get("model"),
        "usage": body.get("usage"),
        "latency_ms": round(latency_ms, 3),
    }


def summarize(runs: list[dict[str, Any]]) -> dict[str, Any]:
    meta = {c["case_id"]: c for c in CASES}
    by_case: dict[str, list[dict[str, Any]]] = {c["case_id"]: [] for c in CASES}
    for run in runs:
        for case_id, answer in run["answers"].items():
            by_case[case_id].append(answer)

    case_summary = {}
    all_false_finish = all_false_reject = all_complete = all_incomplete = 0
    for case_id, answers in by_case.items():
        counts = {option: sum(a["choice"] == option for a in answers) for option in OPTIONS}
        complete = meta[case_id]["gold_complete"]
        if complete:
            all_complete += len(answers)
            all_false_reject += sum(a["choice"] != "FINISH" for a in answers)
        else:
            all_incomplete += len(answers)
            all_false_finish += sum(a["choice"] == "FINISH" for a in answers)
        confs = [float(a["confidence"]) for a in answers if isinstance(a.get("confidence"), (int, float))]
        case_summary[case_id] = {
            "kind": meta[case_id]["kind"],
            "gold_complete": complete,
            "gold_source": meta[case_id]["gold_source"],
            "choice_counts": counts,
            "choice_flip": len({a["choice"] for a in answers}) > 1,
            "confidence_mean": statistics.mean(confs) if confs else None,
            "confidence_min": min(confs) if confs else None,
            "confidence_max": max(confs) if confs else None,
            "answers": answers,
        }
    return {
        "false_finish": all_false_finish,
        "incomplete_evaluations": all_incomplete,
        "false_finish_rate_on_incomplete": all_false_finish / all_incomplete if all_incomplete else None,
        "false_reject": all_false_reject,
        "complete_evaluations": all_complete,
        "false_reject_rate_on_complete": all_false_reject / all_complete if all_complete else None,
        "case_summary": case_summary,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repeats", type=int, default=10)
    parser.add_argument("--pause", type=float, default=0.10)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    api_key = KEY_FILE.read_text(encoding="utf-8").strip()
    if not api_key:
        raise SystemExit(f"missing TypeSafe API key: {KEY_FILE}")

    raw: dict[str, list[dict[str, Any]]] = {"sparse": [], "enriched": []}
    for mode in ("sparse", "enriched"):
        for i in range(args.repeats):
            answers, metadata = call(api_key, mode)
            raw[mode].append({"answers": answers, "metadata": metadata})
            print(f"{mode} {i+1:02d}/{args.repeats:02d} {metadata['latency_ms']:.0f}ms", flush=True)
            time.sleep(args.pause)

    result = {
        "schema_version": "jev-devspace-completion-choice-replay-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "requested_model": MODEL,
        "gold_labels_sent_to_model": False,
        "repeats_per_mode": args.repeats,
        "modes": {mode: summarize(runs) for mode, runs in raw.items()},
        "raw_runs": raw,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
