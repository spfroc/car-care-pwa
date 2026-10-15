# FG1–FG3 + SW dual (formal Gateway A) — PASS

- A: `https://car-care-notion-sync.spf-roc.workers.dev` keyFp=`aa819deb16dc`
- B: `https://car-care-notion-sync-d1-test-b.spf-roc.workers.dev` keyFp=`5d915911b54a`

## Steps
- **SW0_verify_A**: PASS — status=200 wkFp=c647ac0368ff
- **SW0_verify_B**: PASS — status=200 wkFp=db38e1e5a251
- **SW0_distinct_workspaceKey**: PASS — wkA=c647ac0368ff wkB=db38e1e5a251 distinct=true
- **SW0_seed_A**: PASS — status=200
- **SW_connect_A**: PASS — pwa=https://car-test.adobesun.com
- **SW1_offline_enqueue**: PASS — before=0 after=1 via=idb
- **SW1_disconnect_retain**: PASS — retained=1 sessionCleared=true how=清除本会话 Key
- **SW2_connect_B**: PASS — wkB=db38e1e5a251
- **SW2_park_no_mispush**: PASS — parkedTotal=1 push200toB=0 leakedA=false
- **SW3_reject_without_DISCARD**: PASS — wrong={"ok":false,"removed":0,"reason":"token-rejected-client"} total=1
- **SW3_DISCARD_clears_parked**: PASS — removed=? aOwnerLeft=0
- **FG1_push200**: PASS — push200=2 browserPushStatus=200 netHits=1
- **FG2_outbox_cleared**: PASS — parkedOps=1 ownerALeft=0 outboxTotal=0
- **FG3_no_leak_B**: PASS — seenOnA=true leakedB=false
- **SW4_switchback_flush**: PASS — parkedBefore=1 afterPark=1 push200=2 seenOnA=true leakedB=false ownerLeft=0
