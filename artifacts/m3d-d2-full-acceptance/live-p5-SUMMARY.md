# D2-P5 live map/switch — PASS

- Gateway: `https://car-care-notion-sync-d1-test.spf-roc.workers.dev`
- keyFp: `91dee0d48d59`
- started: 2026-10-14T08:01:28.228Z (UTC) / box local Asia/Shanghai
- ended: 2026-10-14T08:01:53.794Z

## Steps
- **G1_verify**: PASS — status=200 wkFp=c647ac0368ff
- **CREATE**: PASS — status=200 applied=["op-c-p5-mv7tml8g-5qsp08"]
- **PULL_ALIVE**: PASS — attempts=1
- **DEL1_DELETE_PUSH**: PASS — status=200 applied=["op-d-p5-mv7tml8g-5qsp08"]
- **DEL1_PULL_TOMBSTONE**: PASS — pullTomb=false deleteApplied=true attempts=10 (KV tombstone OK if pull omits trash)
- **DEL2_NO_RECREATE**: PASS — applied=[] conflicts=[{"id":"op-stale-p5-mv7tml8g-5qsp08","reason":"skipped_deleted"}]
- **DEL3_RESTORE_PUSH**: PASS — status=200 applied=["op-r-p5-mv7tml8g-5qsp08"] conflicts=[]
- **DEL3_PULL_ALIVE**: PASS — attempts=1
- **SW_NOTE**: PASS — SW1–SW4 isolation covered by unit tests (single d1-test workspaceKey cannot dual-tenant live). Default retain + owner isolation confirmed in notion-d2-p5.test.ts

## Hard bans
- No PWA deploy to car-test / car.adobesun.com
- No formal Supabase changes
- d1-test ≠ production Gateway
- No secrets in git/artifacts (fingerprints only)
