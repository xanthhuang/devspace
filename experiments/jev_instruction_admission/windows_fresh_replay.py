#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import replay as core


POLICY_PATH = Path(__file__).with_name("hybrid_policy.json")
POLICY = json.loads(POLICY_PATH.read_text())
CONFIDENCE_FLOOR = float(POLICY["confidence_floor"])
GATED = tuple(POLICY["jev_gated"])
ALWAYS = tuple(POLICY["always_load"])


# Fresh cases were selected only after hybrid_policy.json was frozen. None was
# present in the calibration or sealed DS-J1 fixtures. Windows is evidence
# source only; this replay executes on macOS against the current Mac global
# skill descriptors.
TASKS = [
    {
        "id": "WIN01",
        "task": "Compare the current browser automation executors using upstream/current capability evidence plus real Google Workspace fixtures, then record which paths actually pass or fail.",
        "provenance": "E:/AI/browser-automation-routing/docs/A-B-RESULTS-20260920.md",
        "required_gated": ["AGENT_REACH", "EGO_BROWSER"],
    },
    {
        "id": "WIN02",
        "task": "Given the completed browser A/B evidence, decide the cross-platform automation routing policy and the conditions under which agent-browser, Playwright MCP, browser harness, desktop UIA, or vision should be used. This is an architecture/design trade-off, not a single factual lookup.",
        "provenance": "E:/AI/browser-automation-routing/docs/ROUTING-AND-APPLICABILITY.md",
        "required_gated": ["BEST_MINDS"],
    },
    {
        "id": "WIN03",
        "task": "Exercise the real authenticated Google Workspace production fixtures: open Apps Script deployment management, inspect AppSheet Redux state, and read known Google Sheets cells without modifying data.",
        "provenance": "E:/AI/browser-automation-routing/docs/A-B-RESULTS-20260920.md real fixtures",
        "required_gated": ["EGO_BROWSER"],
    },
    {
        "id": "WIN05",
        "task": "From first principles, double-steelman and Occam's razor, choose the next validation plan for the current FIRE/local-knowledge experiment after the latest causal test. The task is to compare plausible experiment strategies and converge on the smallest informative next step.",
        "provenance": "Windows DevSpace historical task, 2026-09-01 FIRE next-experiment planning",
        "required_gated": ["BEST_MINDS"],
    },
    {
        "id": "WIN06",
        "task": "Evaluate the Cisco Nexus 3550 chapter-PDF representation by comparing the accepted 11-revision retrieval against one logical-manual representation while holding query expansion and other variables fixed.",
        "provenance": "E:/AI/local-ai-rag-v1/experiments/CISCO-LOGICAL-MANUAL-AB-20260901.md",
        "required_gated": [],
    },
    {
        "id": "WIN07",
        "task": "Implement deterministic evidence-window compaction inside the already-selected Local AI RAG chunks without adding model calls or changing source authority, then validate the frozen regression cases.",
        "provenance": "E:/AI/local-ai-rag-v1 git:5495218 Add deterministic evidence window compaction",
        "required_gated": [],
    },
    {
        "id": "WIN08",
        "task": "Refine Local AI RAG deterministic evidence-window coverage for the known regression while preserving exact evidence IDs, revision provenance, and the accepted retrieval architecture.",
        "provenance": "E:/AI/local-ai-rag-v1 git:0802da0 Refine deterministic evidence window coverage",
        "required_gated": [],
    },
    {
        "id": "WIN09",
        "task": "Run the Local AI RAG production-acceptance checks against the pinned accepted implementation and corpus artifacts; do not redesign retrieval or add new providers.",
        "provenance": "E:/AI/local-ai-rag-v1 git:57e85aa + production acceptance artifacts",
        "required_gated": [],
    },
    {
        "id": "WIN10",
        "task": "Qualify the FIRE cloud core lookup implementation against the frozen regression and production contract, preserving deterministic evidence/source behavior.",
        "provenance": "E:/AI/local-knowledge-agent-phase1 git:c4ebd5f feat: qualify FIRE cloud core lookup",
        "required_gated": [],
    },
    {
        "id": "WIN11",
        "task": "Freeze and document the FIRE Mac migration baseline after the accepted cloud-core release so later migration work can reproduce the exact production identity.",
        "provenance": "E:/AI/local-knowledge-agent-phase1 git:1408c14 docs: freeze FIRE Mac migration baseline",
        "required_gated": [],
    },
    {
        "id": "WIN12",
        "task": "Close the scoped RAG V2 small-model phase from the existing frozen evaluation artifacts and record the bounded conclusion; do not expand the model search beyond the declared phase.",
        "provenance": "E:/AI/rag-model-bakeoff git:c4cd1d8 experiment: close scoped RAG V2 small-model phase",
        "required_gated": [],
    },
    {
        "id": "WIN13",
        "task": "Given the completed Round-2 model bakeoff evidence, decide whether to activate the reserve model candidate, expand the search, or close the round with the current Qwen baseline. This is a strategy/trade-off decision under uncertain quality evidence.",
        "provenance": "E:/AI/rag-model-bakeoff/artifacts/ROUND2-FINAL-CLOSURE-20260823.json",
        "required_gated": ["BEST_MINDS"],
    },
    {
        "id": "WIN14",
        "task": "Build and verify the generic Windows portable DevSpace installer from the pinned source, including typecheck/tests/build, stateless MCP behavior, Scheduled Task supervision, local/public health and process-session continuation.",
        "provenance": "E:/AI/devspace-windows-portable/VALIDATION.md + git:803203a",
        "required_gated": [],
    },
    {
        "id": "WIN15",
        "task": "Implement structured Windows UIA support for native desktop controls so standard toggles and edit fields can be observed and changed without screenshot-coordinate automation.",
        "provenance": "E:/AI/desktop-harness-windows git:58682cb and 84d8ab8",
        "required_gated": [],
    },
    {
        "id": "WIN16",
        "task": "Persist the deterministic OpenChatCut Electron MCP control path and ensure browser/editor ownership does not conflict with the external MCP transport.",
        "provenance": "E:/AI/browser-automation-routing git:e862220 + docs/OPENCHATCUT-ELECTRON-MCP.md",
        "required_gated": [],
    },
    {
        "id": "WIN17",
        "task": "Secure the Playwright existing-Chrome reconnect workflow so the reconnect token is handled as a credential and can be reused without placing plaintext in Git or reports.",
        "provenance": "E:/AI/browser-automation-routing git:f4d1d37",
        "required_gated": [],
    },
    {
        "id": "WIN18",
        "task": "Fix the Local AI RAG Windows browser UI query transport and verify the user-facing query flow in the actual browser UI rather than inferring success only from the backend call.",
        "provenance": "E:/AI/local-ai-rag-v1-ui git:1f3f8bf fix Windows UI query transport",
        "required_gated": ["EGO_BROWSER"],
    },
    {
        "id": "WIN19",
        "task": "Stabilize OpenChatCut camera-media Rec.709 export rendering and verify the existing rendering/output tests; no current web research or browser interaction is requested.",
        "provenance": "E:/AI/OpenChatCut git:6b5ee3b3 fix(export): stabilize camera media Rec.709 rendering",
        "required_gated": [],
    },
    {
        "id": "WIN20",
        "task": "Harden the engineering-bridge executor termination lifecycle so interrupted controlled patch tasks terminate cleanly and preserve the bounded task contract.",
        "provenance": "E:/AI/engineering-bridge git:7e3201f fix executor termination lifecycle hangs",
        "required_gated": [],
    },
]


