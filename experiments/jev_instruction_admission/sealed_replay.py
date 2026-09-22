#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import replay as core


# Fixed before the sealed run. This was selected from the separate 3-repeat
# calibration set as the first confidence floor that achieved 100% required
# recall. It must not be changed based on the results below.
CONFIDENCE_FLOOR = 0.30


SEALED_TASKS = [
    {
        "id": "VAL01",
        "repo": "xanthhuang/devspace",
        "task": "Fix workspace instruction loading so approved global instruction symlink targets can be followed without breaking path-boundary semantics, with regression coverage.",
        "provenance": "git:982415d fix(workspace): allow global instruction symlink targets",
        "required": ["ROUTING", "SECURITY", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "VAL02",
        "repo": "xanthhuang/devspace",
        "task": "Refactor workspace startup so initial instruction sources are explicitly classified rather than implicitly mixed together.",
        "provenance": "git:4fc6d34 refactor(workspace): classify initial instruction sources",
        "required": ["ROUTING", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "VAL03",
        "repo": "xanthhuang/devspace",
        "task": "Fix unbounded in-memory workspace caching across server/workspace/skill behavior and add coverage for bounded cache lifecycle.",
        "provenance": "git:5d2cfda fix(workspace): bound in-memory workspace cache",
        "required": ["ROUTING", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "VAL04",
        "repo": "xanthhuang/devspace",
        "task": "Fix the MCP server so handler failures are logged at the correct boundary and the stateless compatibility fallback is pinned rather than silently changing behavior.",
        "provenance": "git:57518e2 fix(mcp): log handler failures and pin stateless fallback",
        "required": ["ROUTING", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "VAL05",
        "repo": "xanthhuang/devspace",
        "task": "Fix server shutdown so active MCP tool work is drained before process teardown, with lifecycle regression tests.",
        "provenance": "git:3926336 fix(server): drain active MCP tool work on shutdown",
        "required": ["ROUTING", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "VAL06",
        "repo": "xanthhuang/devspace",
        "task": "Refactor legacy MCP client handling to a stateless compatibility path while preserving the externally supported server behavior.",
        "provenance": "git:cf2d4d7 refactor(mcp): serve legacy clients statelessly",
        "required": ["ROUTING", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "VAL07",
        "repo": "xanthhuang/devspace",
        "task": "Fix the Claude local-agent adapter so restricted agents receive only the intended local authority instead of broader command/filesystem permissions.",
        "provenance": "git:38e3c70 fix(claude): scope restricted agent authority",
        "required": ["ROUTING", "SECURITY", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH"],
    },
    {
        "id": "VAL08",
        "repo": "xanthhuang/devspace",
        "task": "Fix the OpenCode provider runtime so DevSpace waits for the remote session to actually complete instead of returning before completion.",
        "provenance": "git:3e4fa10 fix(opencode): wait for session completion",
        "required": ["ROUTING", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH"],
    },
    {
        "id": "VAL09",
        "repo": "xanthhuang/devspace",
        "task": "Fix local-agent error handling so nested transport failures are classified by their real underlying transport cause rather than flattened into a generic provider failure.",
        "provenance": "git:f2d5d60 fix(agents): classify nested transport failures",
        "required": ["ROUTING", "DIAGNOSE_LAYER"],
    },
    {
        "id": "VAL10",
        "repo": "xanthhuang/devspace",
        "task": "Fix provider adapters so provider execution failures preserve their semantics consistently across Claude, Codex, OpenCode, Pi and ACP runtimes.",
        "provenance": "git:0efe117 fix(agents): preserve provider failure semantics",
        "required": ["ROUTING", "DIAGNOSE_LAYER", "TRACE_CONTRACTS"],
    },
    {
        "id": "VAL11",
        "repo": "xanthhuang/devspace",
        "task": "Fix configuration initialization so an existing user-controlled tunnel URL is preserved rather than overwritten during init.",
        "provenance": "git:d1ae286 fix(config): preserve tunnel URL during init",
        "required": ["ROUTING", "SECURITY", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH"],
    },
    {
        "id": "VAL12",
        "repo": "xanthhuang/devspace",
        "task": "Implement a one-time migration from legacy JSON configuration into the current versioned user configuration model across CLI/config/client surfaces and tests.",
        "provenance": "git:7743f32 feat(config): migrate legacy JSON once",
        "required": ["ROUTING", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "VAL13",
        "repo": "video-color-workflow",
        "task": "Search current online reports for the same 10-fps export behavior seen in the real DJI/FFmpeg pipeline, verify likely causes from source material, then return to the bounded output bug.",
        "provenance": "conversation:2026-09-20 DJI export 10fps web investigation",
        "required": ["ROUTING", "AGENT_REACH"],
    },
    {
        "id": "VAL14",
        "repo": "xanthhuang/personal-content-distiller",
        "task": "Use the logged-in browser to inspect the real PKD scorer UI where later AI interpretation/follow-up text is not Traditional Chinese, reproduce the product flow, then implement and verify the correction.",
        "provenance": "conversation:2026-09-17 PKD scorer browser/UI language defect",
        "required": ["ROUTING", "EGO_BROWSER"],
    },
    {
        "id": "VAL15",
        "repo": "xanthhuang/personal-content-distiller",
        "task": "Delegate two bounded independent architecture reviews to Claude Code and Codex, provide only the current architecture and objective, and collect their reports before Host decides whether any finding is actionable.",
        "provenance": "conversation:2026-09-13 WikiSkill/PKD independent architecture review",
        "required": ["ROUTING", "SUBAGENTS"],
    },
]


def policy_metrics(run: dict) -> dict:
    task_map = {t["id"]: t for t in SEALED_TASKS}
    required = irrelevant = hit = excluded = 0
    total_chars = loaded_chars = required_chars = required_loaded_chars = 0
    misses = []
    false_includes = []
    for qid, answer in run["answers"].items():
        tid, fid = qid.split("__", 1)
        task = task_map[tid]
        gold = fid in task["required"]
        confidence = answer.get("confidence")
        include = answer.get("choice") in ("INCLUDE", "UNCERTAIN")
        if answer.get("choice") == "EXCLUDE" and (
            not isinstance(confidence, (int, float)) or confidence < CONFIDENCE_FLOOR
        ):
            include = True
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

    # Swap only the task fixture; all model-facing formulation and deterministic
    # baseline code remains the same as calibration.
    core.TASKS = SEALED_TASKS
    key = core.KEY_FILE.read_text().strip()
    runs = []
    for ri in range(args.repeats):
        answers = {}
        metadata = []
        for start in range(0, len(SEALED_TASKS), args.batch_size):
            batch = SEALED_TASKS[start:start + args.batch_size]
            aa, mm = core.call(key, batch)
            answers.update(aa)
            metadata.append(mm)
            time.sleep(0.05)
        run = {"answers": answers, "metadata": metadata}
        run["fixed_policy_metrics"] = policy_metrics(run)
        runs.append(run)
        print(f"run {ri + 1}/{args.repeats} requests={len(metadata)}", flush=True)

    _, baseline = core.baseline_metrics()
    policy = [r["fixed_policy_metrics"] for r in runs]
    report = {
        "schema": "devspace-jev-instruction-admission-sealed-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_requested": core.MODEL,
        "gold_labels_sent_to_model": False,
        "future_outcomes_sent_to_model": False,
        "sealed_tasks_not_used_in_calibration": True,
        "confidence_floor_fixed_before_sealed_run": CONFIDENCE_FLOOR,
        "confidence_floor_rule": "INCLUDE or UNCERTAIN => load; EXCLUDE with confidence < floor => load fail-safe",
        "positive_coverage_limitations": {
            "BEST_MINDS": 0,
            "PULL_REQUESTS": 0,
        },
        "fragments": {
            fid: {k: v for k, v in frag.items() if k != "text"}
            for fid, frag in core.FRAGMENTS.items()
        },
        "tasks": [
            {"id": t["id"], "repo": t["repo"], "task": t["task"], "provenance": t["provenance"], "required": t["required"], "available": core.available_fragments(t)}
            for t in SEALED_TASKS
        ],
        "deterministic_baseline": baseline,
        "summary": {
            "independent_tasks": len(SEALED_TASKS),
            "repeats": len(runs),
            "evaluations": sum(len(r["answers"]) for r in runs),
            "fixed_policy_mean": {
                key: statistics.mean(m[key] for m in policy)
                for key in ("required_recall", "irrelevant_exclusion_rate", "context_char_reduction_vs_always", "required_char_recall")
            },
            "fixed_policy_min_required_recall": min(m["required_recall"] for m in policy),
            "runs_with_required_miss": sum(bool(m["missed_required"]) for m in policy),
            "misses_by_run": [m["missed_required"] for m in policy],
            "raw_choice_summary": core.summarize(runs),
        },
        "raw_runs": runs,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(args.output)


if __name__ == "__main__":
    main()
