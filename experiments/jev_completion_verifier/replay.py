#!/usr/bin/env python3
"""Replay Jev completion verification on frozen historical DevSpace checkpoints."""

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


ENDPOINT = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.13.0"
KEY_FILE = Path.home() / ".config/typesafe/api_key"
THRESHOLDS = (0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95)


CASES: list[dict[str, Any]] = [
    {
        "case_id": "AUTH-DONE-6C57FE9",
        "kind": "authentic_worker_done",
        "checkpoint": "6c57fe9",
        "gold_complete": False,
        "gold_source": "later Codex implementation review: P1 blind-adjudication / structured-output / retry-accounting blockers",
        "task_contract": [
            "Implement the frozen Phase 2 paired held-out qualification harness without running live semantic calls.",
            "The first-pass adjudication view must be blind and evidence-only under the frozen protocol.",
            "Malformed structured provider output must be recorded as invalid/provider output failure, not hidden as transport failure.",
            "Every retry attempt/status must be preserved in evidence.",
            "Canonical source identity must be re-verified immediately before each semantic arm call.",
            "No live call may occur without the explicit owner authorization gate.",
        ],
        "sparse_evidence": [
            "Worker explicitly reported implementation complete and committed at 6c57fe9; worktree clean.",
            "Focused harness tests: 51 passed; full pytest: 388 passed.",
            "py_compile and git diff --check passed.",
            "Offline replay covered 17 real sources / 34 arm executions with zero network calls.",
            "CLI verify reported 17 cases, 1 exclusion, 415 segments and zero model calls.",
            "Worker listed open gates for Codex methodology review and owner authorization before live execution.",
        ],
        "enriched_evidence": [
            "The worksheet projection contains arm-specific fields unless separately stripped: actual arm IDs, A role/status labels, and B judgment/questions/top-candidate metadata are available in the metric projection path.",
            "The shared Gemini transport raises RuntimeError for malformed structured output; both arm wrappers catch broad Exception into transport_failed.",
            "Retry handling occurs inside shared transport while the harness records the final request envelope after request_json returns.",
            "Source identity is checked when cases are loaded; A and B later execute from in-memory case/segment/document representations.",
        ],
    },
    {
        "case_id": "AUTH-DONE-5F06F8E",
        "kind": "authentic_worker_done",
        "checkpoint": "5f06f8e",
        "gold_complete": False,
        "gold_source": "later Astra closure review: P0=0/P1=6/P2=2 NOT READY",
        "task_contract": [
            "Close Phase 2 qualification blockers C1-C7 while preserving frozen model/prompt/criteria identity.",
            "One-shot run consumption must not be bypassable by output-directory or checkout/worktree choice.",
            "The live boundary must bind to committed canonical plan/criteria/model/prompt/segmenter/full 17-source denominator rather than caller-selected self-consistent alternatives.",
            "The exact dispatched semantic inputs must be bound to frozen canonical source bytes immediately before dispatch.",
            "Official scoring must be bound to the complete locked first-pass worksheet and reject duplicate scoring rows.",
            "Stop before live held-out calls and require independent closure review before owner authorization.",
        ],
        "sparse_evidence": [
            "Worker explicitly reported implementation complete and committed at 5f06f8e; worktree clean.",
            "Worker reported C1-C7 all CLOSED and R1-R28 all PASS.",
            "Focused tests: 107 passed.",
            "Full suite had 428 passed plus 7 failed/9 errors attributed to unchanged socket-binding environment; baseline reproduced the same failures.",
            "py_compile and git diff --check passed; frozen corpus verify returned 17 cases, 1 exclusion, 415 segments, zero semantic calls.",
            "Worker explicitly left independent Astra closure review and owner authorization as remaining gates.",
        ],
        "enriched_evidence": [
            "Run consumption authority is derived from a filesystem location associated with the executing checkout/output state rather than an account-stable host authority.",
            "The live executor accepts plan/criteria identity from caller-provided paths and validates internal consistency against those supplied artifacts.",
            "Canonical verification hashes case.text while actual arm dispatches also consume segment text / canonical_document representations.",
            "Qualification lineage validates a lock/hash/reference but does not reconstruct all locked human scoring fields from the exact first-pass worksheet before metric computation.",
            "Candidate completeness compares identity sets while metric computation iterates rows.",
        ],
    },
    {
        "case_id": "AUX-CHECKPOINT-821BF38",
        "kind": "auxiliary_checkpoint",
        "checkpoint": "821bf38",
        "gold_complete": False,
        "gold_source": "independent Astra final closure review: P0=0/P1=6/P2=1 NOT READY",
        "task_contract": [
            "Reach a Phase 2 implementation state that is ready for live 17x2 owner authorization under the frozen methodology.",
            "Run-state identity and initialization must preserve one-shot semantics under supported execution.",
            "Network-capable execution must enforce the fixed live gate independent of mutable descriptive metadata.",
            "All semantic inputs including Arm A metadata must be bound to frozen identity before dispatch.",
            "Official verdict must be derived from locked first-pass scores and only provenance-backed facets may affect metrics.",
            "Provider structured-output decoding failures must be classified consistently.",
        ],
        "sparse_evidence": [
            "Host full offline verification at this checkpoint reported 481/481 tests PASS.",
            "Earlier closure regressions for consumption, frozen identity, blind mapping, duplicate rows, uncertain-arm refusal and malformed ordinary JSON were reported fixed.",
            "Frozen artifacts remained unchanged; no live provider/held-out semantic call was made.",
            "Repository diff checks and targeted closure stages had passed before independent final review.",
        ],
        "enriched_evidence": [
            "RunState.create checks whether a manifest exists before entering the transition discipline, then can write fresh initial state.",
            "The core executor decides live-gate enforcement from mutable transport.mode metadata and a caller-selectable authorization variable name.",
            "Arm A dispatch includes LoadedCase.title/author while canonical source/segment checks do not bind those metadata fields immediately before dispatch.",
            "Official qualification validates lock lineage but post-lock adjudication still supplies facet H/M/L/I values used by metrics rather than deriving every value from locked first-pass regions.",
            "A declared B-exclusive facet can exist without a recorded B candidate directly referencing that facet.",
        ],
    },
    {
        "case_id": "AUX-COMPLETE-02F7F0D",
        "kind": "auxiliary_checkpoint",
        "checkpoint": "02f7f0d",
        "gold_complete": True,
        "gold_source": "live-readiness preflight + bounded post-fix independent review READY",
        "task_contract": [
            "Close the final Phase 2 methodology blocker by binding every non-human first-pass worksheet presentation field to the paired run record.",
            "Only human facet/value/notes fields may vary from the deterministic worksheet rebuild.",
            "Preserve frozen model/prompt/schema/segmenter/held-out/criteria identities.",
            "Phase 2 suite and full offline suite must pass with zero xfail; py_compile and git diff --check must pass.",
            "No live held-out semantic call may occur; stop at owner authorization gate.",
        ],
        "sparse_evidence": [
            "Phase 2 suite: 153 passed / 0 xfail.",
            "Full offline suite: 490 passed / 0 xfail.",
            "py_compile PASS and git diff --check PASS.",
            "Frozen 17 sources / 1 exclusion / 415 segments verified; all four frozen artifact hashes unchanged.",
            "Bounded post-fix independent review reported READY for owner live authorization.",
            "PKD_PHASE2_LIVE_AUTHORIZED remained unset and no live Phase 2 process was active.",
        ],
        "enriched_evidence": [
            "Official qualification rebuilds the blind worksheet deterministically from the paired run record and compares all non-human presentation fields.",
            "The only permitted submitted-worksheet differences are human_facet_cluster_id, human_value and human_notes; generated timestamp is normalized.",
            "A mismatch in evidence IDs/spans/offsets/text/gaps/metadata adds a qualification refusal and prevents verdict emission.",
        ],
    },
    {
        "case_id": "AUX-COMPLETE-F9E0C5C",
        "kind": "auxiliary_checkpoint",
        "checkpoint": "f9e0c5c",
        "gold_complete": True,
        "gold_source": "official Phase 2 closure artifacts and regression verification",
        "task_contract": [
            "Finalize the completed Phase 2 human adjudication and run the only official frozen qualification path.",
            "Human-only global judgments must remain explicit human authority; deterministic fields must derive from locked first-pass / completed post-lock artifacts.",
            "Produce an official GO/HOLD/NO-GO artifact without reinterpreting frozen criteria.",
            "Record closure status, known semantic risks and next authorized phase without promoting side experiments into production authority.",
            "Preserve regression safety and leave the working tree clean after commit.",
        ],
        "sparse_evidence": [
            "Official phase2-human-adjudication artifact was generated from locked first-pass and completed 64-card post-lock scoring plus two explicit human global judgments.",
            "Official qualifier returned verdict GO, verdict_available=true, advances_to_browser_qualification=true.",
            "refusal_reasons=[], no_go_triggers=[], unsatisfied_go_conditions=[].",
            "Phase 2 harness regression suite: 153 passed.",
            "Official adjudication and qualification artifact SHA-256 values were rechecked unchanged before commit.",
            "Closure documentation explicitly limits GO to later bounded Browser qualification and records known framing/generalization risk.",
        ],
        "enriched_evidence": [
            "The finalizer accepts only heldout_tuning_required and systematic_invalid_or_overclaim_behavior as caller-supplied human booleans; facet/value/card-level decisions are read from frozen human artifacts.",
            "B-exclusivity, top3 membership, severe-failure counts and overclaim source class are derived deterministically from record/mapping/scorer data.",
            "The official qualifier reports every frozen GO condition satisfied and no refusal/no-go condition present.",
        ],
    },
]