CHOICES = core.CHOICES


def build_payload(batch: list[dict]) -> tuple[dict, list[tuple[str, str]]]:
    state_tasks = {t["id"]: {"task": t["task"]} for t in batch}
    state_frags = {
        fid: {"descriptor": core.FRAGMENTS[fid]["descriptor"]}
        for fid in GATED
    }
    questions = {}
    pairs = []
    for t in batch:
        for fid in GATED:
            qid = f"{t['id']}__{fid}"
            questions[qid] = {
                "type": "choice",
                "instructions": (
                    f"Decide whether state.fragments.{fid} should be loaded for state.tasks.{t['id']}. "
                    "Judge only whether this optional large skill is materially required by the visible task. "
                    "Use UNCERTAIN when the task is genuinely insufficient to safely exclude it."
                ),
                "criteria": CHOICES,
            }
            pairs.append((t["id"], fid))
    return {"model": core.MODEL, "state": {"tasks": state_tasks, "fragments": state_frags}, "questions": questions}, pairs


def call(api_key: str, batch: list[dict]) -> tuple[dict, dict]:
    import urllib.request
    payload, pairs = build_payload(batch)
    req = urllib.request.Request(
        core.ENDPOINT,
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    start = time.perf_counter()
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read())
        rid = resp.headers.get("x-typesafe-request-id")
    latency = (time.perf_counter() - start) * 1000
    answers = {}
    for tid, fid in pairs:
        qid = f"{tid}__{fid}"
        a = body["answers"].get(qid, {})
        answers[qid] = {"choice": a.get("choice"), "confidence": a.get("confidence"), "probabilities": a.get("probabilities")}
    return answers, {"request_id": rid, "latency_ms": round(latency, 3), "resolved_model": body.get("model"), "usage": body.get("usage")}


