# Jev Experiment Portfolio / Cross-Project Tracker — 2026-09-22

## 0. Purpose

This document is the **cross-project reference and progress tracker** for Jev /
System-One experiments after the September 2026 exploration cycle.

It consolidates:

- our completed PKD / DevSpace / FIRE Jev experiments;
- the TypeSafe coding-agent design note (`Why yet another agent`);
- `devagrawal09/jev-review`;
- `itsmostafa/typesafe-mcp`;
- `TianyuCodings/JevHarness`;
- the current repository-governance decision that GitHub is the source of
  truth, macOS is the development environment, Windows is GPU-only, and NAS is
  production plus Git disaster-recovery storage.

This is **not** the authority for the internal semantics or production release
criteria of another project. Each experiment's code, frozen datasets, results,
and promotion decision belong in that project's canonical repository.

The purpose here is to answer:

> Which Jev ideas are still worth testing, in which repository, in what order,
> and what evidence would justify continuing or stopping?

---

## 1. Repository / deployment governance

The current operating model is:

```text
GitHub                  = canonical source of truth
macOS                   = normal development / commits / experiment authoring
Windows                 = GPU execution only when required
NAS                     = production deployment + Git DR mirror
```

Rules for all experiments in this document:

1. New source development happens on macOS.
2. A Windows GPU run must execute a pinned GitHub commit/artifact, not become an
   independent development branch.
3. Results produced on Windows must be brought back to the canonical project
   repository and committed/pushed through the normal GitHub flow.
4. NAS production must deploy a pinned GitHub identity. NAS Git is backup/DR,
   not the development source of truth.
5. Do not revive an older Windows-only or mixed-purpose repository merely
   because an experiment was historically run there.
6. Cross-project decisions live here; project-specific evidence lives in the
   target repository.

### Current repository identities relevant to Jev

| Project | Canonical GitHub identity | Current governance status |
| --- | --- | --- |
| DevSpace | `xanthhuang/devspace` | Established; this tracker lives here |
| PKD | `xanthhuang/personal-content-distiller` | Established |
| FIRE knowledge agent | `xanthhuang/fire-knowledge-agent` | Established |
| Local AI RAG | **Not resolved in the current GitHub repository inventory** | Block new development until canonical GitHub repo + macOS clone are established |
| OpenChatCut / video-editing agent work | **Not resolved in the current GitHub repository inventory** | Candidate only; do not start Jev work until repo ownership is normalized |

As of this document's creation, a `gh repo list xanthhuang` inventory did not
show `local-ai-rag-v1` or `local-knowledge-agent-phase1`. The existing Windows
checkout `E:\AI\local-ai-rag-v1` contains accepted historical state, but under
the new governance it must not become the place where new Jev development
continues.

---

## 2. What the recent external material actually contributes

### 2.1 TypeSafe coding-agent design note — architecture hypothesis

Source:

```text
https://docs.google.com/document/d/1G61uUB0FifUnmmrPzFQojZ3KpczYKmXGpgEXDJ2l_Zg/mobilebasic
```

Useful ideas:

- treat agent context as explicit, recomposable state rather than one static
  transcript;
- query-aware "meta-attention" over tool inputs/outputs, instructions and prior
  state;
- dynamic instruction / AGENTS / skill loading;
- lazy tool-schema loading;
- task-specific context packages for subagents;
- read-only background consumers sharing one acquired evidence pool.

Evidence grade: **design hypothesis**, not production proof.

It changes our view from "Jev is a cheap classifier" toward:

```text
explicit state
     ↓
bounded Jev judgments
     ↓
task-specific context / routing / escalation
     ↓
frontier reasoning only where needed
```

It does **not** revive generic irreversible context deletion or prove that model
routing is valuable.

### 2.2 `devagrawal09/jev-review` — staged narrowing pattern

Source:

```text
https://github.com/devagrawal09/jev-review
```

Useful pattern:

```text
broad cheap screening
     ↓
bounded evidence-region selection
     ↓
specific mechanism classification
     ↓
severity / owner routing
     ↓
human or frontier review
```

Important limitation discovered upstream:

- a real 1,471-file codebase scan raised 1,609 threshold signals;
- a fixed `MAX_FOLLOW_UPS=8` meant only 8 signals reached the locate stage;
- the run produced zero final findings;
- therefore cheap broad screening can simply move the bottleneck into candidate
  budgeting / evidence localization.

Evidence grade: **working reference implementation + useful failure evidence**,
not proof that Jev can replace a code reviewer.

Use: borrow the staged narrowing architecture. Do not adopt it as an
authoritative final reviewer or import its fixed budgets unchanged.

### 2.3 `itsmostafa/typesafe-mcp` — integration primitive

Source:

```text
https://github.com/itsmostafa/typesafe-mcp
```

Useful properties:

- one MCP `evaluate` primitive for Noul / Choice / Score;
- TypeSafe and OpenRouter transport support;
- retry handling for 429 / 529;
- local request validation;
- encourages raw observed evidence in `state`, rather than feeding the caller's
  conclusion back as evidence;
- encourages batching independent questions over shared state;
- explicitly recommends a no-match choice when nothing may fit.

Evidence grade: **engineering integration utility**. It says nothing by itself
about semantic accuracy.

Recommended scope:

- useful for fast DevSpace experiments;
- do not make it the provenance layer for formal Local AI RAG qualification;
- keep API keys loaded at runtime from protected local secret storage rather
  than baking literal credentials into portable MCP configuration.

### 2.4 `TianyuCodings/JevHarness` — offline harness optimization

Source:

```text
https://github.com/TianyuCodings/JevHarness
```

Most important new contribution:

```text
System-2 authoring / reflection
       ↓
task-specific code + Jev pipeline
       ↓
real evaluator / reward
       ↓
complete trajectory feedback
       ↓
offline pipeline evolution
       ↓
freeze
       ↓
runtime code + Jev only
```

This directly addresses the part that consumed most of our Jev research time:
manually deciding state representation, feature extraction, question wording,
criteria, thresholds and control flow.

Important methodological rule:

- use JevHarness only when a reliable external evaluator/reward exists;
- separate train/search, validation/selection and sealed final test;
- held-out results must never enter reflection, feature design, thresholds,
  stopping or candidate selection;
- a selected/eval-set improvement is not a generalization result.

Evidence grade: **promising experiment framework**. Its demos motivate the
approach but do not establish task-independent gains.

For our use, JevHarness is a **second-stage optimizer after a fixed Jev
formulation demonstrates real signal**, not a replacement for the initial
causal test.

---

## 3. Governing architecture rule

The strongest reusable rule after all experiments and external review is:

```text
deterministic acquisition / authority
             ↓
       explicit bounded state
             ↓
         Jev decision(s)
             ↓
 deterministic policy / escalation
             ↓
 frontier model only when needed
```

A candidate Jev use is worth experimenting with when most of these are true:

1. The input evidence is already available or cheap to acquire.
2. The decision is semantic but bounded.
3. The answer/action space is closed or tightly constrained.
4. The same kind of decision repeats often enough to calibrate.
5. Low-confidence / ambiguous output can fail closed.
6. A deterministic Host still owns source authority, hard safety and final
   promotion/action policy.
7. Jev removes real human/frontier-model work rather than duplicating an
   existing deterministic check.
8. Correctness can be evaluated against real outcomes, labels or downstream
   task success.

The new addition from the TypeSafe design note and JevHarness is:

> The unit of optimization may be an entire small decision program, not one
> isolated Jev question.

But do not optimize the program before establishing that the underlying task has
useful Jev signal.

---

## 4. Active experiment portfolio

Status vocabulary:

```text
BLOCKED      governance/data dependency must be resolved first
READY        next experiment may be started
CONDITIONAL  only after a named prior gate passes
HOLD         retain as candidate; no current bottleneck justifies work
CLOSED       already tested; do not reopen without new evidence
```

### P0 — Local AI RAG: exact-evidence semantic verifier

**ID:** `LAR-J0`  
**Target repo:** canonical Local AI RAG GitHub repo — **currently unresolved**  
**Status:** `BLOCKED` by repository normalization; experiment itself is `READY`
once the GitHub repo + macOS clone exist.