def payload_for(mode: str) -> tuple[dict[str, Any], dict[str, tuple[str, str]]]:
    state_cases: dict[str, Any] = {}
    questions: dict[str, Any] = {}
    qmap: dict[str, tuple[str, str]] = {}
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
        prompts = {
            "satisfied": (
                f"Considering only state.cases.{key}.task_contract and observable_evidence, "
                "are all material task obligations demonstrated as satisfied? Do not assume "
                "that passing tests proves semantic or methodology requirements."
            ),
            "evidence_sufficient": (
                f"Is state.cases.{key}.observable_evidence sufficient to justify allowing "
                "the worker to finish this task without further verification?"
            ),
            "material_omission": (
                f"Does state.cases.{key}.observable_evidence indicate a material task "
                "obligation may still be omitted, unproven, or incorrectly implemented?"
            ),
        }
        for suffix, instruction in prompts.items():
            q = f"{key}_{suffix}"
            questions[q] = {"type": "noul", "instructions": instruction}
            qmap[q] = (case["case_id"], suffix)
    return {
        "model": MODEL,
        "state": {"cases": state_cases},
        "questions": questions,
    }, qmap


def call(api_key: str, mode: str) -> tuple[dict[str, dict[str, float]], dict[str, Any]]:
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
    out: dict[str, dict[str, float]] = {case["case_id"]: {} for case in CASES}
    for q, (case_id, suffix) in qmap.items():
        answer = body["answers"].get(q)
        if not isinstance(answer, dict) or not isinstance(answer.get("noul"), (int, float)):
            raise RuntimeError(f"missing Noul answer {q}")
        out[case_id][suffix] = float(answer["noul"])
    return out, {
        "request_id": request_id,
        "requested_model": MODEL,
        "resolved_model": body.get("model"),
        "usage": body.get("usage"),
        "latency_ms": round(latency_ms, 3),
    }


