# D2-P3 live Notion matrix

- **Status**: PASS
- **Reason**: all required gates green
- **Gateway**: `https://car-care-notion-sync-d1-test.spf-roc.workers.dev` (dev `*-d1-test` only — not production)
- **Key fingerprint**: `91dee0d48d59` (sha256-12; raw key never stored)
- **Started**: 2026-10-14 15:13:37 CST
- **Ended**: 2026-10-14 15:14:00 CST

## Gates (plan §4.2 / G1/G4)

| Gate | Result |
|------|--------|
| G1 verify | PASS |
| G4 live matrix | PASS |
| ★C create | PASS |
| ★U update same page | PASS |
| ★D delete + tombstone | PASS |
| ★R restore | PASS |
| ★T retry / skipped_deleted | PASS |
| D2.2 outbox flush | PASS |
| D2.3 pull visibility | PASS |
| D2.6 media not synced | PASS |

## Notes

- Live path: PWA Gateway client contract via HTTPS Bearer to test Worker (no Notion SDK / no Token in PWA).
- ★D uses push-side `skipped_deleted` as authoritative tombstone proof (CF KV **list** used by pull is eventually consistent).
- D2.6: PWA `isCloudEnqueueEnabled('media')===false` + `NotionGatewayClient` strips media before POST (unit). Worker `unsupported_entity` guard is in template source pending redeploy.
- ★F deferred to **D2-P4**. D2-P5 map/switch corridor optional.
- Unit suite: see `unit-test.log` (312 passed / 5 skipped).

See `matrix.json` for step detail (**no secrets**).
