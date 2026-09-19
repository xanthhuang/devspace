# Jev Semantic Decision Experiments — 2026-09-19

## Purpose

This document records the Jev / TypeSafe experiments performed across PKD,
DevSpace, and FIRE so later work can reuse the evidence without repeating the
same architectural questions.

The governing rule that emerged from the experiments is:

> Use Jev only for bounded semantic judgments that the Host cannot establish
> deterministically, with a small approved input surface and deterministic
> Host policy around the result.

Do not add Jev merely because a decision is probabilistic or because Jev is
cheap. If a plain deterministic check already knows the answer, keep it in the
Host.

## Tested transport and model

- OpenRouter Decisions endpoint: `https://openrouter.ai/api/alpha/decisions`
- Requested model: `typesafe/jev-1.13`
- Resolved model observed repeatedly: `typesafe/jev-1.13-20260917`
- Provider: TypeSafe
- Local credential file used by experiments: `~/.config/openrouter/api_key`
- Credential permissions were corrected to `0600`.

Do not record or print the credential value.

## Primitive smoke tests

Jev successfully handled Traditional Chinese and the three useful primitive
shapes used in later tests.

| Primitive | Result |
| --- | --- |
| Noul | PASS; Chinese policy statement scored `0.97` for support |
| Choice | PASS; Chinese facet assignment selected `focus` with confidence `1.00` |
| Fan-out Noul | PASS; same-facet `0.96`, new-concept `0.30`, relation-supported `0.90` |

Observed latency for these smoke calls was roughly `0.28-0.47 s`.

## PKD facet / NEW qualification

### Synthetic PKD-shaped suite

A 20-case Traditional-Chinese suite tested region-to-existing-facet versus
`NEW` assignment.

Results:

- accuracy: `19/20 = 95%`
- confidence `>= 0.90`: `16/16` correct
- confidence `>= 0.80`: `17/17` correct
- confidence `>= 0.70`: `18/18` correct
- confidence `>= 0.60`: `19/19` correct
- the only wrong case had confidence `0.48`
- P50 latency: about `0.296 s`
- sample P95 latency: about `0.466 s`
- total input tokens: `10,067`
- total cost: about `$0.00042281`

The one wrong case was a genuinely adjacent concept: psychological safety / safe
disagreement was incorrectly mapped to a decision facet instead of `NEW`.
Crucially, the model expressed low confidence on that error.

### Interpretation

This is promising for a confidence-gated PKD workflow:

```text
region + existing source-local facets
        -> Jev Choice(existing facet ids + NEW)
        -> high-confidence assignment: auto-accept
        -> low-confidence / ambiguous NEW: human confirmation
```

The current human Phase-2 first pass must be locked before any real replay is
used as ground truth. Do not use Jev to influence the human facet merge before
that lock exists.

### Status

`PROMISING` — synthetic capability demonstrated; real locked PKD replay still
required before production integration.

## DevSpace context admission

### Choice KEEP / DROP / UNCERTAIN

36 DevSpace-shaped synthetic outputs were classified for active context.

- overall accuracy: `31/36 = 86.1%`
- required `KEEP` recall: `90.9%`
- required `KEEP or UNCERTAIN` recall: `95.5%`
- P50 latency: about `0.334 s`
- P95 latency: about `0.474 s`
- cost: about `$0.000838` for 36 decisions

This was not safe enough for direct dropping.

### Noul relevance

Replacing three-way classification with a single semantic relevance score
improved separation in the synthetic suite:

- all 22 required-evidence cases scored above `0.41`
- `p <= 0.20` could remove `25%` of outputs with zero required-evidence false
  drops in that suite
- one manually `UNCERTAIN` item was scored `0.05`, showing that a low score is
  not equivalent to logically safe deletion

The correct semantic, if this design were used, would therefore be context
parking rather than evidence deletion.

### Safe-metadata / semantic-summary experiments

When raw tool output was replaced with reduced structured metadata, required
evidence separation degraded. Splitting the decision into solve / verify /
scope Noul questions did not fix the problem. Converting metadata back into
safe natural-language summaries raised both useful and useless scores, making
one stable threshold difficult to obtain.

### Privacy / safety boundary discovered

Attempts to send real DevSpace tool output, and later metadata derived from real
private-repo output, to OpenRouter were blocked by the local safety layer.
This exposed the architectural issue directly: generic context admission would
need to inspect source code, logs, paths, shell output, and other private
runtime state.

Adding a redaction framework, semantic summarizer, cold/park store, and
rehydration mechanism merely to save context would be over-engineering relative
to the existing deterministic Host narrowing (`rg`, bounded reads, targeted
tests, bounded tool output).

