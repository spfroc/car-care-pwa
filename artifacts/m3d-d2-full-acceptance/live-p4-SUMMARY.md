# D2-P4 live Notion ★F + D2.6

- **Status**: PASS
- **Gateway**: `https://car-care-notion-sync-d1-test.spf-roc.workers.dev` (dev `*-d1-test` only — not production)
- **Key fingerprint**: `91dee0d48d59` (sha256-12)
- **Started**: 2026-10-14T08:01:19.904Z → **Ended**: 2026-10-14T08:01:25.490Z (UTC; box CST=UTC+8)

## Gates

| Gate | Result |
|------|--------|
| G1 verify | PASS |
| D2.6 media/stations/settings reject | PASS |
| ★F cloud_newer + keep_local LWW | PASS |

## Notes

- D2.6: Worker redeployed with unsupported_entity whitelist (media/stations/settings).
- ★F: Gateway returns cloud_newer (non-ACK); keep_local path proven via LWW bump applied.
- M3-C open/keep_local/take_cloud lock-held UX covered by unit notion-d2-p4.test.ts.
- d1-test is DEV only — not production Gateway. No PWA deploy.

See `matrix.json` (**no secrets**).
