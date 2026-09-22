#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import statistics
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENDPOINT = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.13.0"
KEY_FILE = Path.home() / ".config/typesafe/api_key"
ROOT = Path(__file__).resolve().parents[2]


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def approx_tokens(text: str) -> int:
    # Only used as a stable local size proxy for context savings. It is not
    # presented as provider token accounting.
    return math.ceil(len(text) / 4)


def section(text: str, heading: str) -> str:
    marker = f"## {heading}"
    start = text.index(marker)
    rest = text[start:]
    m = re.search(r"\n## ", rest[len(marker):])
    end = len(rest) if not m else len(marker) + m.start()
    return rest[:end].strip() + "\n"


def read_optional(path: Path) -> str:
    try:
        return path.read_text()
    except FileNotFoundError:
        return ""


AGENTS = (ROOT / "AGENTS.md").read_text()

GLOBAL_FRAGMENT_SOURCES = {
    "ROUTING": read_optional(Path.home() / ".agents/skills/devspace-agent-routing/SKILL.md"),
    "AGENT_REACH": read_optional(Path.home() / ".agents/skills/agent-reach/SKILL.md"),
    "EGO_BROWSER": read_optional(Path.home() / ".agents/skills/ego-browser/SKILL.md"),
    "SUBAGENTS": (ROOT / "skills/subagents/SKILL.md").read_text(),
    "BEST_MINDS": read_optional(Path.home() / ".codex/skills/best-minds/SKILL.md"),
}

FRAGMENTS = {
    "ROUTING": {
        "scope": "global",
        "descriptor": "DevSpace engineering agent-routing policy: Host handles deterministic investigation/verification, Codex implements bounded known contracts, Claude resolves ambiguous architecture/root cause, independent review is exceptional and bounded.",
        "source": "~/.agents/skills/devspace-agent-routing/SKILL.md",
        "text": GLOBAL_FRAGMENT_SOURCES["ROUTING"],
    },
    "AGENT_REACH": {
        "scope": "global",
        "descriptor": "Internet research/router skill. Required for current web research, URLs, GitHub/code search, Twitter/social platforms and source-level web verification; selects the appropriate read-only backend.",
        "source": "~/.agents/skills/agent-reach/SKILL.md",
        "text": GLOBAL_FRAGMENT_SOURCES["AGENT_REACH"],
    },
    "EGO_BROWSER": {
        "scope": "global",
        "descriptor": "Browser-operation skill for opening/operating websites, logged-in flows, forms, web-app testing, browser QA and bug investigation; prefers the user's persistent Ego browser session.",
        "source": "~/.agents/skills/ego-browser/SKILL.md",
        "text": GLOBAL_FRAGMENT_SOURCES["EGO_BROWSER"],
    },
    "SUBAGENTS": {
        "scope": "global",
        "descriptor": "DevSpace subagent delegation instructions: choose an agent target, give a self-contained bounded brief, inspect/continue the worker, and use delegation for focused implementation/research/review/verification.",
        "source": "skills/subagents/SKILL.md",
        "text": GLOBAL_FRAGMENT_SOURCES["SUBAGENTS"],
    },
    "BEST_MINDS": {
        "scope": "global",
        "descriptor": "Expert-panel simulation skill for genuinely open-ended judgment, design trade-offs, strategy, or questions asking who in the world would best explore a problem.",
        "source": "~/.codex/skills/best-minds/SKILL.md",
        "text": GLOBAL_FRAGMENT_SOURCES["BEST_MINDS"],
    },
    "SECURITY": {
        "scope": "devspace_repo",
        "descriptor": "DevSpace AGENTS Security boundaries: local filesystem/shell authority, path validation, credentials, destructive operations, process replacement, and user-owned tunnel boundaries must remain explicit.",
        "source": "AGENTS.md#Security boundaries",
        "text": section(AGENTS, "Security boundaries"),
    },
    "DIAGNOSE_LAYER": {
        "scope": "devspace_repo",
        "descriptor": "DevSpace AGENTS Diagnose the correct layer: preserve the original error and identify whether failure belongs to host, MCP transport, DevSpace, adapter, provider, model, tool, or target project before changing code.",
        "source": "AGENTS.md#Diagnose the correct layer",
        "text": section(AGENTS, "Diagnose the correct layer"),
    },
    "VERIFY_REAL_PATH": {
        "scope": "devspace_repo",
        "descriptor": "DevSpace AGENTS Verify the real path: verify how the user actually consumes a change across source vs package, real MCP host, restart boundaries, platform/tool modes, and rendered UI/artifacts rather than relying on a narrow proxy.",
        "source": "AGENTS.md#Verify the real path",
        "text": section(AGENTS, "Verify the real path"),
    },
    "TRACE_CONTRACTS": {
        "scope": "devspace_repo",
        "descriptor": "DevSpace AGENTS Trace affected contracts: for cross-cutting concepts check the actual MCP schema/handler, workspace/instructions, roots, lifecycle, tool surfaces, artifacts/widgets, persistence/migrations, entry points and docs without speculative edits.",
        "source": "AGENTS.md#Trace affected contracts",
        "text": section(AGENTS, "Trace affected contracts"),
    },
    "PULL_REQUESTS": {
        "scope": "devspace_repo",
        "descriptor": "DevSpace AGENTS Pull requests: only create/update a PR when explicitly asked, read CONTRIBUTING first, keep it focused, and include appropriate verification or UI evidence.",
        "source": "AGENTS.md#Pull requests",
        "text": section(AGENTS, "Pull requests"),
    },
}

