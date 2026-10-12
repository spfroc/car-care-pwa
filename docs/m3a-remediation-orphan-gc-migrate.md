# M3-A remediation: orphan GC race + migrate error surfacing

> **PR**: #5 · **branch**: `feature/m3a-media-storage-objects`  
> **Constraint**: no merge/deploy; no production Supabase (`tqjowsffppgoqtdokbzp`).

## P0 — Orphan GC false-delete race

### Problem
`bidirectionalSync` called `runOrphanMediaCleanup` after every sync. A device could upload a Storage object and GC on another device (or same device mid-flight) could see **no DB `storageKey` yet** and delete the object before the LWW row commit.

Also, incomplete Storage listings (`fileErr → continue`) could look like a full empty prefix and delete everything else.

### Fix
1. **Disable auto orphan GC during sync** (restore + bidirectional). Tombstone path still uses explicit `removeStorageForDeletedMedia` for rows known-deleted.
2. **Explicit** `runOrphanMediaCleanup` only, with:
   - Required `recheckLiveKeys` (second pull) before any delete
   - **Grace period** default 24h (`ORPHAN_GC_DEFAULT_GRACE_MS`); unknown age treated as young when grace &gt; 0
   - **Abort** if list `complete !== true`, list throws, or recheck fails — **zero deletes**
3. Supabase `listMediaObjectKeys` returns `{ keys, complete, createdAtByKey, error? }`; any subfolder error or truncation → `complete: false` (no silent skip).

### Tests
- A upload-not-committed vs B cleanup → no false delete (grace)
- Sync does not auto-GC even aged unreferenced object
- Incomplete list / network list error → abort, no deletes
- Recheck: ref appears between list and delete → skip
- Aged + unreferenced + recheck empty → remove (explicit only)

## P1 — `migrateCloudLegacyMedia` errors ignored

### Problem
Sync awaited migrate but discarded the result; UI showed success while some images stayed on M2 base64 with no retry signal.

### Fix
1. Migrate returns `MediaMigrateSummary`: `migrated`, `skipped`, `unmigrated`, `failed`, `errors`, `ok` (`ok ⇔ unmigrated === 0`).
2. Failed uploads **keep cloud base64** (never strip on failure).
3. Sync / restore attach `mediaMigrate` on `SyncActionResult`, append clear Chinese note, set `lastError` + `status=error` when `unmigrated > 0` so retry path is obvious.
4. Partial success among multiple images is supported; retry via another sync after storage recovers.

### Tests
- Three legacy images: 2 migrate, 1 upload-fail → base64 retained on fail; `unmigrated=1`
- Retry sync after fix → all migrated; status idle
- Sync message / `lastError` reports 媒体迁移待重试 when still failing

## Files
- `src/sync/mediaStorage.ts` — list result + safe GC
- `src/sync/providers/{memory,supabase}.ts` — list completeness
- `src/sync/engine.ts` — no auto GC; migrate surfacing
- `src/sync/mediaStorage.test.ts`, `media-migration.test.ts`, `supabase.media-e2e.test.ts`

## Verification
- Unit (no live env): **222 passed**
- Media unit/migration suite: **26 passed**
- Live media E2E on disposable `skwoahneuqkqgxzpkkzl` (grace=0 for intentional orphan only)


## Final status（第二轮审查通过后）

- Review tip：**`602a94a`** — PASS
- Merged to `main`：见 `docs/m3a-staging-deploy-report.md`
- Staging-only deploy：https://car-test.adobesun.com
- Production：未部署、未改 Supabase
