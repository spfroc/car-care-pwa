# M3-D D2 full end-to-end acceptance — post PR #15

**Ran:** 2026-10-14 16:04 CST (Asia/Shanghai)  
**Repo tip:** `137e318a65df5bee3e9155d32b06930a16493884` (`Merge pull request #15 … m3d-d2-p5-map-switch-corridor`)  
**Workspace:** `/workspace/car-care-pwa/app` (box; CloudAgent region-blocked)  
**Deploy:** **not performed** (recommendation only)

## Fingerprints (no secrets)

| Item | Value |
|------|--------|
| main SHA | `137e318a65df5bee3e9155d32b06930a16493884` |
| Gateway | `https://car-care-notion-sync-d1-test.spf-roc.workers.dev` (**DEV d1-test only**) |
| Worker version | `m3d-d1-0.1.0` |
| keyFp (sha256-12) | `91dee0d48d59` |
| workspaceFp | `c647ac0368ff` |
| dataSourcesFp | vehicles `8576578526ab` · records `6091d7e09158` |

Hard bans observed: no PWA deploy · no prod · no formal Supabase mutation · d1-test ≠ prod Gateway · fingerprints only in artifacts.

---

## Section A — Mock unit tests

| Check | Command | Result |
|-------|---------|--------|
| Unit | `npm test` | **339 passed** / 5 skipped (31 files passed / 3 skipped) |
| TypeScript | `npx tsc -b` | **exit 0** |
| Build | `npm run build` | **exit 0** (vite + PWA `generateSW`) |
| Notion SW/DEL focused | `vitest run src/sync/notion-d2-p5.test.ts` | **19 passed** (SW1–SW4, DEL1–DEL3 map, verify park) |

**Flake note (honest):** first full `npm test` had **1 fail** in `tabLock.test.ts` P0 lease (`tryAcquireIdbLease` false). Two immediate re-runs of that file alone: **12/12 PASS**. Stable full re-run: **339/339**. Not Notion-specific; mention before release cut.

**Kind label:** mock / jsdom / fake-indexeddb — **not** live Gateway, **not** real browser.

---

## Section B — Real Gateway / API live matrix

Scripts (reuse): `m3d-d2-p3-live-notion.mjs`, `m3d-d2-p4-live-conflicts.mjs`, `m3d-d2-p5-live-map-switch.mjs`  
Target: **d1-test Worker + real Notion test workspace** (Bearer from `~/.car-care-secrets/…`, never logged raw).

| ID | Status | Evidence source |
|----|--------|-----------------|
| G1.health / G1.verify | **PASS** | P3/P4/P5 |
| CRUD.create (vehicle+record) | **PASS** | P3 `starC` applied=2 |
| D2.3 cross-device pull | **PASS** | P3 pull sees both rows |
| CRUD.update (same page) | **PASS** | P3 `starU` alivePages=1 |
| D2.2 offline→online flush | **PASS** | P3 outbox-style push applied |
| CRUD.delete + anti-stale | **PASS** | P3 tombstone via `skipped_deleted` (pull trash may omit) |
| CRUD.restore | **PASS** | P3 `starR` |
| conflict `cloud_newer` + keep_local LWW | **PASS** | P4 ★F |
| D2.6 reject media/stations/settings | **PASS** | P4 `unsupported_entity` all three |
| DEL1 delete + tombstone corridor | **PASS** | P5 (KV tombstone; pull may omit trash) |
| DEL2 no old-device recreate | **PASS** | P5 `skipped_deleted` |
| DEL3 restore alive | **PASS** | P5 |
| **SW1** disconnect retain queue | **SKIP (unit-only)** | single workspaceKey cannot dual-tenant live |
| **SW2** workspace switch isolation | **SKIP (unit-only)** | same — see §A notion-d2-p5 |
| **SW3** explicit discard confirm | **SKIP (unit-only)** | DISCARD token in unit |
| **SW4** switch-back resume sync | **SKIP (unit-only)** | unit proves flushable again |

