# D2-P3 live Notion matrix

- **Status**: PASS
- **Reason**: all required live gates green
- **Gateway**: `https://car-care-notion-sync-d1-test.spf-roc.workers.dev` (dev `*-d1-test` only — not production)
- **Key fingerprint**: `91dee0d48d59` (sha256-12; raw key never stored)
- **Started**: 2026-10-14 16:00:48 CST
- **Ended**: 2026-10-14 16:01:16 CST

## Gates (plan §4.2 / G1/G4)

| Gate | Result |
|------|--------|
| G1 verify | PASS |
| G4 live matrix (required set) | PASS |
| ★C create | PASS |
| ★U update same page | PASS |
| ★D delete + tombstone | PASS |
| ★R restore | PASS |
| ★T retry / skipped_deleted | PASS |
| D2.2 outbox flush | PASS |
| D2.3 pull visibility | PASS |
| D2.6 media not synced | **unit-only + residual** (not live G4-required) |

## Notes

- Live path: PWA Gateway client contract via HTTPS Bearer to test Worker (no Notion SDK / no Token in PWA).
- ★D uses push-side `skipped_deleted` as authoritative tombstone proof (CF KV **list** used by pull is eventually consistent).
- D2.6: product gate = **unit** (`isCloudEnqueueEnabled('media')===false` + GatewayClient strip). Live Worker probe (gatewayApplied=false gatewayErrored=true workerRejects=true) — reject pending d1-test redeploy (Node≥22).
- ★T idempotent_delete_retry asserts applied ACK (noop_deleted/trash); removed always-true `(conflicts||[]).length >= 0`.
- ★F deferred to **D2-P4**. D2-P5 map/switch corridor optional.
- Unit suite: see `unit-test.log`.

See `matrix.json` for step detail (**no secrets**).
