# Jev completion-verifier historical replay

Purpose: evaluate whether a bounded Jev verifier can distinguish genuinely
complete coding checkpoints from checkpoints that looked complete to ordinary
deterministic checks but were later shown to have material semantic omissions.

This is an internal historical replay, not a production integration.

Ground truth comes from later independent review / accepted closure artifacts.
Ground-truth labels are never included in the TypeSafe request payload.

Two evidence modes are compared:

- `sparse`: task contract + tests/build/artifact evidence available at the
  checkpoint;
- `enriched`: the same evidence plus bounded deterministic code/diff facts that
  a Host could extract without knowing the later review disposition.

Primary risk metric: false FINISH on historically incomplete checkpoints.

