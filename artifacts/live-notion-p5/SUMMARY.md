# D2-P5 live map/switch — PASS

- Gateway: `https://car-care-notion-sync-d1-test.spf-roc.workers.dev`
- keyFp: `91dee0d48d59` · workspaceKeyFp: `c647ac0368ff`
- Unit: **336 passed** / 5 skipped (incl. 16 new `notion-d2-p5` tests)
- `tsc -p tsconfig.app.json --noEmit`: clean

## Steps (live)

- **G1_verify**: PASS
- **CREATE**: PASS
- **PULL_ALIVE**: PASS
- **DEL1_DELETE_PUSH**: PASS
- **DEL1_PULL_TOMBSTONE**: PASS (pull tombstone and/or delete applied; KV-backed)
- **DEL2_NO_RECREATE**: PASS (`skipped_deleted`)
- **DEL3_RESTORE_PUSH** / **DEL3_PULL_ALIVE**: PASS
- **SW_NOTE**: SW1–SW4 covered by unit (`notion-d2-p5.test.ts`); single d1-test workspaceKey cannot dual-tenant live

## What landed (code)

- IDB v5 `sync_notion_map` + `src/sync/notionMap.ts`
- Switch corridor `src/sync/switchCorridor.ts` (park retain / block / SW3 discard)
- Outbox orphan isolation helpers; Notion verify uses **park** mode
- Minimal settings panel「未推送（旧工作区）」
- Hard-delete → persistent tombstone; upsert enqueue blocked when tombstoned

## Hard bans

- No PWA deploy to car-test / car.adobesun.com
- No formal Supabase changes
- d1-test ≠ production Gateway
- No secrets in git/artifacts (fingerprints only)
- Do NOT merge until independent review