Question:

> Given a material proposition plus its exact cited technical evidence and
> explicit scope, can Jev safely replace or reduce the existing expensive
> semantic-audit work?

Use existing frozen real artifacts first:

- Section 17 cases;
- strict-audit PASS/FAIL cases;
- correction cases;
- exact evidence/citation data;
- existing qualification/human disposition where available.

Do **not** send gold/disposition to Jev.

Initial formulations:

```text
SUPPORTED / UNSUPPORTED / UNCERTAIN
```

and/or:

```text
ENTAILED / PARTIAL / CONTRADICTED / INSUFFICIENT
```

Primary gate:

```text
critical false PASS on known defective claims = 0
```

Necessary secondary metrics:

- defect recall;
- false reject / usable coverage;
- scope-violation recall;
- same-input repeat stability;
- p50/p95 latency;
- fallback rate;
- comparison with deterministic checks and the existing semantic auditor.

Stop if zero false PASS is achieved only by rejecting/deferring nearly
everything.

### P1 — Local AI RAG: JevHarness verifier evolution

**ID:** `LAR-J1`  
**Target repo:** canonical Local AI RAG GitHub repo  
**Status:** `CONDITIONAL` on `LAR-J0` showing useful but imperfect Jev signal.

Purpose:

> Optimize the verifier program instead of manually grinding prompts,
> thresholds and feature combinations.

Allowed mutation surface may include:

- deterministic features such as literal/number/version/command overlap;
- state representation;
- Jev questions / criteria;
- parallel versus dependent decision nodes;
- escalation thresholds;
- bounded memory/policy.

Authority that must remain outside the candidate:

- labels / gold;
- hidden state;
- reward definition;
- legal actions;
- production promotion decision.

Required split:

```text
TRAIN / SEARCH
VALIDATION / SELECTION
SEALED TEST / one final reveal after freeze
```

Stop if the dataset is too small or the reward too ambiguous to support a
meaningful sealed test.

### P1 — Local AI RAG: cloud generator + Jev matched A/B

**ID:** `LAR-C0`  
**Target repo:** canonical Local AI RAG GitHub repo  
**Status:** `CONDITIONAL` on `LAR-J0`; `LAR-J1` is optional if the fixed verifier
already qualifies.

Keep the accepted evidence engine fixed and compare architectures such as:

| Variant | Generator | Verifier |
| --- | --- | --- |
| B0 | accepted local 35B | accepted semantic audit |
| C1 | current fast cloud generator | deterministic checks only |
| C2 | current fast cloud generator | Jev verifier |
| C3 | current fast cloud generator | Jev uncertain -> stronger verifier |

Do not hard-code a historical Gemini version as an architectural dependency;
select current providers by measured quality/latency at test time.

Primary outcome:

> Can cloud-first generation plus bounded verification materially reduce the
> current ~30-50 second semantic path without increasing correctness risk?

### P1 — DevSpace: conditional instructions / AGENTS / skills admission

**ID:** `DS-J1`  
**Target repo:** `xanthhuang/devspace`  
**Status:** `HISTORICAL QUALIFICATION COMPLETE — deterministic authority retained; Jev shadow observer authorized`.

This is the strongest new DevSpace candidate from the TypeSafe design note.

Do not test irreversible transcript deletion. Test task-aware instruction
selection:

```text
task + repo/path facts
       ↓
instruction fragments
       ↓
NONE / SUMMARY / FULL   (or INCLUDE / UNCERTAIN / EXCLUDE)
       ↓
worker context
```

Preferred fail-safe:

```text
UNCERTAIN => include
```

Metrics:

- required-instruction recall;
- irrelevant instruction tokens removed;
- final task success;
- worker retries / corrections;
- frontier input tokens and latency.

If deterministic path/task rules perform equally well, keep the deterministic
rules and do not add Jev.

2026-09-22 qualification result:

- deterministic-only rules were precise but had poor semantic recall on fresh
  holdout (`58%` required recall);
- Jev-only fixed admission improved recall but had one systematic required miss
  on the first sealed set and therefore failed the safety gate;
