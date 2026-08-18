# @bpc-oss/dsh-eval-core

Read-only eval core for DeepSeek Harness, ported from Bobby's eval core according
to the v11.2 master plan (P1-3).

## Scope

- `EvalTaskCase` schema with workspace seed, file/command oracles, and a
  lightweight task contract. **No trust field in the schema** — trust is
  injected by the loader.
- `EvalSubject` abstraction:
  - `MockEvalSubject` — deterministic in-memory runner for CI.
  - `DshEvalSubject` — live DSH host wrapper around `ctx.agents.create()` +
    `agent.followup()` + `agent.whenIdle()`.
- `CommandOracleExecutor` seam:
  - `DisabledCommandOracleExecutor` (rc.6 default, refuses before spawn)
  - `MockCommandOracleExecutor` (deterministic CI mock)
  - container/microVM implementations are intentionally unavailable until
    network/process/memory boundaries are provable.
- `loadEvalFixturePack` injects `builtin` / `allowlisted` / `untrusted`
  trust levels and rejects fixture-declared `trusted` / `trustLevel`.
- scorecard / matrix / markdown+JSON report.
- read-only `CandidateManifest` (schemaVersion 1, `readOnly: true`).
- `dsh-eval` CLI: `run`, `score`, `manifest`.

## CLI

```bash
# Run a single mock config
dsh-eval run --fixtures ./fixtures --config ./configs/mock.json --out report.json

# Score a matrix over all configs in a directory
dsh-eval score --fixtures ./fixtures --configs ./configs --out matrix.json

# Build a read-only candidate manifest
dsh-eval manifest --fixtures ./fixtures --configs ./configs --out manifest.json
```

For live DSH runs, inject a host module:

```bash
dsh-eval run --fixtures ./fixtures --config ./configs/live.json --mode live --host ./dsh-host.mjs
```

The host module must export an object with `create(options)` matching
`DshAgentHost`.

## Tests

```bash
pnpm --filter @bpc-oss/dsh-eval-core test
pnpm --filter @bpc-oss/dsh-eval-core typecheck
pnpm --filter @bpc-oss/dsh-eval-core build
```