def policy_include(answer: dict) -> bool:
    choice = answer.get("choice")
    confidence = answer.get("confidence")
    return choice in ("INCLUDE", "UNCERTAIN") or (
        choice == "EXCLUDE" and (not isinstance(confidence, (int, float)) or confidence < CONFIDENCE_FLOOR)
    )


def deterministic_include(task: dict, fid: str) -> bool:
    text = task["task"].lower()
    if fid == "AGENT_REACH":
        return any(x in text for x in (
            "current public", "current google", "upstream/current", "upstream evidence",
            "research the current", "verify the current", "online reports", "github repositories",
        ))
    if fid == "EGO_BROWSER":
        return any(x in text for x in (
            "real authenticated", "browser ui", "google workspace", "apps script", "appsheet",
            "google sheets", "actual browser", "logged-in browser", "browser interaction",
        ))
    if fid == "BEST_MINDS":
        return any(x in text for x in (
            "architecture/design trade-off", "strategy/trade-off", "from first principles",
            "choose the next validation plan", "decide whether to", "compare plausible experiment strategies",
        ))
    return False


def evaluate(pred: dict[str, bool]) -> dict:
    required = irrelevant = hit = excluded = 0
    missed = []
    false_includes = []
    by_skill = {fid: {"required": 0, "irrelevant": 0, "hit": 0, "excluded": 0} for fid in GATED}
    for t in TASKS:
        for fid in GATED:
            qid = f"{t['id']}__{fid}"
            gold = fid in t["required_gated"]
            include = pred[qid]
            b = by_skill[fid]
            if gold:
                required += 1; b["required"] += 1
                if include: hit += 1; b["hit"] += 1
                else: missed.append(qid)
            else:
                irrelevant += 1; b["irrelevant"] += 1
                if not include: excluded += 1; b["excluded"] += 1
                else: false_includes.append(qid)
    for fid, b in by_skill.items():
        b["required_recall"] = None if not b["required"] else b["hit"] / b["required"]
        b["irrelevant_exclusion"] = None if not b["irrelevant"] else b["excluded"] / b["irrelevant"]
    return {
        "pairs": len(TASKS) * len(GATED),
        "required_pairs": required,
        "irrelevant_pairs": irrelevant,
        "required_recall": hit / required,
        "irrelevant_exclusion_rate": excluded / irrelevant,
        "missed_required": missed,
        "false_includes": false_includes,
        "by_skill": by_skill,
    }