- a pre-frozen second holdout tested `deterministic INCLUDE UNION Jev fail-safe
  INCLUDE` and achieved `100%` required recall in all 10 repeats while reducing
  instruction characters by about `71.6%` versus always loading all available
  fragments.

That Stage C result established Jev's semantic capability, but a subsequent
architecture-simplification challenge changed the product disposition. The
instruction pool was reduced to a deterministic mandatory core plus only three
large optional skills worth gating: `AGENT_REACH`, `EGO_BROWSER`, and
`BEST_MINDS`. The simplified policy was frozen before selecting a fresh
Windows-derived task set.

Corrected Stage D fresh validation (19 independent tasks, 57 gated pairs,
10 repeats / 570 Jev decisions):

```text
Jev:
  required recall                100%
  irrelevant exclusion            94%
  global-skill context reduction   61.0%

deterministic Host baseline:
  required recall                100%
  irrelevant exclusion            98%
  global-skill context reduction   63.9%
```

One initially selected Windows task overlapped the consumed Stage C holdout; its
run was rejected and the corrected set was rerun without changing policy or
thresholds.

Final authority disposition: **do not let Jev prune context or control routing,
and do not start JevHarness.** The simplified deterministic Host policy dominates
the measured runtime classification problem.

However, that deterministic router is manually authored. To measure whether Jev
can reduce lifecycle/routing-maintenance work or identify useful semantic
residual cases, a record-only Jev shadow observer is authorized for real future
tasks. It must not alter the worker context, block task execution, or become a
production dependency. Evaluate only meaningful deterministic/Jev disagreements.

Canonical shadow decision:

`docs/JEV-DEVSPACE-SHADOW-OBSERVATION-DECISION-20260922.md`

Canonical result:

`docs/JEV-DEVSPACE-INSTRUCTION-ADMISSION-RESULT-20260922.md`

### P1 — DevSpace: staged diff-review evidence prefilter

**ID:** `DS-J2`  
**Target repo:** `xanthhuang/devspace`  
**Status:** `HOLD — technically plausible, but no measured DevSpace reviewer-context bottleneck currently justifies the experiment`.

Borrow the `jev-review` architecture, not its authority:

```text
git diff + changed tests
       ↓
cheap concern screening
       ↓
bounded hunk/region selection
       ↓
mechanism / severity classification
       ↓
frontier reviewer sees selected evidence + necessary context
```

Goal:

> Reduce frontier-reviewer repo rereading / context while preserving material
> finding recall.

Do not use a fixed `top 8`-style follow-up cap. Candidate budgeting must be
measured against signal count and finding recall.

Metrics:

- historical material-finding recall;
- false signal rate;
- evidence-location accuracy;
- reviewer input-token reduction;
- review latency;
- reviewer final disposition agreement;
- cases where Jev screening hides a later real finding.

Final merge/block authority remains with the frontier/human/deterministic
acceptance path.

2026-09-22 necessity review:

- the current macOS DevSpace state DB contains 11 generic Codex sessions and 4
  generic Claude sessions in the inspected period;
- there are **zero explicit `astra-review` / `claude-review` profile sessions**
  in that local runtime state;
- historical product work contains many review artifacts, but that does not
  establish that DevSpace's frontier reviewer is currently a high-frequency
  context/latency bottleneck;
- `jev-review` also demonstrates that broad screening can create a candidate
  explosion unless evidence/search budgeting is already a measured problem.

Therefore do not start DS-J2 merely because the primitive is promising. Reopen
only when at least one of these becomes observable:

1. independent reviewer calls become frequent enough to matter;
2. reviewers repeatedly reread large diffs/repos and token/context cost is
   measurable;
3. material findings are concentrated in a small subset of files/hunks that a
   prefilter could plausibly isolate;
4. review latency/cost is delaying the normal development loop.

Until then, DS-J2 is lower value than collecting real DS-J1 shadow disagreement
evidence from normal work.

### P1/P2 — DevSpace: post-tool result classifier and recovery routing

**ID:** `DS-J3`  
**Target repo:** `xanthhuang/devspace`  
**Status:** `PILOT COMPLETE / HOLD — no current incremental value`.

