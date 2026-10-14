# RR-IDB — PASS

- preview: `https://car-test.adobesun.com`
- gateway: `https://car-care-notion-sync-d1-test.spf-roc.workers.dev`
- keyFp: `91dee0d48d59`

## Steps
- **boot.settings**: PASS — https://car-test.adobesun.com/settings
- **browser.verify**: PASS — keyFp=91dee0d48d59
- **online.vehicle_create**: PASS — url=https://car-test.adobesun.com/vehicles/c678d9fc-1787-4ede-9ba2-9223f29d1886
- **online.idb_objectstore_read**: PASS — {"ok":true,"names":["learning","media","meta","records","settings","stations","sync_conflicts","sync_meta","sync_notion_map","sync_outbox","vehicles"],"vehicles":1,"outbox":0,"meta":1,"sampleName":"RRIDB-mv7vrfdx"}
- **pre_offline.vehicles_loaded**: PASS — len=115
- **offline.shell_reachable**: PASS — len=115 (no nav after offline)
- **offline.idb_databases_probe**: PASS — ["car-care-db"]
- **offline.idb_objectstore_rw**: PASS — {"ok":true,"id":"c678d9fc-1787-4ede-9ba2-9223f29d1886","readName":"RRIDB-mv7vrfdx-OFF","outboxCount":1}
- **offline.ui_reads_local**: PASS — uiSees=true idbOk=true
- **reonline.outbox_sync**: PASS — [{"path":"/sync/push","status":200,"t":1791968485106},{"path":"/sync/pull?entities=vehicles,records","status":200,"t":1791968485845}]
- **reonline.idb_intact**: PASS — {"ok":true,"names":["learning","media","meta","records","settings","stations","sync_conflicts","sync_meta","sync_notion_map","sync_outbox","vehicles"],"vehicles":1,"outbox":0,"meta":1,"sampleName":"RRIDB-mv7vrfdx-OFF"}
- **api.pull_after_reonline**: PASS — idFp=6f2231f5da08 name=RRIDB-mv7vrfdx-OFF

## Hard bans observed
- No clear storage / Outbox / IDB
- No production PWA / Gateway deploy
