# DS-J1 — Jev Conditional Instruction Admission — 2026-09-22

## Status

```text
fixed Jev-only admission:          HOLD / not safe enough
broad deterministic + Jev hybrid: historical capability PASS
simplified optional-skill gate:    deterministic Host baseline wins
Jev production integration:        NO-GO at current skill scale
production context gating:         NOT AUTHORIZED
```

This experiment was performed only after checking
`/Users/xanth/Github/project-registry`. It uses the canonical macOS DevSpace
source checkout, does not modify production routing/runtime, and does not
interfere with the ongoing product-repository convergence. The final Stage D
uses Windows DevSpace repositories only as **read-only historical evidence**;
all experiment code and Jev calls still run on macOS.

The purpose was to test the TypeSafe design-note hypothesis that bounded
System-One decisions can reduce instruction/context load while leaving explicit
Host authority intact.

## 1. Question

Given a real task and a small set of available instruction-fragment descriptors,
can Jev decide which instructions should be loaded without dropping anything
materially required for correct execution?

The first experiment intentionally tests only:

```text
task + instruction descriptor
    -> INCLUDE / UNCERTAIN / EXCLUDE
```

It does **not** test:

- summary generation;
- irreversible context deletion;
- production worker context mutation;
- JevHarness optimization;
- model routing.

`UNCERTAIN` is fail-safe and means load the instruction.

## 2. Candidate instruction pool

Global skills:

```text
ROUTING       DevSpace Host/Codex/Claude routing policy
AGENT_REACH   internet / URL / GitHub / social research routing
EGO_BROWSER   real logged-in browser / web-app QA operations
SUBAGENTS     bounded DevSpace subagent delegation
BEST_MINDS    open-ended expert-panel reasoning
```

Repo-local `xanthhuang/devspace` `AGENTS.md` fragments:

```text
SECURITY
DIAGNOSE_LAYER
VERIFY_REAL_PATH
TRACE_CONTRACTS
PULL_REQUESTS
```

Repo-local fragments are candidates only when the historical task's workspace is
`xanthhuang/devspace`; they are not offered to unrelated product workspaces.

The always-visible model input contains only a short descriptor for each
candidate. The full instruction text is counted as context cost only if the
fragment would be admitted.

Fragment content hashes and sizes are frozen in each machine result.

## 3. Gold construction

All tasks are real historical work:

- Git commits from `xanthhuang/devspace`;
- Git commits/docs from `xanthhuang/devspace-macos-deployment`;
- a small number of real prior DevSpace browser/web/subagent workflows where
  global-skill positive coverage was needed.

Gold means:

> Omitting this fragment creates a material workflow, tool-selection,
> verification, authority, or contract risk for the stated task.

Gold labels and provenance are evaluation metadata only and were not sent to
Jev.

The labels are human/Host semantic judgments rather than automatically derived
truth. This is a limitation and is one reason the result authorizes shadow
validation rather than production gating.

## 4. Deterministic baseline

A deliberately small Host baseline uses task/repo keywords and known hard
triggers, e.g.:

```text
browser/web-app wording       -> EGO_BROWSER
current web/upstream research -> AGENT_REACH
Claude/Codex delegation       -> SUBAGENTS
OAuth/tunnel terms            -> SECURITY candidate
fix/error/failure terms       -> DIAGNOSE_LAYER candidate
```

It is intentionally not expanded into a hand-maintained ontology after seeing
test failures. Its purpose is to answer whether Jev adds semantic recall beyond
cheap rules.

## 5. Stage A — calibration pilot

Artifact:

```text
experiments/jev_instruction_admission/pilot-20260922.json
```

Dataset:

```text
16 independent tasks
105 task-fragment pairs per repeat
3 repeats
```

Initial Jev result:

```text
raw required recall:                  ~95.7%
fail-safe recall using UNCERTAIN:      ~95.7%
irrelevant exclusion:                 ~62.6% fail-safe
instruction-char reduction:           ~61.9% fail-safe
```

The important observation was that Jev rarely used the explicit `UNCERTAIN`
choice. Instead, ambiguity often appeared as a low-confidence INCLUDE or
EXCLUDE.

Post-hoc calibration scan:

```text
confidence floor  required recall  irrelevant exclusion  char reduction
0.0               95.7%            62.6%                 61.9%
0.2               98.9%            52.7%                 56.4%
0.3              100.0%            48.2%                 52.0%
0.4              100.0%            44.1%                 48.6%
```