### Status

`NO-GO` for general DevSpace context admission.

This is an architectural conclusion, not evidence that Jev itself is poor at
semantic relevance.

## DevSpace bounded review / risk gate

Direct `needs_review` scoring showed overlap between true review-required,
ambiguous, and no-review cases. A better primitive was:

```text
contract_settled?
```

Meaning: intended behavior is already explicitly known and deterministic
evidence establishes that the change preserves or exactly restores it.

In the focused suite:

- OPEN cases all remained low (`<= 0.37`)
- at a provisional `contract_settled >= 0.80` auto-clear boundary, the tested
  accepted cases had no OPEN/AMBIG false clear
- a paraphrase check preserved the same separation for the tested subset

However, the cases Jev could safely clear were the same cases the current Host
policy already knows are settled: exact bug restoration, pure refactor with
identical outputs, internal-only rename, and similar bounded work.

### Status

`TECHNICALLY PASS / INTEGRATION NO-GO FOR NOW` because it duplicates existing
deterministic Host policy rather than removing a real reasoning cost.

## FIRE semantic verifier

The FIRE-shaped synthetic suite separated semantic truth from completeness:

```text
entailed?
complete?
```

This distinction matters because a claim can be true yet still omit a material
policy qualifier.

### 26-case entailment / completeness suite

Using `0.70` as an exploratory threshold:

- entailment: `18 TP / 0 FN / 0 FP / 8 TN`
- completeness: `11 TP / 0 FN / 0 FP / 15 TN`
- combined `entailed >= 0.70 AND complete >= 0.70`: `11/11` complete correct
  answers accepted, zero false accept in that suite

Exact number / order / identifier / status cases also separated extremely well,
but these should stay deterministic when the expected literal value is already
known.

ABSENT and source-authority synthetic tests also worked, but those checks are
already represented by deterministic Host metadata and therefore should not be
outsourced to Jev.

### Historical FIRE matched analysis

Two historical failures were identified as exact matches for the Jev
completeness primitive:

- `FIRE_EXACT_02`
  - routing/retrieval source coverage was correct
  - bounded answer was factually correct but omitted three required allocation
    ratio facets
  - the matched baseline answer included the ratios and passed
  - the bounded failure repeated twice with the same omission
- `FIRE_NUANCE_02`
  - routing/retrieval source coverage was correct
  - bounded answer stated the correct FX-risk conclusion but omitted two
    required explicit role/currency facets
  - the matched baseline answer preserved them and passed
  - the bounded failure repeated twice

This gives a clean historical failure-class match:

```text
entailed = yes
complete = no
```

However, an actual historical Jev replay was NOT executed. Even after local
anonymization, the local safety layer blocked sending payloads derived from the
private FIRE artifacts to OpenRouter. Therefore the evidence level is:

```text
synthetic Jev capability          PASS
historical failure-class match    PASS
historical causal Jev replay      NOT RUN
```

Do not later rewrite this as "Jev proved it catches FIRE_EXACT_02 and
FIRE_NUANCE_02"; that claim has not been tested.

### Status

`TECHNICALLY PROMISING / PRODUCTION HOLD`.

The only Jev role with distinct potential value is answer-level semantic
verification of `entailed?` and `complete?` after bounded evidence acquisition.
Current FIRE production is already accepted, so adding a second semantic call
would require a new qualification and must first demonstrate causal benefit on
current Core Lookup failures.

## DevSpace pre-execution semantic safety gate

This was the strongest DevSpace-specific Jev use case tested.

The intended architecture is not "Jev decides security". The Host continues to
own authentication, authorization, path containment, hard destructive rules,
credential handling, and production policy. Jev is only considered for the
residual semantic question:

> Does this proposed action actually match the user's stated intent and scope?

### First suite with Host-derived hint fields

36 synthetic action cases (12 ALLOW / 12 ASK / 12 DENY) produced:

- `36/36` direct-choice accuracy
- `0` dangerous false-ALLOW
- P50 latency about `0.346 s`
- P95 latency about `0.419 s`
- cost about `$0.00095991`

This suite was intentionally judged too easy because fields such as
`matches_user_request` and `outside_requested_scope` effectively precomputed
part of the answer.

### Harder semantic-boundary suite

A follow-up removed those hint fields and tested only bounded action semantics
such as environment, read/write mode, selected-vs-all scope, generated-vs-source
target, inactive-vs-active state, and persistence ambiguity.

Results on 24 cases:

- accuracy: `22/24 = 91.7%`
- all explicit ALLOW cases correct: `9/9`
- all explicit BLOCK cases correct: `9/9`
- ASK cases: `4/6`; two underspecified requests were incorrectly allowed
- dangerous false-ALLOWs were both low confidence: `0.52` and `0.60`
- every true ALLOW had confidence at least `0.88`
- P50 latency: about `0.315 s`
- P95 latency: about `0.457 s`
- total cost: about `$0.00046981`

This creates a useful provisional operating margin:

```text
false ALLOW max confidence = 0.60
true ALLOW min confidence  = 0.88
```

A conservative future shadow policy may therefore be tested as:

```text
Jev == ALLOW and confidence >= 0.80 -> eligible for execution
otherwise                           -> ASK / no execution
```

`0.80` is NOT a production-calibrated constant. A later paraphrase robustness
attempt was blocked by the local safety layer, so this threshold is only a
candidate for further shadow validation.

### Status

`PROMISING`.

Unlike the review gate, this can supply a genuinely non-redundant semantic
function: detecting an action that is syntactically permitted but semantically
outside the user's requested boundary.

## Safety-layer effects on evidence quality

The local safety layer did not modify successful Jev responses. Numbers from
executed API calls are real model results.

It did prevent some high-value real-data replays, especially:

- real DevSpace tool-output context admission
- some metadata derived from private repository output
- historical FIRE Jev replay, even after local anonymization
- some follow-up paraphrase/calibration attempts

Therefore distinguish these evidence classes in future work:

1. `EXECUTED SYNTHETIC` — real Jev call on synthetic/non-sensitive input.
2. `LOCAL HISTORICAL MATCH` — real historical artifact analyzed locally, but
   not replayed through Jev.
3. `REAL REPLAY` — Jev actually evaluated a frozen real artifact.

Never promote class 2 evidence into class 3 in documentation or acceptance.

## External implementation evidence reviewed on 2026-09-19

The local experiments above were supplemented with a review of public Jev
applications and two concrete Computer Use integrations. These are external
architecture observations, not local production acceptance evidence.

### OpenRouter Jev usage pattern

The public OpenRouter Jev 1.13 app list showed several very large workloads,
including benchmark/classification apps and Jev-centric tagger/classifier apps.
The exact ranking is time-sensitive and only covers public apps that participate
in OpenRouter usage tracking, so token counts should not be treated as a global
market-share ranking.

The more useful architectural observation is the repeated workload shape:

```text
many incoming items
        ↓
same bounded schema
        ↓
Jev Choice / Noul / Score
        ↓
deterministic routing / tagging / escalation
```

This reinforces a key selection criterion that was not explicit in the first
version of this document: Jev is most compelling when the *same semantic
decision is repeated at high volume*. A single difficult fuzzy question is a
weaker fit than thousands or millions of similarly shaped decisions that can be
calibrated against a frozen label contract.

This pattern directly supports PKD facet / relation classification more strongly
than generic DevSpace context filtering.

### Audit of the `servasyy_ai` Jev analysis

Source:

- `https://x.com/servasyy_ai/status/2101132667056185544`

The article was checked against TypeSafe material, OpenRouter, Jev public repos,
and the author's described experiment design.

Assessment:

- product/mechanism facts were generally accurate;
- its distinction between type-safe output and semantic correctness was sound;
- its caution around TypeSafe's vendor benchmark was justified;
- its `jev-ultrafast` discussion was broadly faithful to the repo's published
  measurements;
- the `217 projects -> 15 usable` claim was weak evidence because Jev itself
  supplied the classifications and there was no independent ground-truth audit;
- the 100-article / 300-judgment Chinese test was a useful engineering smoke
  test but not a statistical calibration study because the cases were generated
  from only 25 templates and the confidence bins were highly imbalanced;
- `high confidence -> high observed accuracy` demonstrated useful selective
  prediction / ranking, but did not establish probability calibration in the
  formal sense;
- the statement that confidence-based routing is Jev's *only* valuable use case
  was too broad. High-volume classification and bounded low-latency action
  selection are independently valuable patterns.

The article's final deployment method was nevertheless strong and agrees with
the local methodology here:

```text
identify a bounded decision
        ↓
freeze real historical data + human gold labels
        ↓
shadow replay
        ↓
measure coverage / error vs confidence
        ↓
start with a conservative threshold
        ↓
promote only after real-domain validation
```

Do not import any universal `0.90` threshold from that article. Thresholds must
be calibrated per task and per frozen model/version.

## External Computer Use implementations

### `Sac-Y/Jev-cu`

Source:

- `https://github.com/Sac-Y/Jev-cu`

Snapshot reviewed on 2026-09-19:

- created 2026-09-18;
- one repository commit at review time;
- approximately 41 GitHub stars / 4 forks at review time;
- 18 local unit/regression tests;
- 12 frozen P0 AX-selection fixtures across Calendar, Calculator, and
  NetEaseMusic.

Architecture:

```text
Codex high-level planner
        ↓
macOS AX accessibility state
        ↓
deterministic candidate ranking
        ↓
Jev: target / action / done / risk
        ↓
local policy gate
        ↓
Codex CUA executor
        ↓
re-observe / verify
```

This is best understood as a **Codex Computer Use fast lane**, not a replacement
for Codex planning. The code itself states the split plainly: Codex determines
what to do; Jev determines where to act.

#### Independent local P0 replay

The public 12-case P0 fixture was replayed independently using the repository's
own AX parsing, candidate selection, and question construction, with only the
transport changed to the already configured OpenRouter `typesafe/jev-1.13`.

Results:

- element selection: `12/12 PASS`;
- P50 Jev request latency: about `322 ms`;
- maximum observed request latency: `608 ms`;
- total input tokens: `29,625`;
- total cost: about `$0.00124425`.

Most target-choice confidence values were `0.98-1.00`; one Calculator
`evaluate expression` case scored `0.63` but still selected the correct target.

The repository's own unit suite was also run locally:

- `18/18 PASS`;
- no failures.

This establishes that the core mechanism — bounded AX text -> Jev target
selection — is real and reproducible on the supplied fixture.

It does **not** establish the author's marketing claim that this is the fastest
Codex Computer Use path or that it makes Codex `10x` faster. At review time the
repo contained no matched end-to-end A/B benchmark with task-success rate,
median/P95 latency, intervention rate, or token accounting. The public claim is
therefore unverified.

Other limitations observed:

- only text-accessible / AX-rich UI is in scope;
- canvas, image-layout, 3D, and weak-accessibility interfaces remain outside the
  demonstrated fast path;
- default `jev-latest` harms reproducibility unless pinned for qualification;
- candidate clipping and app/task heuristics can omit targets on dense trees;
- text/AX labels can still contain private content; URL stripping is not a
  privacy sanitizer;
- the repo had package-level ISC metadata but no explicit repository LICENSE
  file at review time, so direct code reuse should confirm licensing first.

Disposition: **architecture PASS / early prototype / performance claim not yet
proven**.

### Cline `plugins/jev-browser`

Source:

- `https://github.com/cline/plugins/tree/main/plugins/jev-browser`

Snapshot reviewed on 2026-09-19:

- merged as one plugin commit on 2026-09-18;
- package version `0.2.2`;
- MIT licensed;
- six test files covering setup, credentials, IPC, Jev behavior, navigation
  observation, and plugin integration.

This implementation is materially different from `Jev-cu`.

Architecture:

```text
Cline delegates one bounded browser goal
        ↓
isolated Playwright Chromium runtime
        ↓
structured DOM observation
        ↓
Jev chooses one combined operation+target
        ↓
Playwright executes
        ↓
DOM is re-observed
        ↓
repeat inside plugin
        ↓
DONE / REVIEW / BLOCKED
        ↓
Cline independently verifies final screenshot
```

Unlike `Jev-cu`, the frontier model is largely removed from the repeated inner
loop. The main Cline agent defines the bounded goal and verifies the outcome;
Jev performs the repeated navigation decisions inside the plugin runtime.

The decision schema is also cleaner than independent target/action questions.
Each offered choice represents a complete action such as:

```text
CLICK:<target>
TYPE_TEXT:<target>
SELECT:<target>
SCROLL_UP
SCROLL_DOWN
WAIT
DONE
REVIEW
BLOCKED
```

All options compete in one Choice distribution. This reduces the possibility of
independently selecting an incompatible action and target.

Jev cannot generate arbitrary field text. When Jev selects `TYPE_TEXT`, the
plugin delegates field-value generation to a small text model (default Gemini
2.5 Flash-Lite), keeping the navigation loop cheap while retaining generative
capability when necessary.

The browser implementation has a much richer state representation than
`Jev-cu`'s current AX fast path:

- up to 200 action targets;
- up to 6,000 visible text characters;
- selected form state;
- offscreen control summaries;
- target role / selected / checked / expanded / current-value metadata;
- ten-action short-term history;
- stale-observation and no-progress handling.

Security is split differently:

- strong isolation: dedicated Chromium, no inherited host environment,
  extensions disabled, downloads blocked, navigation allowlists available;
- `REVIEW` is still model guidance, not a deterministic security authority;
- Cline tool approval is expected to remain enabled for consequential work;
- page text and visible field values are sent through Vercel AI Gateway; only
  password/file fields are excluded automatically, so authenticated/private
  pages still have a data-governance boundary.

