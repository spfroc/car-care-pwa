# D2-P4 live Notion ★F + D2.6

- **Status**: PASS
- **Reason**: D2.6 live reject + ★F cloud_newer/keep_local LWW
- **Gateway**: `https://car-care-notion-sync-d1-test.spf-roc.workers.dev` (dev `*-d1-test` only — not production)
- **Key fingerprint**: `91dee0d48d59` (sha256-12; raw key never stored)
- **Workspace fingerprint**: `c647ac0368ff`
- **Started**: 2026-10-14 15:32:22 CST
- **Ended**: 2026-10-14 15:32:30 CST

## Gates (plan §4.2 ★F · hard gate D2.6)

| Gate | Result |
|------|--------|
| G1 verify | PASS |
| D2.6 media/stations/settings reject (live Worker) | PASS |
| ★F cloud_newer + keep_local LWW | PASS |

## Notes

- D2.6 **live PASS**: redeployed `car-care-notion-sync-d1-test` with `unsupported_entity` whitelist; probes reject media/stations/settings (not applied).
- ★F: Gateway returns `cloud_newer` (non-ACK) with cloudRow; keep_local proven via LWW bump applied. M3-C open/keep_local/take_cloud (lock-held) covered by `src/sync/notion-d2-p4.test.ts`.
- Unit suite: 320 passed (see `unit-test.log`).
- Hard bans observed: no PWA deploy to car-test/prod; no formal Supabase changes; no secrets in git; d1-test ≠ production Gateway.

See `matrix.json` for step detail (**no secrets**).
