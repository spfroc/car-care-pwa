# RR-WK Phase 2 accept · PASS

- Base: https://car-test.adobesun.com
- SHA: f3bb58a · bundle index-Ddi6Z1jp.js
- Failed: (none)

- **PASS** `preflight.gateways` — T=91dee0d48d59/wk=c647ac0368ff B=5d915911b54a/wk=db38e1e5a251 P=aa819deb16dc/wk=c647ac0368ff sameWkTP=true
- **PASS** `deploy.bundle` — stamp=git=f3bb58aceec53fea1c14f6959c3954259f6ff88d
bundle=index-Ddi6Z1jp.js
bundle_sha256=5e94997a82fb7353d44849283e02e2fd89aff638d13e2c1f0674f870cc3f7563
target=car-test.adobesun.com
built_at=2026-10-15T15:41:34+0800
phase=2-rr-wk
merge_sha=f3bb58aceec53fea1c14f6959c3954259f6ff88d
pr=24
 bundle=index-Ddi6Z1jp.js
- **PASS** `browser.bundle_loaded` — https://car-test.adobesun.com/assets/index-Ddi6Z1jp.js
- **PASS** `C.observe.enabled` — session=true guard=observe
- **PASS** `E1` — fp=91dee0d48d59 tid=90da532e-b363-42df-99eb-7ac75f6c12aa::91dee0d48d59
- **PASS** `C.observe.logs` — observeLogs=0 totalGuardLogs=0 guard=observe
- **PASS** `E4.setup_hold` — fp=91dee0d48d59 entityId=46b8aff7-a80b-4a35-aa4c-2a2dadfd76be
- **PASS** `E2` — sessionB=false holdRemains=true pushToB=0 bodyHasOrphan=true
- **PASS** `E3` — session=true holdGone=true push200=1
- **PASS** `E4.hold2` — fp=91dee0d48d59
- **PASS** `E4` — sessionP=true guard=true holdFp=91dee0d48d59 prodPush=0 attempted=true orphanHint=true keyFpP=aa819deb16dc
- **PASS** `C.enforce.enabled` — guard=enforce
- **PASS** `C.enforce.no_attested_ready_empty` — sessionCleared=true syncDisabled=true enfRowFp=91dee0d48d59
- **PASS** `E5` — outboxCount=1 e5Still=true sessionReady=false
- **PASS** `E6` — discarded=true e6Gone=true before=2 after=0
- **PASS** `E7` — heldDuringWrong=true wrongPush=0 rightPush=1 flushed=true
- **PASS** `E8` — session=true verify200=3 prodPushDelta=0 wkFp=c647ac0368ff
- **PASS** `E9` — still=true noFp=true pushes=0
- **PASS** `E.legacy_CLAIM` — claimUi=true claimed=true afterFp=91dee0d48d59 silentClaimPrevented=true
- **PASS** `E.legacy_no_silent_claim` — verify/sync did not stamp legacy before explicit CLAIM
- **PASS** `E11` — metaFp=91dee0d48d59 e11Fp=91dee0d48d59 pushT=1 pushP=0
- **PASS** `E10` — delegated to m2-supabase-smoke.mjs (separate step)
- **PASS** `F.vehicle_bidirectional` — create=true pullSeen=true
- **PASS** `F.offline_retry` — queued=true pulled=true
- **PASS** `F.cleanup_fixtures` — deleted=9 status=200
- **PASS** `invariant.zero_prod_gateway_push` — count=0
