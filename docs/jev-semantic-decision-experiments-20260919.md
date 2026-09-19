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

## Current disposition by use case

| Use case | Disposition |
| --- | --- |
| PKD facet / NEW detection | PROMISING |
| PKD relation / evidence verification | PROMISING; not yet formally qualified |
| DevSpace context admission | NO-GO |
| DevSpace bounded review gate | Technically works, but redundant |
| DevSpace pre-execution semantic safety gate | PROMISING |
| FIRE entailment / completeness | Technically promising; production HOLD |
| FIRE literal equality | Prefer deterministic Host |
| FIRE source authority | Prefer deterministic Host |
| FIRE ABSENT | Prefer deterministic Host |
| Model routing | Do not add; current deterministic role split is clearer |

## Architecture rule for future Jev work

The strongest reusable pattern is:

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

The current two strongest candidates are therefore:

- PKD source-local facet / relation decisions;
- DevSpace pre-execution semantic intent/scope safety gating.

## Repository impact of these experiments

All Jev qualification work above was shadow/testing work. No production
integration was performed as part of these experiments.

