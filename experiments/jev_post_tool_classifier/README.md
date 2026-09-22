# DS-J3 — Jev post-tool failure classifier

Historical replay over real macOS DevSpace operational/tool failures.

Scope:

- fixed-formulation Jev Choice only;
- no production routing changes;
- no JevHarness optimization;
- gold labels are stored locally but are not included in model state;
- only minimal faithful error evidence is sent to Jev; user paths/IPs/secrets are excluded.

Classes:

- `TRANSIENT`
- `ENVIRONMENT`
- `CODE_BUG`
- `PERMISSION`
- `USER_ERROR`
- `UNKNOWN`

The pilot intentionally has no real `PERMISSION` gold case. It must not be used
to claim permission-class qualification.