for frag in FRAGMENTS.values():
    frag["chars"] = len(frag["text"])
    frag["approx_tokens"] = approx_tokens(frag["text"])
    frag["sha256"] = sha256_text(frag["text"])


TASKS = [
    {
        "id": "DVS01",
        "repo": "xanthhuang/devspace",
        "task": "Fix and harden OAuth refresh observability across the OAuth provider/store and server configuration, with regression coverage.",
        "provenance": "git:c11cdc6 fix: harden oauth refresh observability",
        "required": ["ROUTING", "SECURITY", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "DVS02",
        "repo": "xanthhuang/devspace",
        "task": "Fix OAuth discovery by exposing protected-resource metadata at the root URL as required by the real MCP client path, with a regression test.",
        "provenance": "git:64bd87e fix: expose root OAuth protected-resource metadata",
        "required": ["ROUTING", "SECURITY", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH"],
    },
    {
        "id": "DVS03",
        "repo": "xanthhuang/devspace",
        "task": "Harden the stateless MCP production runtime across callbacks, local-agent lifecycle, durable state, OAuth/store behavior, server handling and tests.",
        "provenance": "git:a90349f feat: harden stateless MCP production runtime",
        "required": ["ROUTING", "SECURITY", "DIAGNOSE_LAYER", "VERIFY_REAL_PATH", "TRACE_CONTRACTS"],
    },
    {
        "id": "DVS04",
        "repo": "xanthhuang/devspace",
        "task": "Replay the Jev completion-verifier idea against frozen historical DevSpace DONE checkpoints and record whether it independently detects incomplete work.",
        "provenance": "git:9af3032 experiment: replay Jev completion verifier",
        "required": ["ROUTING"],
    },
    {
        "id": "DVS05",
        "repo": "xanthhuang/devspace",
        "task": "Replay a Jev classifier over real historical DevSpace tool/runtime failures, preserving observed error evidence and comparing against a deterministic recovery baseline.",
        "provenance": "git:43e0bdc experiment: replay Jev post-tool classifier",
        "required": ["ROUTING", "DIAGNOSE_LAYER"],
    },
    {
        "id": "DEP01",
        "repo": "xanthhuang/devspace-macos-deployment",
        "task": "Build a generic portable macOS installer for a pinned DevSpace source, with reproducible verification and no machine-specific credentials or host state.",
        "provenance": "git:098a7ac feat: generic DevSpace macOS portable installer",
        "required": ["ROUTING"],
    },
    {
        "id": "DEP02",
        "repo": "xanthhuang/devspace-macos-deployment",
        "task": "Fix LaunchAgent reload behavior so DevSpace deployment remains robust when installation is performed over SSH.",
        "provenance": "git:3902e51 fix: make LaunchAgent reload robust over SSH",
        "required": ["ROUTING"],
    },
    {
        "id": "DEP03",
        "repo": "xanthhuang/devspace-macos-deployment",
        "task": "Harden deployment of the OAuth-capable DevSpace runtime by pinning the correct source and adding deployment verification.",
        "provenance": "git:438cf65 fix: harden OAuth runtime deployment",
        "required": ["ROUTING"],
    },
    {
        "id": "DEP04",
        "repo": "xanthhuang/devspace-macos-deployment",
        "task": "Enforce a single active DevSpace CLI entrypoint so the shell command cannot silently diverge from the active MCP runtime.",
        "provenance": "git:e9948e2 fix: enforce single DevSpace CLI entrypoint",
        "required": ["ROUTING"],
    },
    {
        "id": "DEP05",
        "repo": "xanthhuang/devspace-macos-deployment",
        "task": "Qualify the Cloudflare-backed DevSpace connector through the real ChatGPT MCP path, including workspace open/read, short and long commands, process continuation, and controlled restart behavior.",
        "provenance": "docs/DEVSPACE-CLOUDFLARE-CANARY-20260917.md + git:8bf2b19",
        "required": ["ROUTING"],
    },
    {
        "id": "DEP06",
        "repo": "xanthhuang/devspace-macos-deployment",
        "task": "Compare the pinned production stateless-MCP implementation with the then-current upstream implementation and record when pure upstream versus a bounded patch should be reconsidered.",
        "provenance": "docs/STATELESS-MCP-UPSTREAM-COMPARISON-20260916.md + git:dcbf979",
        "required": ["ROUTING", "AGENT_REACH"],
    },
    {
        "id": "DEP07",
        "repo": "xanthhuang/devspace-macos-deployment",
        "task": "Add the global DevSpace Host/Codex/Claude agent-routing policy and bounded reviewer profiles to the portable deployment, including installer and verification support.",
        "provenance": "git:c649a6e feat: add global DevSpace agent routing",
        "required": ["ROUTING"],
    },
    {
        "id": "HIST01",
        "repo": "159-operations-system",
        "task": "Investigate the real web-app invoice/PDF generation flow in the logged-in browser, remove an incorrect draft-only restriction, and verify the actual UI workflow using the correct browser routing.",
        "provenance": "conversation:2026-09-21 159 billing/PDF browser verification",
        "required": ["ROUTING", "EGO_BROWSER"],
    },
    {
        "id": "HIST02",
        "repo": "research-only",
        "task": "Research current Jev claims from a public Google Doc and linked GitHub repositories, read the source material, and evaluate which ideas are genuinely useful rather than repeating README claims.",
        "provenance": "conversation:2026-09-22 Jev Google Doc/repository evaluation",
        "required": ["AGENT_REACH"],
    },
    {
        "id": "HIST03",
        "repo": "xanthhuang/personal-content-distiller",
        "task": "Run Claude Code and Codex concurrently as bounded independent architecture reviewers using minimal facts, then collect their reports without letting either redesign the project scope.",
        "provenance": "conversation:2026-09-20 PKD external architecture review",
        "required": ["ROUTING", "SUBAGENTS"],
    },
    {
        "id": "HIST04",
        "repo": "xanthhuang/personal-content-distiller",
        "task": "Continue PKD from its handover in the existing worktree: verify branch, HEAD and working tree, then execute the already-bounded Phase 3 work without reopening settled Phase 2.",
        "provenance": "conversation:2026-09-20 PKD Phase3 handover continuation",
        "required": ["ROUTING"],
    },
]


def available_fragments(task: dict) -> list[str]:
    out = [fid for fid, f in FRAGMENTS.items() if f["scope"] == "global"]
    if task["repo"] == "xanthhuang/devspace":
        out.extend(fid for fid, f in FRAGMENTS.items() if f["scope"] == "devspace_repo")
    return out


CHOICES = {
    "INCLUDE": "This instruction is materially required to execute the task safely/correctly; omitting it creates a real workflow, tool, verification, or boundary risk.",
    "UNCERTAIN": "The task description does not provide enough evidence to safely exclude this instruction; include it fail-safe.",
    "EXCLUDE": "This instruction is not materially needed for this task; omitting it should not change correct execution.",
}


def build_batch(batch: list[dict]) -> tuple[dict, list[tuple[str, str]]]:
    state_tasks = {t["id"]: {"repo": t["repo"], "task": t["task"]} for t in batch}
    frag_ids = sorted({fid for t in batch for fid in available_fragments(t)})
    state_frags = {
        fid: {
            "scope": FRAGMENTS[fid]["scope"],
            "descriptor": FRAGMENTS[fid]["descriptor"],
        }
        for fid in frag_ids
    }
    questions = {}
    pairs = []
    for t in batch:
        for fid in available_fragments(t):
            qid = f"{t['id']}__{fid}"
            questions[qid] = {
                "type": "choice",
                "instructions": (
                    f"Decide whether state.fragments.{fid} should be loaded for state.tasks.{t['id']}. "
                    "Judge only task relevance. Do not assume other hidden instructions. "
                    "Use UNCERTAIN only when the visible task is genuinely insufficient to safely exclude the fragment."
                ),
                "criteria": CHOICES,
            }
            pairs.append((t["id"], fid))
    payload = {
        "model": MODEL,
        "state": {"tasks": state_tasks, "fragments": state_frags},
        "questions": questions,
    }
    return payload, pairs


def call(api_key: str, batch: list[dict]) -> tuple[dict, dict]:
    payload, pairs = build_batch(batch)
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    start = time.perf_counter()
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read())
        request_id = resp.headers.get("x-typesafe-request-id")
    latency = (time.perf_counter() - start) * 1000
    answers = {}
    for tid, fid in pairs:
        qid = f"{tid}__{fid}"
        a = body["answers"].get(qid, {})
        answers[qid] = {
            "choice": a.get("choice"),
            "confidence": a.get("confidence"),
            "probabilities": a.get("probabilities"),
        }
    meta = {
        "request_id": request_id,
        "latency_ms": round(latency, 3),
        "resolved_model": body.get("model"),
        "usage": body.get("usage"),
    }
    return answers, meta


def expected(task: dict, fid: str) -> bool:
    return fid in task["required"]


def deterministic_baseline(task: dict, fid: str) -> bool:
    text = f"{task['repo']} {task['task']}".lower()
    if fid == "ROUTING":
        return task["repo"] != "research-only"
    if fid == "AGENT_REACH":
        return any(x in text for x in ("upstream", "public google doc", "github repositories", "research current", "twitter", "web search", "url"))
    if fid == "EGO_BROWSER":
        return any(x in text for x in ("logged-in browser", "web-app", "actual ui", "browser routing"))
    if fid == "SUBAGENTS":
        return any(x in text for x in ("claude code", "codex", "subagent", "independent architecture reviewer"))
    if fid == "BEST_MINDS":
        return any(x in text for x in ("open-ended strategy", "trade-off panel", "best minds", "world-class experts"))
    if task["repo"] != "xanthhuang/devspace":
        return False
    if fid == "SECURITY":
        return any(x in text for x in ("oauth", "credential", "token", "tunnel", "destructive", "permission"))
    if fid == "DIAGNOSE_LAYER":
        return any(x in text for x in ("fix", "failure", "error", "runtime failures", "discovery"))
    if fid == "VERIFY_REAL_PATH":
        return any(x in text for x in ("oauth", "mcp", "production runtime", "real mcp client", "packaged", "browser", "deployment"))
    if fid == "TRACE_CONTRACTS":
        return any(x in text for x in ("across", "production runtime", "provider/store", "callbacks", "durable state"))
    if fid == "PULL_REQUESTS":
        return "pull request" in text or re.search(r"\bpr\b", text) is not None
    return False


def metrics(predictions: dict[str, str]) -> dict:
    rows = []
    for task in TASKS:
        for fid in available_fragments(task):
            qid = f"{task['id']}__{fid}"
            gold = expected(task, fid)
            choice = predictions[qid]
            raw_include = choice == "INCLUDE"
            safe_include = choice in ("INCLUDE", "UNCERTAIN")
            rows.append((task, fid, gold, choice, raw_include, safe_include))

    required = [r for r in rows if r[2]]
    irrelevant = [r for r in rows if not r[2]]
    raw_required_recall = sum(r[4] for r in required) / len(required)
    safe_required_recall = sum(r[5] for r in required) / len(required)
    raw_irrelevant_exclusion = sum(not r[4] for r in irrelevant) / len(irrelevant)
    safe_irrelevant_exclusion = sum(not r[5] for r in irrelevant) / len(irrelevant)

    total_chars = sum(FRAGMENTS[fid]["chars"] for task in TASKS for fid in available_fragments(task))
    safe_loaded_chars = sum(FRAGMENTS[fid]["chars"] for _, fid, _, _, _, inc in rows if inc)
    raw_loaded_chars = sum(FRAGMENTS[fid]["chars"] for _, fid, _, _, inc, _ in rows if inc)
    required_chars = sum(FRAGMENTS[fid]["chars"] for _, fid, gold, _, _, _ in rows if gold)
    safe_required_chars_loaded = sum(FRAGMENTS[fid]["chars"] for _, fid, gold, _, _, inc in rows if gold and inc)

    return {
        "pairs": len(rows),
        "required_pairs": len(required),
        "irrelevant_pairs": len(irrelevant),
        "raw_required_recall": raw_required_recall,
        "fail_safe_required_recall": safe_required_recall,
        "raw_irrelevant_exclusion_rate": raw_irrelevant_exclusion,
        "fail_safe_irrelevant_exclusion_rate": safe_irrelevant_exclusion,
        "uncertain_pairs": sum(r[3] == "UNCERTAIN" for r in rows),
        "always_load_chars": total_chars,
        "gold_minimum_required_chars": required_chars,
        "raw_loaded_chars": raw_loaded_chars,
        "fail_safe_loaded_chars": safe_loaded_chars,
        "raw_context_char_reduction_vs_always": 1 - raw_loaded_chars / total_chars,
        "fail_safe_context_char_reduction_vs_always": 1 - safe_loaded_chars / total_chars,
        "fail_safe_required_char_recall": safe_required_chars_loaded / required_chars,
        "missed_required": [f"{t['id']}__{fid}" for t, fid, gold, _, _, inc in rows if gold and not inc],
        "safe_false_includes": [f"{t['id']}__{fid}" for t, fid, gold, _, _, inc in rows if not gold and inc],
    }


def baseline_metrics() -> tuple[dict, dict]:
    predictions = {}
    for task in TASKS:
        for fid in available_fragments(task):
            qid = f"{task['id']}__{fid}"
            predictions[qid] = "INCLUDE" if deterministic_baseline(task, fid) else "EXCLUDE"
    return predictions, metrics(predictions)


def summarize(runs: list[dict]) -> dict:
    by_run = []
    vote_map: dict[str, list[str]] = {}
    confidences: dict[str, list[float]] = {}
    for run in runs:
        predictions = {qid: a["choice"] for qid, a in run["answers"].items()}
        by_run.append(metrics(predictions))
        for qid, a in run["answers"].items():
            vote_map.setdefault(qid, []).append(a["choice"])
            if isinstance(a.get("confidence"), (int, float)):
                confidences.setdefault(qid, []).append(float(a["confidence"]))

    aggregate = {}
    for qid, choices in vote_map.items():
        aggregate[qid] = {
            "counts": {choice: choices.count(choice) for choice in CHOICES},
            "confidence_mean": statistics.mean(confidences.get(qid, [])) if confidences.get(qid) else None,
            "confidence_min": min(confidences.get(qid, [])) if confidences.get(qid) else None,
            "confidence_max": max(confidences.get(qid, [])) if confidences.get(qid) else None,
        }
    _, baseline = baseline_metrics()
    return {
        "independent_tasks": len(TASKS),
        "repeats": len(runs),
        "evaluations": sum(m["pairs"] for m in by_run),
        "per_run": by_run,
        "mean": {
            key: statistics.mean(m[key] for m in by_run)
            for key in (
                "raw_required_recall",
                "fail_safe_required_recall",
                "raw_irrelevant_exclusion_rate",
                "fail_safe_irrelevant_exclusion_rate",
                "raw_context_char_reduction_vs_always",
                "fail_safe_context_char_reduction_vs_always",
                "uncertain_pairs",
            )
        },
        "pair_stability": aggregate,
        "deterministic_baseline": baseline,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=10)
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()

    missing = [fid for fid, f in FRAGMENTS.items() if not f["text"]]
    if missing:
        raise SystemExit(f"Missing instruction sources: {missing}")

    key = KEY_FILE.read_text().strip()
    runs = []
    for ri in range(args.repeats):
        answers = {}
        metadata = []
        for start in range(0, len(TASKS), args.batch_size):
            batch = TASKS[start:start + args.batch_size]
            aa, mm = call(key, batch)
            answers.update(aa)
            metadata.append(mm)
            time.sleep(0.05)
        runs.append({"answers": answers, "metadata": metadata})
        print(f"run {ri + 1}/{args.repeats} requests={len(metadata)}", flush=True)

    _, baseline = baseline_metrics()
    report = {
        "schema": "devspace-jev-instruction-admission-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_requested": MODEL,
        "gold_labels_sent_to_model": False,
        "future_outcomes_sent_to_model": False,
        "size_metric": "UTF-8/Python character count; approx_tokens=ceil(chars/4), not provider tokenizer",
        "fragments": {
            fid: {k: v for k, v in frag.items() if k != "text"}
            for fid, frag in FRAGMENTS.items()
        },
        "tasks": [
            {"id": t["id"], "repo": t["repo"], "task": t["task"], "provenance": t["provenance"], "required": t["required"], "available": available_fragments(t)}
            for t in TASKS
        ],
        "deterministic_baseline": baseline,
        "summary": summarize(runs),
        "raw_runs": runs,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(args.output)


if __name__ == "__main__":
    main()
