# Jev DevSpace Post-Tool Failure Classifier — Historical Replay Result — 2026-09-22

## Status

```text
DS-J3 fixed-formulation historical pilot: COMPLETE
production integration: HOLD / NO CURRENT INCREMENTAL VALUE
```

This experiment was started only after reading the current cross-project authority:

```text
/Users/xanth/Github/project-registry
```

The registry confirms that this work is platform experimentation, not product-repo
development. It was performed in the DevSpace source checkout on macOS, did not
modify production routing/runtime, did not use Windows, and does not interfere
with the ongoing product-repository convergence work.

## Question

Can Jev classify an observed DevSpace tool/runtime failure into a bounded recovery
class cheaply and safely enough to remove frontier-model reasoning?

Classes:

```text
TRANSIENT
ENVIRONMENT
CODE_BUG
PERMISSION
USER_ERROR
UNKNOWN
```

Potential Host actions were intentionally outside Jev, e.g. retry transient
failures, inspect environment failures, return code bugs to a worker, correct
user/tool invocation mistakes, and escalate UNKNOWN.

## Real historical dataset

The frozen pilot contains 16 independent incidents from actual macOS DevSpace
operational logs:

```text
USER_ERROR   7
TRANSIENT    5
ENVIRONMENT  1
CODE_BUG     1
UNKNOWN      2
PERMISSION   0
```

Sources:

- `launchagent.stderr.log` — failed real tool reads and the runtime trust-proxy
  validation failure;
- Cloudflare canary `cloudflared.stderr.log` — real tunnel/origin failures;
- `agentd.log` — real provider-execution failures whose causes were not preserved
  sufficiently to classify safely.

Only a minimal faithful decision-time condensation was sent to Jev. User paths,
IPs and unrelated log data were excluded. Gold labels and provenance were not sent.

There is **no real permission-denied gold case**, so this pilot provides no
permission-class qualification evidence.

## Rejected first run

The initial run accidentally included post-event recovery facts for transient
Cloudflare incidents (for example that a connection subsequently retried and
recovered). That is outcome leakage because the recovery classifier would not
know the future outcome at decision time.

That result was rejected before interpretation. The accepted v2 dataset removes
all such follow-up facts and contains decision-time evidence only.

## Accepted Jev result

Configuration:

```text
model: jev-1.13.0
independent cases: 16
repeats: 10
total decisions: 160
gold sent to model: false
```

Result:

```text
exact accuracy:              160 / 160 = 100%
unsafe auto-retry:             0 / 160
unnecessary source-edit:       0 / 160
missed transient:              0 / 50
UNKNOWN decisions:            20 / 160 = 12.5%
```

The 20 UNKNOWN decisions are exactly the two gold-UNKNOWN provider failures
repeated ten times each; Jev did not hallucinate a more specific cause from the
generic `PROVIDER_EXECUTION_ERROR` evidence.

Approximate batch latency:

```text
p50: ~766 ms
range: ~732-820 ms
```

Each request contained all 16 independent classification questions.

Observed Jev confidence was generally high for obvious error families. The only
notably softer correct classification was the trust-proxy source/config defect,
where CODE_BUG confidence averaged about `0.60`.

## Deterministic baseline

Before assigning value to the perfect Jev result, the same frozen incidents were
classified with a small Host rule set using only decision-time error
codes/messages and tool/component identity.

Examples:

```text
read + ENOENT/EISDIR/beyond-EOF       -> USER_ERROR
network timeout/no-route/no-buffer    -> TRANSIENT
cloudflared local-origin ECONNREFUSED -> ENVIRONMENT
ERR_ERL_PERMISSIVE_TRUST_PROXY        -> CODE_BUG
otherwise                             -> UNKNOWN
```

Result:

```text
16 / 16 = 100%
```

This baseline is intentionally small and is not claimed as a universally complete
failure taxonomy. Its purpose is to test incremental value on the actual pilot
cases.

## Interpretation

The Jev primitive clearly has signal for this bounded task. However, the current
historical incidents are dominated by structured operating-system/tool/provider
errors whose recovery class is already encoded in stable error strings/codes.

Therefore:

> The pilot demonstrates Jev capability, but **does not demonstrate Jev value**.

Adding an external semantic decision call to errors the Host can classify exactly
would increase latency, dependencies and failure surface without removing useful
frontier-model work.

The result also reinforces the portfolio stop rule:

```text
if deterministic Host logic already knows the answer, do not add Jev
```

## Disposition

```text
broad DevSpace post-tool failure classifier:
  Jev capability       PASS on pilot
  incremental value    NOT DEMONSTRATED
  production routing   HOLD / DO NOT INTEGRATE
```

Do not expand the dataset with synthetic permission/error fixtures merely to make
the taxonomy look complete.

Reopen DS-J3 only when real historical failures accumulate where:

1. deterministic error-code/message rules cannot safely choose a recovery class;
2. the evidence available at decision time is genuinely semantic/ambiguous;
3. frontier reasoning is currently being spent on the classification; and
4. there is independent outcome evidence for the correct recovery class.

Those ambiguous cases should be evaluated as a separate residual classifier,
after deterministic known-error handling, not as a replacement for it.

## Artifacts

```text
experiments/jev_post_tool_classifier/replay.py
experiments/jev_post_tool_classifier/result-20260922-v2.json
experiments/jev_post_tool_classifier/baseline.py
experiments/jev_post_tool_classifier/baseline-20260922.json
```