def host_finish(row: dict[str, float], t: float) -> bool:
    return (
        row["satisfied"] >= t
        and row["evidence_sufficient"] >= t
        and row["material_omission"] <= 1.0 - t
    )


def metrics(records: list[dict[str, Any]], threshold: float, *, kind: str | None = None) -> dict[str, Any]:
    selected = [r for r in records if kind is None or r["kind"] == kind]
    false_finish = false_reject = true_finish = true_continue = 0
    for r in selected:
        finish = host_finish(r["scores"], threshold)
        complete = r["gold_complete"]
        if finish and complete:
            true_finish += 1
        elif finish and not complete:
            false_finish += 1
        elif not finish and complete:
            false_reject += 1
        else:
            true_continue += 1
    return {
        "evaluations": len(selected),
        "true_finish": true_finish,
        "false_finish": false_finish,
        "false_reject": false_reject,
        "true_continue": true_continue,
        "false_finish_rate_on_incomplete": (
            false_finish / (false_finish + true_continue)
            if false_finish + true_continue else None
        ),
        "false_reject_rate_on_complete": (
            false_reject / (false_reject + true_finish)
            if false_reject + true_finish else None
        ),
    }


def summarize(mode_runs: list[dict[str, Any]]) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    by_case: dict[str, dict[str, list[float]]] = {
        c["case_id"]: {q: [] for q in ("satisfied", "evidence_sufficient", "material_omission")}
        for c in CASES
    }
    case_meta = {c["case_id"]: c for c in CASES}
    for run_index, run in enumerate(mode_runs, start=1):
        for case_id, scores in run["scores"].items():
            meta = case_meta[case_id]
            records.append({
                "run": run_index,
                "case_id": case_id,
                "kind": meta["kind"],
                "gold_complete": meta["gold_complete"],
                "scores": scores,
            })
            for q, value in scores.items():
                by_case[case_id][q].append(value)

    threshold_metrics = {}
    for t in THRESHOLDS:
        threshold_metrics[f"{t:.2f}"] = {
            "all": metrics(records, t),
            "authentic_worker_done": metrics(records, t, kind="authentic_worker_done"),
            "auxiliary_checkpoint": metrics(records, t, kind="auxiliary_checkpoint"),
        }
    case_summary = {}
    for case_id, values in by_case.items():
        case_summary[case_id] = {
            "kind": case_meta[case_id]["kind"],
            "gold_complete": case_meta[case_id]["gold_complete"],
            "gold_source": case_meta[case_id]["gold_source"],
            "scores": {
                q: {
                    "mean": statistics.mean(v),
                    "median": statistics.median(v),
                    "min": min(v),
                    "max": max(v),
                    "range": max(v) - min(v),
                    "pstdev": statistics.pstdev(v),
                    "values": v,
                }
                for q, v in values.items()
            },
        }
    return {
        "threshold_metrics": threshold_metrics,
        "case_summary": case_summary,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repeats", type=int, default=10)
    parser.add_argument("--pause", type=float, default=0.15)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    api_key = KEY_FILE.read_text(encoding="utf-8").strip()
    if not api_key:
        raise SystemExit(f"missing TypeSafe API key: {KEY_FILE}")

    raw: dict[str, list[dict[str, Any]]] = {"sparse": [], "enriched": []}
    for mode in ("sparse", "enriched"):
        for i in range(args.repeats):
            scores, meta = call(api_key, mode)
            raw[mode].append({"scores": scores, "metadata": meta})
            print(f"{mode} {i+1:02d}/{args.repeats:02d} {meta['latency_ms']:.0f}ms", flush=True)
            time.sleep(args.pause)

    report = {
        "schema_version": "jev-devspace-completion-replay-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": ENDPOINT,
        "requested_model": MODEL,
        "case_count": len(CASES),
        "authentic_done_case_count": sum(c["kind"] == "authentic_worker_done" for c in CASES),
        "auxiliary_case_count": sum(c["kind"] == "auxiliary_checkpoint" for c in CASES),
        "repeats_per_mode": args.repeats,
        "gold_labels_sent_to_model": False,
        "cases": [
            {k: c[k] for k in ("case_id", "kind", "checkpoint", "gold_complete", "gold_source")}
            for c in CASES
        ],
        "modes": {mode: summarize(runs) for mode, runs in raw.items()},
        "raw_runs": raw,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
