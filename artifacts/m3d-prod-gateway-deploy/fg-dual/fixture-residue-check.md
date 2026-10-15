# FG / E-smoke fixture residue check — **PASS**

- Checked at: 2026-10-15T01:49:05.338Z
- Prefixes: `SW-A` · `SW1-OFF-` · `SW4-` · `M3D-PROD-FIXTURE-`
- Policy: E-smoke used `M3D-PROD-FIXTURE-`; FG harness historically used `SW-A` / `SW1-OFF-` / `SW4-` (not the agreed prefix). Future FG should prefer `M3D-PROD-FIXTURE-`.

## Initial pull
- **A_prod** `https://car-care-notion-sync.spf-roc.workers.dev` keyFp=`aa819deb16dc` wkFp=`c647ac0368ff` pull=200 rows=7 **livePrefixHits=0**
- **B_d1_test_b** `https://car-care-notion-sync-d1-test-b.spf-roc.workers.dev` keyFp=`5d915911b54a` wkFp=`db38e1e5a251` pull=200 rows=0 **livePrefixHits=0**

## Cleanup
- Attempted: no (already clean)

## Final read-only proof
- **A_prod** livePrefixHits=**0** (tombstonedPrefixHits=0)
- **B_d1_test_b** livePrefixHits=**0** (tombstonedPrefixHits=0)

**Read-only pull: 0 live rows matching SW-A / SW1-OFF- / SW4- / M3D-PROD-FIXTURE- on A and B**
