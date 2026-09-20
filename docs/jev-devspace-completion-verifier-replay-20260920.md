# Jev DevSpace Completion Verifier Historical Replay — 2026-09-20

## Status

Internal pilot only. Not production-qualified.

Goal:

> Test whether a bounded Jev verifier can prevent a coding worker from stopping
> at `DONE` when deterministic checks look healthy but material semantic or
> methodology obligations are still incomplete.

The replay follows the previously recorded Pattern C2 design:

```text
worker claims DONE
        ↓
task contract + observable evidence
        ↓
Jev completion verifier
        ↓
FINISH / CONTINUE / VERIFY
```

Primary risk metric: false `FINISH` on historically incomplete checkpoints.

---

## 1. Frozen historical cases

Five real PKD Phase 2 checkpoints were used.

### Authentic worker-DONE claims

1. `6c57fe9` — Claude explicitly reported implementation complete and committed.
   Later Codex review found material P1 defects in blind adjudication,
   structured-output classification and retry accounting. Gold: **incomplete**.

2. `5f06f8e` — Claude explicitly reported implementation complete, `C1-C7 all
   CLOSED`, and R1-R28 all PASS. Later Astra closure review found
   `P0=0 / P1=6 / P2=2 — NOT READY`. Gold: **incomplete**.

### Auxiliary checkpoints

3. `821bf38` — host had verified `481/481 PASS`; later independent Astra final
   closure review still found `P0=0 / P1=6 / P2=1 — NOT READY`. Gold:
   **incomplete**.

4. `02f7f0d` — final methodology binding; Phase 2 suite `153/153`, full offline
   suite `490/490`, bounded independent review `READY for owner live
   authorization`. Gold: **complete for its bounded task**.

5. `f9e0c5c` — official Phase 2 closure; official qualifier produced `GO`, no
   refusal/no-go/unsatisfied conditions, regression suite `153 passed`. Gold:
   **complete for its bounded task**.

Ground-truth labels were never included in TypeSafe request state.

The authentic-DONE subset is the primary evidence. Auxiliary checkpoints are
reported separately because they are not preserved local-agent `DONE` claims.

---

## 2. Evidence modes

### Sparse

Evidence available from the completion checkpoint itself:

- task contract;
- tests/build results;
- artifact existence;
- worker completion report / checkpoint facts;
- live-call / frozen-artifact status.

No later reviewer finding was included.

### Enriched / oracle-like upper bound

The same sparse evidence plus relevant deterministic code facts.

Important limitation:

> The enriched facts were selected after the historical reviewer findings were
> known. The facts themselves do not contain the reviewer verdict, but their
> selection is label-informed.

Therefore enriched results are an **oracle-like upper bound** for the semantic
decision stage, not evidence that a live Host can acquire the right facts
without already knowing where to look.

---

## 3. Noul formulation

Each case received three independent Noul questions:

```text
all material requirements satisfied?
evidence sufficient to allow finish?
material obligation omitted / unproven / incorrect?
```

Ten identical repeats were run in each evidence mode.

Official endpoint/model:

```text
https://api.typesafe.ai/v1/systemone
jev-1.13.0
```

Five cases and all three questions were batched into every request.

### Sparse mean scores

| case | gold | satisfied | evidence sufficient | material omission |
| --- | --- | ---: | ---: | ---: |
| 6c57fe9 | incomplete | 0.405 | 0.428 | 0.492 |
| 5f06f8e | incomplete | 0.318 | 0.233 | 0.622 |
| 821bf38 | incomplete | 0.241 | 0.236 | 0.542 |
| 02f7f0d | complete | 0.449 | 0.435 | 0.232 |
| f9e0c5c | complete | 0.620 | 0.431 | 0.433 |

The first-pass Host policy used one shared threshold:

```text
FINISH if:
  satisfied >= t
  AND evidence_sufficient >= t
  AND material_omission <= 1-t
```

For every tested `t = 0.50 ... 0.95`, this policy produced:

```text
false FINISH on incomplete: 0%
false reject on complete:   100%
```

This is not useful. The policy never allows completion.

Root cause is mainly the `evidence_sufficient` Noul, which remains only around
`0.35-0.44` even on historically complete checkpoints.

Conclusion:

> Raw Noul values are not calibrated enough for a generic high-threshold
> completion policy, and the stricter three-obligation AND rule collapses into
> permanent conservatism.

### Enriched Noul separation

With oracle-like relevant code facts, incomplete checkpoints moved sharply:

```text
incomplete satisfied:         0.063-0.191
incomplete material omission: 0.848-0.938

complete satisfied:           0.501-0.615
complete material omission:   0.328-0.494
```

This shows Jev can map strong relevant semantic evidence into the expected
direction. It does **not** prove the full verifier architecture works, because
the hard problem has shifted to acquiring the correct evidence.

---

## 4. Choice formulation

The same frozen cases were then asked one bounded control question:

```text
FINISH
CONTINUE
VERIFY
```

Definitions:

```text
FINISH   = all material obligations demonstrated; stop is justified
CONTINUE = material obligation missing/incorrect/contradicted
VERIFY   = no material defect established, but evidence insufficient to stop
```

Sparse and enriched modes were each repeated ten times.