def hybrid_context_reduction(pred: dict[str, bool]) -> float:
    # Current cross-repo global instruction pool only. Repo-local AGENTS are not
    # part of these Windows-derived product tasks. ROUTING + SUBAGENTS are fixed
    # always-load; the three large skills are conditionally loaded.
    always_chars = sum(core.FRAGMENTS[fid]["chars"] for fid in ("ROUTING", "SUBAGENTS"))
    gated_chars = sum(core.FRAGMENTS[fid]["chars"] for fid in GATED)
    total = len(TASKS) * (always_chars + gated_chars)
    loaded = len(TASKS) * always_chars
    for t in TASKS:
        for fid in GATED:
            if pred[f"{t['id']}__{fid}"]:
                loaded += core.FRAGMENTS[fid]["chars"]
    return 1 - loaded / total


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=10)
    ap.add_argument("--batch-size", type=int, default=5)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()

    key = core.KEY_FILE.read_text().strip()
    runs = []
    for ri in range(args.repeats):
        answers = {}
        metadata = []
        for start in range(0, len(TASKS), args.batch_size):
            aa, mm = call(key, TASKS[start:start + args.batch_size])
            answers.update(aa); metadata.append(mm); time.sleep(0.05)
        pred = {qid: policy_include(a) for qid, a in answers.items()}
        runs.append({"answers": answers, "metadata": metadata, "metrics": evaluate(pred), "hybrid_context_char_reduction": hybrid_context_reduction(pred)})
        print(f"run {ri + 1}/{args.repeats} requests={len(metadata)}", flush=True)

    det_pred = {f"{t['id']}__{fid}": deterministic_include(t, fid) for t in TASKS for fid in GATED}
    det_metrics = evaluate(det_pred)
    det_metrics["hybrid_context_char_reduction"] = hybrid_context_reduction(det_pred)
    report = {
        "schema": "devspace-jev-instruction-windows-fresh-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "development_platform": "macOS",
        "windows_role": "historical evidence source only",
        "policy_sha256": core.sha256_text(POLICY_PATH.read_text()),
        "policy": POLICY,
        "model_requested": core.MODEL,
        "gold_labels_sent_to_model": False,
        "fresh_cases_not_used_in_prior_ds_j1": True,
        "tasks": TASKS,
        "deterministic_baseline": det_metrics,
        "summary": {
            "independent_tasks": len(TASKS),
            "required_gated_pairs": sum(len(t["required_gated"]) for t in TASKS),
            "repeats": len(runs),
            "evaluations": sum(len(r["answers"]) for r in runs),
            "mean_required_recall": statistics.mean(r["metrics"]["required_recall"] for r in runs),
            "min_required_recall": min(r["metrics"]["required_recall"] for r in runs),
            "mean_irrelevant_exclusion": statistics.mean(r["metrics"]["irrelevant_exclusion_rate"] for r in runs),
            "mean_hybrid_context_char_reduction": statistics.mean(r["hybrid_context_char_reduction"] for r in runs),
            "runs_with_required_miss": sum(bool(r["metrics"]["missed_required"]) for r in runs),
            "misses_by_run": [r["metrics"]["missed_required"] for r in runs],
            "by_skill_mean": {
                fid: {
                    "required_cases": sum(fid in t["required_gated"] for t in TASKS),
                    "required_recall": statistics.mean(r["metrics"]["by_skill"][fid]["required_recall"] for r in runs) if any(fid in t["required_gated"] for t in TASKS) else None,
                    "irrelevant_exclusion": statistics.mean(r["metrics"]["by_skill"][fid]["irrelevant_exclusion"] for r in runs),
                }
                for fid in GATED
            },
        },
        "raw_runs": runs,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(args.output)


if __name__ == "__main__":
    main()