`0.30` was frozen as the first floor reaching 100% required recall on the
calibration set:

```text
INCLUDE or UNCERTAIN                 -> load
EXCLUDE with confidence < 0.30       -> load fail-safe
EXCLUDE with confidence >= 0.30      -> skip
```

The calibration set was then considered consumed for threshold selection.

## 6. Stage B — fresh sealed Jev-only validation

Artifact:

```text
experiments/jev_instruction_admission/sealed-result-20260922.json
```

Dataset:

```text
15 independent tasks never used in calibration
135 pairs per repeat
10 repeats
1,350 decisions
```

The `0.30` floor was fixed before this run and was not changed afterward.

### Deterministic baseline on this set

```text
required recall:             70.8%
irrelevant exclusion:        97.7%
instruction-char reduction:  77.9%
```

This demonstrates the intended problem: cheap rules are precise but miss many
semantically required repo-local instructions.

### Jev-only fixed policy

```text
required recall:              97.9%
required-char recall:         99.63%
irrelevant exclusion:         66.7%
instruction-char reduction:   70.9%
runs with required miss:      10 / 10
```

Every run missed the same required pair:

```text
VAL11__DIAGNOSE_LAYER
```

The task was the historical fix preserving a user-controlled tunnel URL during
configuration initialization. Jev consistently chose EXCLUDE for the diagnosis
fragment with confidence above the calibrated fail-safe floor.

Therefore:

> **Jev-only instruction admission failed the safety gate.**

No threshold was changed after seeing this result.

## 7. Post-sealed hybrid hypothesis

The deterministic baseline did include the one pair missed by Jev. A diagnostic
union on the consumed sealed set therefore suggested:

```text
deterministic INCLUDE
        UNION
Jev fail-safe INCLUDE
```

On the consumed sealed set this would have produced:

```text
required recall:              100%
instruction-char reduction:   ~70.1%
```

Because this architecture was proposed after looking at the sealed result, that
number was **not** treated as validation. A third untouched historical task set
was frozen before evaluating the hybrid.

## 8. Stage C — fresh hybrid holdout

Artifact:

```text
experiments/jev_instruction_admission/hybrid-holdout-result-20260922.json
```

Fixed architecture before first call:

```text
1. deterministic mandatory/known includes
2. Jev semantic admission for remaining relevance
3. INCLUDE / UNCERTAIN -> load
4. EXCLUDE confidence < 0.30 -> load fail-safe
5. final load set = deterministic UNION Jev fail-safe
```

Dataset:

```text
15 independent real tasks unused in Stage A or B
135 pairs per repeat
10 repeats
1,350 decisions
```

### Deterministic baseline

```text
required recall:             58.0%
irrelevant exclusion:       100.0%
instruction-char reduction:  78.4%
```

### Raw Jev choices

```text
raw required recall:          95.8%
fail-safe UNCERTAIN recall:   95.8%
raw irrelevant exclusion:     82.1%
raw char reduction:           76.2%
```

### Fixed hybrid result

```text
required recall:             100.0%
minimum recall any run:      100.0%
runs with required miss:       0 / 10
required-char recall:        100.0%
irrelevant exclusion:         72.2%
instruction-char reduction:   71.6%
```

No hybrid required miss occurred in any of the ten repeats.

Context-size proxy across the 15-task holdout:

```text
always load all available instructions: 725,463 chars total
human gold minimum required:             175,189 chars total
hybrid mean loaded:                      205,771 chars total

average per task:
always load:                              ~48,364 chars
gold minimum:                             ~11,679 chars
hybrid:                                   ~13,718 chars
```

The hybrid therefore loaded about 17.5% more characters than the human-labelled
minimum while avoiding every required miss in this holdout.

## 9. Latency / usage

Fresh hybrid holdout TypeSafe requests:

```text
model: jev-1.13.0
requests: 50
request p50 latency: ~758 ms
request p95 latency: ~822 ms
range: ~549-968 ms
```

The experiment batched three tasks per request, so this request latency is not a
direct measurement of a one-task production admission call.

Aggregate TypeSafe usage for the holdout:

```text
input tokens:  289,880
output tokens:  68,520
```

Latency is the primary remaining cost question: the context reduction is large,
but a shadow end-to-end run must determine whether reduced frontier-model input
actually saves more time/compute than the extra System-One call costs.

## 10. Interpretation

DS-J1 differs materially from DS-J3.

For post-tool errors, deterministic strings/codes already solved the task and
Jev added no value.

For instruction relevance:

```text
deterministic only
    -> very precise but semantically incomplete

Jev only
    -> much better semantic recall but one systematic safety miss

deterministic union Jev
    -> preserves hard known obligations and fills semantic gaps
```

This is consistent with the architecture principle emerging from the TypeSafe
design note and our own earlier experiments:

> deterministic Host authority + bounded semantic primitive is stronger than
> giving the semantic model sole workflow authority.

## 11. Stage C disposition at the time

### What is accepted

```text
DS-J1 hybrid instruction admission
    -> qualified for SHADOW PROTOTYPE
```

This was the correct disposition after Stage C, but it is **superseded by Stage
D below**. Stage C answered whether a broad deterministic+Jev union could repair
the broad deterministic policy's semantic misses. It could. Stage D asked the
more important architectural question: after simplifying the instruction model
to only the few large optional skills that are actually worth gating, is Jev
still needed at all?

### What is not accepted

```text
Jev-only admission
production context omission
dynamic summary levels
JevHarness optimization
```

The current result does **not** prove end-to-end worker improvement. The next
stage should compute decisions in shadow while continuing to give workers the
normal full instruction context.

Shadow telemetry should record:

- actual task + candidate fragment identities/hashes;
- deterministic include set;
- Jev choices/confidence;
- would-load / would-skip set;
- actual instruction characters/tokens that would have been removed;
- task success/failure;
- retries/corrections;
- worker/frontier input tokens and latency where observable;
- every case where a later correction reveals a skipped fragment was actually
  needed.

Promotion beyond shadow requires real live-task evidence that context reduction
improves end-to-end cost/latency without creating required-context misses.

## 12. Limitations before Stage D

1. Gold is manually assigned from real task/commit semantics.
2. Candidate pool is small: five global skills plus five DevSpace repo-local
   sections.
3. `BEST_MINDS` had no positive case in Stages A-C. Stage D adds three fresh
   positive `BEST_MINDS` cases. `PULL_REQUESTS` still has no positive case and is
   not part of the Stage D optional-skill gate.
4. Character count is a stable local context-size proxy, not the actual frontier
   provider tokenizer.
5. This experiment did not run workers with omitted instructions, so task success,
   correction rate and actual frontier token savings remain unmeasured.
6. Fragment descriptors are hand-authored and must be versioned with fragment
   hashes if used in a runtime implementation.

## 13. Stage A-C artifacts

```text
experiments/jev_instruction_admission/README.md
experiments/jev_instruction_admission/replay.py
experiments/jev_instruction_admission/pilot-20260922.json
experiments/jev_instruction_admission/sealed_replay.py
experiments/jev_instruction_admission/sealed-result-20260922.json
experiments/jev_instruction_admission/hybrid_holdout.py
experiments/jev_instruction_admission/hybrid-holdout-result-20260922.json
```

## 14. Stage D — architecture simplification challenge

Stage C showed that a broad deterministic policy had poor semantic recall and
that adding Jev could fill those gaps. Before implementing shadow telemetry, the
instruction economics were re-examined.

The important observation was that the broad 10-fragment problem was itself
overcomplicated:

```text
ROUTING
  -> required by essentially every engineering task

SUBAGENTS
  -> small (~631 token-equivalent) and poorly discriminated by Jev

repo-local core AGENTS sections
  -> only ~149-191 token-equivalent each

AGENT_REACH / EGO_BROWSER / BEST_MINDS
  -> large, optional, low-frequency skills where admission could materially
     reduce context
```

Therefore a smaller prospective policy was frozen **before** selecting the
Stage D task set:

```text
always load:
  ROUTING
  SUBAGENTS
  small repo-local core sections when available

conditionally gate only:
  AGENT_REACH
  EGO_BROWSER
  BEST_MINDS

fail-safe:
  INCLUDE / UNCERTAIN -> load
  EXCLUDE confidence < 0.30 -> load
```

Machine policy:

```text
experiments/jev_instruction_admission/hybrid_policy.json
```

This is a stricter Occam test than Stage C: Jev must beat a simple Host policy
on the **small residual semantic problem**, not merely beat an intentionally
broad keyword router on every instruction fragment.

### Windows historical evidence source

Under the current repository governance, Windows was not used as a development
environment. It supplied fresh historical task evidence from repositories such
as:

- browser automation routing;
- Local AI RAG;
- FIRE/local knowledge;
- RAG model bakeoff;
- Windows portable DevSpace;
- desktop harness;
- OpenChatCut;
- engineering-bridge.