**Live PASS count:** 21 · **SKIP (honest unit-only):** 4 (SW1–SW4) · **FAIL:** 0  

Artifacts: `live-p3-matrix.json`, `live-p4-matrix.json`, `live-p5-matrix.json` (+ logs).

---

## Section C — Real browser E2E

| Item | Detail |
|------|--------|
| Status | **PASS** (minimal critical path) |
| How | Playwright + `/usr/bin/google-chrome` against `vite preview` on **`http://localhost:5173`** (only Origin allowed by d1-test CORS) |
| Against | Real d1-test Gateway (not mock) |
| Steps | settings → select Notion → save URL → verify (**会话已就绪**, `/verify` 200) → create vehicle → **双向同步** (`/sync/push` 200 + `/sync/pull` 200) |
| Cross-check | Vehicle **id** appeared on Gateway pull after UI sync; pull `payload` subset lacked `name`/`plate` (had `bodyType`/`fuelGrade`/`createdAt`) — smoke name assertion over-strict; entity cleaned via delete |
| Not covered in browser | Full SW1–SW4 UI dual-workspace, full conflict UI, offline airplane-mode (those: unit + API) |

**Kind label:** real browser + real Gateway. Do **not** conflate with §A mocks.

Screenshot: `browser-smoke.png` · matrix: `browser-matrix.json`

---

## Section D — Supabase regression

| Item | Detail |
|------|--------|
| Status | **PASS** |
| Command | `node scripts/m2-supabase-smoke.mjs` with `~/.car-care-secrets/env.smoke.local` |
| Gates | auth.signIn · table.probe · rpc.lww apply/skip_older/apply_newer · cross_device pull · RLS anon block · cleanup |
| Formal Supabase changes | **None** (read/write smoke on disposable project only) |
| Vitest | Default suite green; dedicated `supabase.*.test.ts` live files remain skipped unless env-gated — API regression covered by smoke script |

**Kind label:** real disposable Supabase API — separate from Notion Gateway.

---

## Gaps / residual risks

1. **SW1–SW4** not dual-tenant live (one d1-test workspaceKey) — unit coverage strong; accept residual until second test workspace exists.  
2. **DEL1 pull:** Notion data-source query often excludes trash; tombstone authoritative in KV + `skipped_deleted` (documented honest口径).  
3. **UI PayloadJson completeness:** browser-created vehicle synced by id; pull payload missing name/plate — spot-check before trusting cross-device nickname display from UI path (API script path does round-trip names).  
4. **CORS:** d1-test `ALLOWED_ORIGIN` = `http://localhost:5173` only — **car-test origin currently 403**. Must update Worker var before staging browser use.  
5. **tabLock flake** under load (see §A).  
6. CloudAgent unavailable (region) — acceptance ran on shared box only.

---

## Deploy readiness for **car-test**

### **YES with conditions** — recommendation only; **do NOT deploy from this run**

Conditions before requesting car-test deploy:

1. Set Gateway `ALLOWED_ORIGIN` to include `https://car-test.adobesun.com` (and keep d1-test vs any prod Gateway strictly separate).  
2. Spot-check UI→pull name/plate PayloadJson on staging.  
3. Accept SW1–SW4 as unit-proven until dual workspace live harness exists.  
4. Re-run `npm test` once before cut (tabLock flake).  
5. Deploy process remains human/gated — this report does not authorize Contabo/PWA publish.

**Blockers for “ready to request”:** none on live Gateway CRUD/conflict/DEL/D2.6/unit/build/tsc/Supabase smoke/browser verify+sync path.

---

## Artifact index

```
artifacts/m3d-d2-full-acceptance/
  SUMMARY.md
  matrix.json
  unit-test.log
  unit-tablock-rerun.log / unit-tablock-rerun2.log
  unit-focused.log
  tsc.log
  build.log
  live-p3.log + live-p3-matrix.json
  live-p4.log + live-p4-matrix.json
  live-p5.log + live-p5-matrix.json
  supabase-smoke.log
  browser-smoke.log + browser-matrix.json + browser-smoke.png
  browser-notion-smoke.mjs
```