Bounded classes:

```text
NO_FAILURE
TRANSIENT
ENVIRONMENT
CODE_BUG
PERMISSION
USER_ERROR
UNKNOWN
```

The evidence is naturally available: the tool result that just occurred.

Host policy remains deterministic, e.g.:

```text
TRANSIENT   -> bounded retry
ENVIRONMENT -> inspect environment
CODE_BUG    -> return to worker
PERMISSION  -> stop/escalate
UNKNOWN     -> stronger reasoning
```

This avoids the evidence-acquisition failure mode of the DONE verifier.

The 2026-09-22 real macOS historical pilot used 16 independent incidents and
10 repeats. After rejecting an initial run with post-event recovery leakage, the
decision-time-only replay produced `160/160` exact Jev classifications with zero
unsafe auto-retry or unnecessary source-edit decisions. However, a small
deterministic Host error-code/message baseline also classified `16/16` cases
correctly. No real permission-denied case was available.

Disposition: do **not** integrate a broad Jev post-tool classifier. The current
observed failures are too structurally obvious to justify an external semantic
call. Reopen only for a residual set of real ambiguous failures that deterministic
rules cannot safely classify and that currently consume frontier reasoning.

Canonical result:

`docs/JEV-DEVSPACE-POST-TOOL-CLASSIFIER-RESULT-20260922.md`

### P2 — DevSpace: subagent context packaging

**ID:** `DS-J4`  
**Target repo:** `xanthhuang/devspace`  
**Status:** `CONDITIONAL` on `DS-J1` or `DS-J2` demonstrating that task-aware
state selection yields measurable gains.

Hypothesis:

```text
shared explicit evidence/state pool
       ↓
consumer-specific relevance/resolution
       ↓
Claude architecture context
Codex implementation context
reviewer context
```

Goal: reduce repeated repo reading across agents, not decide which model is
"smart enough" for a task.

Measure total tool reads, duplicated file bytes/tokens, reviewer/worker input
tokens, task success and missed-context failures.

### P2 — DevSpace: tool-family / schema lazy loading

**ID:** `DS-J5`  
**Target repo:** `xanthhuang/devspace`  
**Status:** `HOLD` until full tool schemas are shown to be a material context or
selection bottleneck.

Candidate architecture:

```text
small capability descriptions always visible
       ↓
deterministic or Jev family selection
       ↓
load full schema only when needed
```

Compare against deterministic namespace/skill routing first. Do not add Jev if
simple routing is already sufficient.

### P2/P3 — DevSpace: query-aware graded context reconstruction

**ID:** `DS-J6`  
**Target repo:** `xanthhuang/devspace`  
**Status:** `HOLD` until `DS-J1` demonstrates a safe smaller version of dynamic
state admission.

This supersedes the old idea of generic KEEP/DROP transcript compaction.

Candidate decision:

```text
NONE / SHORT_SUMMARY / LONG_SUMMARY / FULL
```

for explicit state objects such as tool results, prior decisions and task
constraints.

Do not delete evidence. Reconstruct query-specific context and measure final
task success, required-state recall, context tokens, cache-rebuild cost and
latency.

### P2 — Closed-world Browser/Electron action selection

**ID:** `GUI-J1`  
**Target repo:** canonical OpenChatCut / relevant GUI-agent repo — **currently
unresolved**  
**Status:** `BLOCKED` by repo normalization and by product need.

Only test if stable IPC/API/deterministic selectors do not solve the workflow and
repetitive UI action selection is a measured bottleneck.

Prior Jev-cu-style bounded target selection suggests the primitive is plausible,
but deterministic IPC/API remains preferred.

### P3 — PKD regression judge over mature human gold

**ID:** `PKD-J1`  
**Target repo:** `xanthhuang/personal-content-distiller`  
**Status:** `HOLD` until sufficient real human-confirmed corrections accumulate.

Use Jev as a cheap repeated regression signal only after enough independent
positive/negative human examples exist. Do not use it as Personal Claim,
relation, facet or NEW authority.

### HOLD — FIRE semantic verifier