### Sparse Choice result

| case | gold | FINISH | CONTINUE | VERIFY |
| --- | --- | ---: | ---: | ---: |
| 6c57fe9 | incomplete | 0 | 0 | 10 |
| 5f06f8e | incomplete | 0 | 0 | 10 |
| 821bf38 | incomplete | 0 | 0 | 10 |
| 02f7f0d | complete | 1 | 0 | 9 |
| f9e0c5c | complete | 10 | 0 | 0 |

Aggregate:

```text
false FINISH on incomplete: 0 / 30 = 0%
non-FINISH on complete:     9 / 20 = 45%
```

Same-case stability:

- both authentic incomplete DONE claims: `VERIFY` 10/10;
- auxiliary incomplete checkpoint: `VERIFY` 10/10;
- official Phase 2 closure: `FINISH` 10/10;
- methodology-ready checkpoint: 1 FINISH / 9 VERIFY.

This is meaningfully better than the Noul threshold policy because `VERIFY` is
an explicit escalation rather than being forced into complete/incomplete.

However, the sparse verifier still did **not** identify `CONTINUE` on any
historically incomplete checkpoint. It merely refused to trust the available
evidence enough to finish.

That distinction matters:

> A conservative evidence gate is not the same thing as an independent semantic
> bug detector.

### Authentic DONE claims

Both authentic worker-DONE claims were refused `FINISH` in all 20 repeated
evaluations.

But both worker reports themselves explicitly stated that an independent review
gate remained open. Therefore these cases are not strong evidence that Jev
discovered a hidden omission; `VERIFY` is also the obvious action from the
declared process state.

### Enriched Choice result

With the oracle-like code facts:

```text
incomplete checkpoints: CONTINUE 30 / 30
complete checkpoints:   FINISH   20 / 20

false FINISH: 0%
false reject: 0%
```

This is a useful **upper-bound capability result only**.

It demonstrates:

> If the Host already surfaces the specific code facts relevant to the missing
> obligations, Jev can consistently map them to the correct bounded control
> action.

But it does not establish that Jev reduces total work, because selecting those
facts may require the same semantic investigation that the verifier is supposed
to save.

---

## 5. Latency / usage

Approximate P50 request latency:

```text
Noul sparse:     583 ms
Noul enriched:   571 ms
Choice sparse:   591 ms
Choice enriched: 578 ms
```

Input-token totals for ten requests per mode:

```text
Noul sparse:      22,240
Noul enriched:    27,980
Choice sparse:    24,890
Choice enriched:  30,630
```

Latency/cost are not the limiting factor.

---

## 6. Interpretation

### What passed

1. Jev is stable on these frozen completion-control questions.
2. Sparse Choice made zero false FINISH decisions on the historically
   incomplete checkpoints.
3. `FINISH / CONTINUE / VERIFY` is a better control abstraction than forcing raw
   Noul probabilities through one generic threshold.
4. With strong relevant evidence, Jev cleanly distinguishes complete vs
   incomplete checkpoints.

### What did not pass

1. Sparse Jev did not discover the historical semantic defects; it chose
   `VERIFY`, not `CONTINUE`.
2. One of two complete checkpoints was escalated to VERIFY in 9/10 repeats.
3. The authentic-DONE sample is only `N=2` independent tasks.
4. The perfect enriched result is methodologically contaminated by
   label-informed evidence selection and cannot support production promotion.

### First-principles conclusion

The main bottleneck is not the Jev decision primitive.

It is:

```text
task contract
      ↓
which concrete code/diff/runtime evidence is relevant to each obligation?
      ↓
semantic decision
```

Once the correct evidence has already been surfaced, Jev is capable and cheap.
But if the Host/frontier model must perform a semantic investigation to surface
that evidence, Jev may only duplicate the final judgment rather than remove
meaningful work.

This is the same architectural lesson observed in earlier DevSpace context and
review experiments: bounded judgment is easy after sufficient context has
already been selected; context/evidence acquisition is often the hard part.

---

## 7. Disposition

```text
DevSpace worker-DONE Jev verifier:
  standalone semantic completion detector   NOT QUALIFIED
  conservative VERIFY gate                  TECHNICALLY VIABLE, VALUE UNPROVEN
  enriched semantic action mapper           CAPABILITY PASS / EVIDENCE-ACQUISITION GAP
  production integration                    HOLD
```

Do not integrate it into the DevSpace production control plane now.

The next experiment should happen only if there is a cheap, deterministic or
already-required way to produce requirement-linked evidence without using a
frontier reviewer to rediscover the defect.

Candidate follow-up if such evidence becomes available:

```text
task obligations
→ deterministic requirement-to-file/symbol evidence extraction
→ Jev FINISH / CONTINUE / VERIFY
```

If requirement-linked evidence extraction itself needs substantial semantic
reasoning, stop: the architecture has not removed enough work to justify Jev.

---

## 8. Reproducibility

Harness:

```text
experiments/jev_completion_verifier/replay.py
experiments/jev_completion_verifier/replay_choice.py
```

Raw machine reports:

```text
experiments/jev_completion_verifier/result-20260920.json
experiments/jev_completion_verifier/result-choice-20260920.json
```

