# DS-J1 — Jev conditional instruction admission

Historical replay over real DevSpace/macOS engineering and research tasks.

This experiment tests only the first admission primitive:

```text
task + available instruction descriptor
    -> INCLUDE / UNCERTAIN / EXCLUDE
```

It does **not** test summary generation, irreversible context deletion, production
routing, or JevHarness optimization.

Runtime availability is respected:

- global skills are candidates for every task;
- DevSpace repo-local `AGENTS.md` sections are candidates only for tasks whose
  workspace is `xanthhuang/devspace`.

Gold labels and provenance are local evaluation metadata and are never sent to
Jev. `UNCERTAIN` is treated as INCLUDE for fail-safe admission metrics.

After the sealed replay, the prospective hybrid policy was frozen in
`hybrid_policy.json` before any Windows-derived fresh-validation cases were
selected. That policy always loads the small/core instructions and uses Jev only
for the large optional global skills `AGENT_REACH`, `EGO_BROWSER`, and
`BEST_MINDS`.