**ID:** `FIRE-J1`  
**Target repo:** `xanthhuang/fire-knowledge-agent`  
**Status:** `HOLD`.

Existing FIRE production has no current failure that justifies changing the
accepted pipeline. Reopen only if a concrete repeated semantic-verification
bottleneck appears.

---

## 5. Closed / do-not-reopen items

Do not spend further experiment budget on these without materially new evidence
or a changed workload:

| Item | Status | Reason |
| --- | --- | --- |
| PKD facet Choice + NEW as authority | `CLOSED / NO-GO` | Real-data NEW exact choice / false-merge behavior is inadequate |
| PKD post-lock verifier replacement | `CLOSED / NO-GO` | Real positive-defect recall/precision inadequate |
| DevSpace worker-DONE verifier | `CLOSED / HOLD` | Sparse evidence yields conservative VERIFY, not independent defect discovery; evidence acquisition remains the bottleneck |
| Generic irreversible context compaction | `CLOSED / NO-GO` | Required-evidence recall not safe; use graded query-aware reconstruction only if justified |
| Model difficulty routing | `CLOSED / low value` | Deterministic role split is clearer; KV/context cost dominates simplistic easy/hard routing |
| Jev for deterministic source/version/citation authority | `CLOSED` | Host already knows the answer exactly |
| Jev for corpus-wide absence proof | `CLOSED` | Missing bounded evidence cannot prove global absence |
| Direct adoption of `jev-review` as final reviewer | `CLOSED` | Treat it as staged prefilter architecture only |
| JevHarness without reliable reward + sealed test | `CLOSED` | Optimization would invite benchmark fitting without trustworthy generalization evidence |

---

## 6. Shared tooling policy

### `typesafe-mcp`

Disposition: **adopt experimentally for DevSpace convenience**, not as the
formal qualification provenance layer.

Requirements if integrated:

- pin a known upstream version/commit;
- load keys at runtime from protected secret storage;
- do not bake literal API keys into shareable/portable MCP config;
- preserve raw evidence and question definitions in project experiment
  artifacts;
- formal replay harnesses may call TypeSafe/OpenRouter directly when exact
  request identity and machine-produced reports matter.

### `JevHarness`

Disposition: **adopt as an optional offline optimization framework after a fixed
primitive passes**.

Use it for:

- Local AI RAG verifier evolution after `LAR-J0`;
- DevSpace conditional-instruction policy after `DS-J1` fixed-formulation
  evidence;
- possibly diff-review state/threshold optimization after `DS-J2` proves the
  staged pattern useful.

Do not make it a production runtime dependency by default. Freeze the selected
pipeline and deploy only the minimum required runtime pieces.

### `jev-review`

Disposition: **reference architecture / test fixture source**, not a dependency
unless later evidence shows direct reuse is cheaper than implementing a smaller
target-specific pipeline.

### TypeSafe coding-agent design note

Disposition: **architecture hypothesis backlog**. Ideas enter experiments only
when they correspond to a measured cost/failure in our own systems.

---

## 7. Experiment order

Do not run everything in parallel merely because the ideas are interesting.

Recommended order after the repository audit:

```text
G0  finish repo normalization / GitHub identities
    ↓
LAR-J0  Local AI RAG fixed semantic replay
    ↓
if signal:
    LAR-J1  JevHarness optimization
    LAR-C0  cloud-generator matched A/B

DevSpace current priority:
    DS-J1  collect record-only shadow disagreement evidence during normal work

DevSpace HOLD until a measured bottleneck exists:
    DS-J2  staged review prefilter

DevSpace closed/hold from completed pilots:
    DS-J3  broad post-tool classifier

only if a smaller state-selection problem later shows measurable value:
    DS-J4  subagent context packaging
    DS-J5  tool-schema lazy loading
    DS-J6  graded context reconstruction
```

PKD/FIRE/GUI candidates stay HOLD/BLOCKED until their prerequisites appear.

---

## 8. Progress tracker

### Governance