Completion is deliberately reported as `done_unverified`: the Jev loop may say
the goal is complete, but the main Cline agent must independently inspect the
final screenshot. This is a strong contract and should be preferred over
treating semantic `DONE` as proof.

The README explicitly states that actual end-to-end speed and live-model
reliability have **not** been benchmarked. Therefore this repo is stronger
architectural evidence than performance evidence.

Disposition: **strong architecture reference / early implementation / no
end-to-end performance claim yet**.

## Revised Jev architecture patterns

The external Computer Use implementations expose two distinct patterns that
should no longer be conflated.

### Pattern A — semantic gate inside an existing Host loop

```text
Host state / proposed action
        ↓
bounded semantic judgment
        ↓
Jev
        ↓
Host policy: allow / ask / escalate
```

Examples:

- PKD facet / relation classification;
- DevSpace pre-execution intent/scope safety gate;
- FIRE answer-level entailment/completeness verification.

This pattern is appropriate when the Host still owns the workflow and one
specific semantic ambiguity cannot be reduced to deterministic logic.

### Pattern B — delegate an entire bounded repetitive inner loop

```text
frontier model / Host
        ↓
define one closed-world goal + success contract
        ↓
Jev micro-runtime
    observe
    choose
    act
    observe
    choose
    ...
        ↓
stop / review / blocked
        ↓
Host independently verifies
```

The Cline browser plugin is the clearest reviewed example of this pattern.

This pattern may produce a much larger latency and token benefit than inserting
Jev as one extra gate in a frontier-model loop, because it removes repeated
frontier-model round trips rather than merely accelerating one judgment.

The first-principles requirement is that the delegated subtask must be a true
closed world:

- bounded state representation;
- bounded legal actions;
- explicit stop / review / uncertainty exits;
- no need for open-ended synthesis on every step;
- deterministic executor and observation layer;
- independent final verification by the Host/frontier model;
- acceptable privacy boundary for the delegated state.

This is a stronger formulation of the original rule in this document: Jev's
largest value may come not from adding another decision to an existing agent,
but from **removing an entire repetitive decision loop from the frontier model**.

## Current disposition by use case

| Use case | Disposition |
| --- | --- |
| PKD facet / NEW detection | PROMISING |
| PKD relation / evidence verification | PROMISING; not yet formally qualified |
| DevSpace context admission | NO-GO |
| DevSpace bounded review gate | Technically works, but redundant |
| DevSpace pre-execution semantic safety gate | PROMISING |
| Bounded delegated inner-loop runtime | PROMISING; strongest external pattern |
| FIRE entailment / completeness | Technically promising; production HOLD |
| FIRE literal equality | Prefer deterministic Host |
| FIRE source authority | Prefer deterministic Host |
| FIRE ABSENT | Prefer deterministic Host |
| Model routing | Do not add; current deterministic role split is clearer |

## Architecture rule for future Jev work

For isolated semantic judgments, the strongest reusable pattern remains:

```text
deterministic Host acquisition / hard policy
                  ↓
          bounded semantic state
                  ↓
                 Jev
                  ↓
        confidence-gated Host policy
                  ↓
        action / ask / escalation
```

Good Jev candidates should satisfy all of the following:

1. The question is genuinely semantic rather than a deterministic comparison.
2. The state can be bounded without destroying the information needed for the
   decision.
3. The data is non-sensitive or explicitly approved for the configured
   external provider.
4. The answer space is closed or tightly constrained.
5. A low-confidence or ambiguous result can fail closed to ASK / human /
   stronger reasoning rather than silently proceeding.
6. Jev removes a real human/frontier-model decision instead of duplicating
   existing Host logic.
7. Prefer workloads where the same question/schema repeats often enough to
   justify calibration and confidence/coverage measurement.

For agentic workflows, add a second question before inserting Jev as another
gate:

> Can the entire repeated inner loop be expressed as a closed-world runtime and
> delegated away from the frontier model instead?

If yes, Pattern B should be tested before adding multiple per-step semantic
hooks. The potential gain is larger because frontier-model round trips are
removed, not merely supplemented.

The current strongest candidates are therefore:

- PKD source-local facet / relation decisions;
- DevSpace pre-execution semantic intent/scope safety gating;
- future closed-world browser/GUI or other deterministic subtask runtimes where
  a Jev inner loop can replace repeated frontier-model decisions and the Host
  retains final verification.

## Repository impact of these experiments

All Jev qualification work above was shadow/testing work. No production
integration was performed as part of these experiments.

