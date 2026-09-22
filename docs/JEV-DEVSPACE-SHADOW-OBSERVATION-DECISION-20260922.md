# Jev DevSpace Shadow Observation Decision — 2026-09-22

## Decision

```text
Jev runtime authority:        NO
Jev instruction pruning:      NO
Jev shadow observer:          YES
production worker context:    unchanged / full current context
```

The purpose of the shadow observer is not to prove again that Jev can classify
instruction relevance. Historical qualification already established that
capability. The remaining question is whether Jev produces **incremental useful
semantic decisions on the user's real DevSpace workload** that justify adding
it to the runtime architecture.

This decision refines the earlier DS-J1 conclusion. A small hand-authored
deterministic router matched or exceeded Jev on the current three large optional
skills, but that comparison measured runtime classification quality only. It did
not measure the human lifecycle cost of authoring and maintaining deterministic
rules.

Therefore the current position is:

> deterministic routing is sufficient for authority today, but Jev remains
> worth observing in shadow because it may remove human routing-maintenance work
> or reveal semantic residual cases that the hand-authored router misses.

---

## 1. What is being shadowed

Only the current large optional global skills:

```text
AGENT_REACH
EGO_BROWSER
BEST_MINDS
```

Do not shadow-gate the following because their current economics do not justify
a semantic decision:

```text
ROUTING
SUBAGENTS
small repo-local AGENTS/core fragments
```

The normal DevSpace path remains authoritative:

```text
real task
  -> existing Host / deterministic routing
  -> normal full instruction context
  -> worker / tool execution
```

In parallel, Jev computes only a shadow opinion:

```text
same real task
  -> one bounded Jev batch
  -> AGENT_REACH: INCLUDE / UNCERTAIN / EXCLUDE
  -> EGO_BROWSER: INCLUDE / UNCERTAIN / EXCLUDE
  -> BEST_MINDS:  INCLUDE / UNCERTAIN / EXCLUDE
  -> record only
```

Jev failure, timeout, rate limit, model drift or disagreement must never block
or alter the real task while this mode is active.

---

## 2. What should be recorded

For each real task:

- task identity / stable hash;
- candidate skill descriptor hashes;
- deterministic Host decision;
- Jev decision and confidence;
- whether the two paths agree;
- shadow would-load / would-skip set;
- actual skill/instruction characters or provider tokens if observable;
- Jev request latency and request usage;
- actual worker/tool path taken;
- task completion / correction / retry evidence where available.

The first-order analysis should be **disagreement driven**. Do not manually
score every task.

Classify only meaningful disagreements:

```text
JEV_VALUE
  Jev correctly includes a skill the deterministic path would have missed.

JEV_SAVING
  Jev correctly excludes a large skill that deterministic routing would have
  loaded and that was not materially needed.

JEV_FALSE_INCLUDE
  Jev adds context without material need.

JEV_FALSE_EXCLUDE
  Jev would have removed a materially required skill.

NO_MATERIAL_DIFFERENCE
  The disagreement has no meaningful workflow/context consequence.
```

Human intervention should be reserved for cases where actual downstream traces
do not establish whether the skill was materially required.

---

## 3. How value is judged

Do not use raw Jev accuracy as the success criterion.

The relevant quantity is incremental system value:

```text
useful semantic deltas
  = JEV_VALUE + meaningful JEV_SAVING

cost
  = false decisions
  + API/runtime dependency
  + request latency
  + maintenance / requalification burden
```

The shadow experiment is successful only if useful semantic deltas recur often
enough to justify those costs.

If deterministic and Jev decisions almost always agree, that itself is evidence
that Jev adds little information and should be removed.

If disagreements occur but the deterministic path is almost always correct,
remove Jev.

If Jev repeatedly captures a small residual class of genuinely useful semantic
cases, the eventual production architecture should be considered as:

```text
deterministic fast path
        -> ambiguous residual only
        -> Jev
```

not as a universal per-task Jev dependency.

---

## 4. Stop / promotion criteria

Do not use a fixed number of calendar days as the main criterion.

Evidence should accumulate until one of these conditions becomes clear:

1. many real tasks occur with almost no meaningful disagreement -> remove Jev;
2. enough disagreements accumulate and deterministic wins overwhelmingly ->
   remove Jev;
3. Jev repeatedly provides useful semantic residual decisions with no observed
   dangerous false exclusion -> design a bounded live A/B;
4. shadow operational cost itself is material relative to any theoretical
   context saving -> remove Jev.

No production context omission is authorized by this document.

---

## 5. Relationship to DS-J1 historical qualification

Historical DS-J1 established:

- Jev has genuine instruction-relevance semantic capability;
- a broad deterministic router misses semantic relationships;
- a simplified hand-authored router can match or beat Jev on the current three
  optional skills;
- the simplified deterministic solution is not automatic and carries human
  authoring/maintenance cost that the historical benchmark did not measure.

The shadow observer exists specifically to resolve this final lifecycle question
using real future workload instead of another synthetic/historical benchmark.

Canonical historical report:

`docs/JEV-DEVSPACE-INSTRUCTION-ADMISSION-RESULT-20260922.md`