- [x] Central cross-project Jev tracker located in `xanthhuang/devspace`.
- [x] GitHub declared source of truth; NAS declared production + Git DR.
- [x] macOS declared normal development environment; Windows GPU-only.
- [ ] Complete repository inventory / normalization currently in progress.
- [ ] Establish canonical GitHub repo for Local AI RAG.
- [ ] Clone canonical Local AI RAG repo to macOS and verify accepted baseline
      provenance before Jev development.
- [ ] Establish canonical GitHub repo for OpenChatCut / GUI work if that project
      is to continue.

### Local AI RAG

- [ ] `LAR-J0` freeze real strict-audit replay dataset.
- [ ] `LAR-J0` run fixed Jev formulation with repeated calls.
- [ ] Record GO / HOLD / NO-GO with critical false-PASS and coverage metrics.
- [ ] If GO/HOLD-with-signal: define train/validation/sealed-test split for
      `LAR-J1`.
- [ ] If justified: run JevHarness verifier evolution and freeze selected
      pipeline.
- [ ] Run fresh sealed test once after freeze.
- [ ] If verifier path qualifies: run cloud-generator matched A/B (`LAR-C0`).

### DevSpace

- [x] `DS-J1` historical qualification complete. Broad replay proved Jev
      semantic signal; deterministic Host remains authoritative at current
      scale. Record-only Jev shadow observation is authorized to measure real
      incremental semantic/lifecycle value without changing worker context.
- [ ] `DS-J1` implement/collect shadow disagreement telemetry only when it can be
      added without affecting the normal task path; adjudicate meaningful
      disagreements rather than every task.
- [ ] `DS-J2` HOLD. Do not build the staged diff-review prefilter until reviewer
      frequency/context/latency becomes a measured DevSpace bottleneck.
- [x] `DS-J3` fixed historical replay complete; Jev 16/16 independent cases and
      deterministic baseline 16/16. Broad integration HOLD; only ambiguous
      deterministic-residual failures justify reopening.
- [ ] Decide whether `typesafe-mcp` should be pinned as a DevSpace experimental
      utility after key-handling review.
- [ ] JevHarness remains eligible only for an experiment that first demonstrates
      incremental value over its deterministic baseline. `DS-J1` does not meet
      that gate; `DS-J2` remains independent.
- [ ] Do not start `DS-J4`-`DS-J6` until a smaller state-selection experiment
      shows measurable value.

### PKD / FIRE / GUI

- [ ] PKD: accumulate mature human-confirmed regression gold; no Jev authority
      work before then.
- [ ] FIRE: no action; reopen only on a measured semantic bottleneck.
- [ ] GUI/OpenChatCut: no action until canonical repo and real UI-action
      bottleneck exist.

---

## 9. Evidence reporting standard

Every Jev experiment must report at least:

- number of **independent cases**;
- repeat count separately;
- frozen input/artifact identity;
- whether labels/gold were sent to the model (`must be false` for independent
  qualification);
- exact Jev transport/model identity;
- task-level correctness or decision confusion matrix;
- false-safe / false-PASS class relevant to the workload;
- false reject / coverage;
- same-input stability;
- p50/p95 latency;
- token/request usage;
- deterministic baseline comparison;
- frontier/human work actually removed;
- known contamination or oracle-like evidence selection;
- explicit promotion/hold/stop disposition.

For any evolved harness, additionally record:

- train/search split;
- validation/selection split;
- sealed test identity;
- candidate ancestry / reflection count;
- mutation surface;
- reward definition and authority;
- final frozen pipeline identity;
- proof that sealed-test results did not affect selection or stopping.

---

## 10. Stop rule

Jev work is not a goal by itself.

Stop an experiment when any of the following is true:

1. deterministic Host logic already solves the decision with less complexity;
2. Jev only repeats a frontier-model judgment without reducing frontier work;
3. evidence acquisition remains the expensive semantic step;
4. safe performance is achieved only by escalating/rejecting almost every case;
5. reward/gold is too weak to tell improvement from overfitting;
6. the integration creates more state-management complexity than the measured
   latency/token/human-effort gain;
7. a smaller experiment has already falsified the required primitive.

The objective is not to maximize Jev usage. The objective is to identify a few
high-frequency bounded semantic decisions where System-One execution produces a
measurable end-to-end advantage.