The first Stage D replay accidentally included one historical Gemini Free Tier
task already consumed in the Stage C holdout. That run was rejected before any
promotion decision. Its raw artifact is retained only as rejected evidence:

```text
experiments/jev_instruction_admission/
windows-fresh-result-rejected-overlap-20260922.json
```

The overlapping task was removed. The policy, confidence floor, descriptors,
gold rubric and remaining tasks were not tuned afterward.

### Corrected fresh set

```text
independent tasks:             19
gated task x skill pairs:      57
required gated pairs:           7
irrelevant gated pairs:        50
repeats:                       10
total Jev decisions:          570
```

Positive coverage:

```text
AGENT_REACH required cases:    1
EGO_BROWSER required cases:    3
BEST_MINDS required cases:     3
```

The set includes current/upstream browser research, authenticated browser
operation, architecture/strategy trade-offs, Local AI RAG browser-UI
verification, and many ordinary coding/RAG/deployment/desktop tasks as
negatives.

### Jev result

Across all ten repeats:

```text
required recall:               100.0%
minimum required recall/run:   100.0%
runs with required miss:          0 / 10
irrelevant exclusion:           94.0%
hybrid context-char reduction:  61.0%
```

By skill:

| Skill | Required cases | Required recall | Irrelevant exclusion |
| --- | ---: | ---: | ---: |
| `AGENT_REACH` | 1 | 100% | 94.44% |
| `EGO_BROWSER` | 3 | 100% | 87.50% |
| `BEST_MINDS` | 3 | 100% | 100% |

Jev produced three stable/near-stable false includes in the fresh workload,
mainly around tasks mentioning browser-adjacent infrastructure or public/runtime
verification without actually needing browser/web research.

Replay request latency over 40 batched calls:

```text
p50: ~595 ms
range: ~545-665 ms
```

Again, this batched timing is not treated as an exact one-task production
latency, but it establishes an additional external request and availability
dependency.

### Frozen deterministic Host baseline

The deterministic residual router was evaluated **before the Jev fresh run**.
It uses direct task-language triggers for the three optional skills only.

Result:

```text
required recall:               100.0%
irrelevant exclusion:           98.0%
hybrid context-char reduction:  63.9%
```

By skill:

```text
AGENT_REACH: 100% required recall, 100% irrelevant exclusion
EGO_BROWSER: 100% required recall, 93.75% irrelevant exclusion
BEST_MINDS:  100% required recall, 100% irrelevant exclusion
```

The deterministic baseline had one false include caused by a negated phrase
(`no ... browser interaction is requested`). Jev understood that particular
negation, but produced more false includes elsewhere. Aggregate performance
still favored the deterministic Host policy.

## 15. Final interpretation and disposition

The complete DS-J1 evidence supports two statements at the same time:

1. **Jev has genuine semantic instruction-relevance capability.** The broad
   Stages B/C showed cases that a simplistic broad deterministic router missed.
2. **That capability is not currently needed in the production architecture.**
   Once the instruction problem is reduced to only the three large optional
   skills worth gating, a simple Host policy matches required recall and is more
   selective.

Therefore the Stage C shadow-prototype recommendation is superseded:

```text
Jev universal instruction controller:       NO-GO
Jev optional-skill controller today:        NO-GO
deterministic optional-skill admission:      preferred if gating is needed
JevHarness optimization for DS-J1:           NOT JUSTIFIED
Jev shadow runtime telemetry for DS-J1:      NOT JUSTIFIED
worker A/B for Jev instruction omission:     NOT JUSTIFIED
```

The reason to stop is architectural, not model quality. Jev would add:

- external API availability and latency;
- model/version drift;
- confidence/fail-safe policy;
- runtime telemetry and failure handling;
- calibration/requalification burden;

without improving the fresh simplified decision problem.

This directly triggers the portfolio stop rule:

> If deterministic Host logic already solves the decision with less complexity,
> do not add Jev.

Reopen DS-J1 only if the environment materially changes — for example, dozens
or hundreds of optional skills, a real ambiguous residual set that defeats the
Host router, or a measured instruction/tool context tax large enough that a
semantic router would replace more expensive reasoning rather than duplicate a
small rule set.

### Stage D artifacts

```text
experiments/jev_instruction_admission/hybrid_policy.json
experiments/jev_instruction_admission/windows_fresh_replay.py
experiments/jev_instruction_admission/windows-fresh-result-20260922.json
experiments/jev_instruction_admission/windows-fresh-result-rejected-overlap-20260922.json
```

