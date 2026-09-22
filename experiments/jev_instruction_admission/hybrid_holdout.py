#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import replay as core
import sealed_replay as sealed


# Architecture fixed before this fresh holdout:
# deterministic INCLUDE union Jev fail-safe INCLUDE. The Jev confidence floor
# remains the previously calibrated 0.30 and is not changed here.
CONFIDENCE_FLOOR = sealed.CONFIDENCE_FLOOR


HOLDOUT_TASKS = [
    {
        "id": "HLD01", "repo": "xanthhuang/devspace",
        "task": "Clarify the managed subagents instruction-loading contract so users understand when the bundled subagent skill is loaded and what context workers receive.",
        "provenance": "git:c803ce4 docs(subagents): clarify managed instruction loading",
        "required": ["ROUTING", "SUBAGENTS"],
    },
    {
        "id": "HLD02", "repo": "xanthhuang/devspace",
        "task": "Fix managed skill loading so the bundled subagents skill is pinned to the intended managed source instead of drifting to another copy.",
        "provenance": "git:dfa2032 fix(skills): pin managed subagents source",
        "required": ["ROUTING", "SUBAGENTS", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "HLD03", "repo": "xanthhuang/devspace",
        "task": "Add explicit subagent instruction-loading configuration so a bounded worker receives the intended managed instructions and no accidental parent context.",
        "provenance": "git:7406d40 feat(subagents): configure instruction loading",
        "required": ["ROUTING", "SUBAGENTS", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "HLD04", "repo": "xanthhuang/devspace",
        "task": "Manage the bundled subagents skill as an explicit DevSpace skill source, including loading behavior and regression coverage.",
        "provenance": "git:abd549f feat(skills): manage bundled subagents skill",
        "required": ["ROUTING", "SUBAGENTS", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "HLD05", "repo": "xanthhuang/devspace",
        "task": "Fix configuration startup so the legacy tool-mode setting migrates into the current configuration model without changing the user's effective tool surface.",
        "provenance": "git:c995713 fix(config): migrate legacy tool mode",
        "required": ["ROUTING", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "HLD06", "repo": "xanthhuang/devspace",
        "task": "Fix development/runtime linking so the linked executable stays aligned with the source being edited instead of silently executing stale built code.",
        "provenance": "git:216e50d fix: keep linked runtime aligned with source",
        "required": ["ROUTING", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH"],
    },
    {
        "id": "HLD07", "repo": "xanthhuang/devspace",
        "task": "Fix the Claude local-agent adapter to expose the intended general shell execution capability while preserving the supported authority boundary and regression behavior.",
        "provenance": "git:b9ea8bd fix(claude): expose general shell execution",
        "required": ["ROUTING", "SECURITY", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "HLD08", "repo": "xanthhuang/devspace",
        "task": "Fix the agent target catalog so disabled providers are not presented as usable choices to the Host.",
        "provenance": "git:5e58895 fix(agents): hide disabled providers from catalogs",
        "required": ["ROUTING", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH"],
    },
    {
        "id": "HLD09", "repo": "xanthhuang/devspace",
        "task": "Fix provider availability so the catalog refreshes current provider state rather than exposing stale availability to the Host.",
        "provenance": "git:b1827cb fix(agents): refresh provider availability",
        "required": ["ROUTING", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "HLD10", "repo": "xanthhuang/devspace",
        "task": "Add direct-CLI workspace resolution so local agent sessions bind to the correct workspace root and project context.",
        "provenance": "git:9b7afac feat(agents): resolve direct CLI workspaces",
        "required": ["ROUTING", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "HLD11", "repo": "xanthhuang/devspace",
        "task": "Fix direct CLI workspace-root handling so equivalent filesystem paths are canonicalized before workspace authority is assigned.",
        "provenance": "git:b9d0d0f fix(cli): canonicalize direct workspace roots",
        "required": ["ROUTING", "SECURITY", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH"],
    },
    {
        "id": "HLD12", "repo": "xanthhuang/devspace",
        "task": "Fix agent startup so a new process waits for daemon ownership handoff rather than racing an existing daemon during replacement.",
        "provenance": "git:e7e0bb4 fix(agents): wait for daemon ownership handoff",
        "required": ["ROUTING", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH"],
    },
    {
        "id": "HLD13", "repo": "xanthhuang/fire-knowledge-agent",
        "task": "Research the current Google Gemini API Free Tier model and rate limits from up-to-date public sources, then assess whether it is sufficient for the planned FIRE/Local-AI experiment.",
        "provenance": "conversation:2026-09-01 Gemini Free Tier capability research",
        "required": ["ROUTING", "AGENT_REACH"],
    },
    {
        "id": "HLD14", "repo": "xanthhuang/personal-content-distiller",
        "task": "Use the logged-in browser to reproduce the production relation-history duplication and search-input reset behavior, then verify the fixed interaction in the real UI.",
        "provenance": "conversation:2026-09-13 PKD Browser relation-history/search defect",
        "required": ["ROUTING", "EGO_BROWSER"],
    },
    {
        "id": "HLD15", "repo": "xanthhuang/personal-content-distiller",
        "task": "Delegate a bounded independent architecture assessment to Claude Code and Codex in parallel, with minimal facts and explicit scope, and collect their written reports for Host adjudication.",
        "provenance": "conversation:2026-09-13 independent Claude/Codex architecture reports",
        "required": ["ROUTING", "SUBAGENTS"],
    },
]


def hybrid_metrics(run: dict, baseline_predictions: dict[str, str]) -> dict:
    task_map = {t["id"]: t for t in HOLDOUT_TASKS}
    required = irrelevant = hit = excluded = 0
    total_chars = loaded_chars = required_chars = required_loaded_chars = 0
    misses = []
    false_includes = []
    for qid, answer in run["answers"].items():
        tid, fid = qid.split("__", 1)
        task = task_map[tid]
        gold = fid in task["required"]
        confidence = answer.get("confidence")
        jev_include = answer.get("choice") in ("INCLUDE", "UNCERTAIN")
        if answer.get("choice") == "EXCLUDE" and (
            not isinstance(confidence, (int, float)) or confidence < CONFIDENCE_FLOOR
        ):
            jev_include = True
        deterministic_include = baseline_predictions[qid] == "INCLUDE"
        include = jev_include or deterministic_include
        chars = core.FRAGMENTS[fid]["chars"]
        total_chars += chars
        if include:
            loaded_chars += chars
        if gold:
            required += 1
            required_chars += chars
            if include:
                hit += 1
                required_loaded_chars += chars
            else:
                misses.append(qid)
        else:
            irrelevant += 1
            if not include:
                excluded += 1
            else:
                false_includes.append(qid)
    return {
        "required_pairs": required,
        "irrelevant_pairs": irrelevant,
        "required_recall": hit / required,
        "irrelevant_exclusion_rate": excluded / irrelevant,
        "context_char_reduction_vs_always": 1 - loaded_chars / total_chars,
        "required_char_recall": required_loaded_chars / required_chars,
        "missed_required": misses,
        "false_includes": false_includes,
        "loaded_chars": loaded_chars,
        "always_load_chars": total_chars,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=10)
    ap.add_argument("--batch-size", type=int, default=3)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()

    core.TASKS = HOLDOUT_TASKS
    baseline_predictions, baseline = core.baseline_metrics()
    key = core.KEY_FILE.read_text().strip()
    runs = []
    for ri in range(args.repeats):
        answers = {}
        metadata = []
        for start in range(0, len(HOLDOUT_TASKS), args.batch_size):
            batch = HOLDOUT_TASKS[start:start + args.batch_size]
            aa, mm = core.call(key, batch)
            answers.update(aa)
            metadata.append(mm)
            time.sleep(0.05)
        run = {"answers": answers, "metadata": metadata}
        run["hybrid_metrics"] = hybrid_metrics(run, baseline_predictions)
        runs.append(run)
        print(f"run {ri + 1}/{args.repeats} requests={len(metadata)}", flush=True)

    hm = [r["hybrid_metrics"] for r in runs]
    report = {
        "schema": "devspace-jev-instruction-admission-hybrid-holdout-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_requested": core.MODEL,
        "gold_labels_sent_to_model": False,
        "future_outcomes_sent_to_model": False,
        "tasks_unused_in_calibration_or_sealed_set": True,
        "architecture_fixed_before_holdout": "deterministic INCLUDE union Jev fail-safe INCLUDE",
        "confidence_floor_fixed_before_holdout": CONFIDENCE_FLOOR,
        "positive_coverage_limitations": {"BEST_MINDS": 0, "PULL_REQUESTS": 0},
        "tasks": [
            {"id": t["id"], "repo": t["repo"], "task": t["task"], "provenance": t["provenance"], "required": t["required"], "available": core.available_fragments(t)}
            for t in HOLDOUT_TASKS
        ],
        "fragments": {fid: {k: v for k, v in frag.items() if k != "text"} for fid, frag in core.FRAGMENTS.items()},
        "deterministic_baseline": baseline,
        "summary": {
            "independent_tasks": len(HOLDOUT_TASKS),
            "repeats": len(runs),
            "evaluations": sum(len(r["answers"]) for r in runs),
            "hybrid_mean": {
                key: statistics.mean(m[key] for m in hm)
                for key in ("required_recall", "irrelevant_exclusion_rate", "context_char_reduction_vs_always", "required_char_recall")
            },
            "hybrid_min_required_recall": min(m["required_recall"] for m in hm),
            "runs_with_required_miss": sum(bool(m["missed_required"]) for m in hm),
            "misses_by_run": [m["missed_required"] for m in hm],
            "raw_choice_summary": core.summarize(runs),
        },
        "raw_runs": runs,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(args.output)


if __name__ == "__main__":
    main()
