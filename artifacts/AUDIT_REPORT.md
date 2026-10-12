# Car Care PWA — Independent Audit & Remediation Report

**Date**: 2026-10-12 (Asia/Shanghai)  
**Branch**: `audit/import-safety-data-integrity`  
**Scope**: P0 import safety · P1 data integrity · P1 own-cloud design  
**Deploy**: **NOT performed** (no Contabo / car.adobesun.com)

---

## 1. Findings（缺陷）

### P0 — Import safety

| ID | Cause | Severity |
|---|---|---|
| P0-1 | `importData` only checked `format === car-care-export-v1`; no field / `vehicleId` / schema validation | High |
| P0-2 | `replace` cleared stores in one tx, then `putAll()` in **separate** ops — mid-failure left DB empty or half-written | Critical |
| P0-3 | No automated tests for malformed JSON, legacy schema, or cover-import failure isolation | High |

### P1 — Data integrity

| ID | Cause | Severity |
|---|---|---|
| P1-1 | `deleteVehicle` → `deleteRecordsForVehicle` → per-record `deleteMedia` across multiple txs; crash mid-way orphans records/media | High |
| P1-2 | Media always deleted on record delete even if shared; cover media not cleaned with vehicle | Medium |
| P1-3 | Averages included partial fills but UI showed no「参考」caveat on cards/stats/hero | Medium |
| P1-4 | Electric intervals never set `lowConfidence` (partial SOC) | Low–Med |
| P1-5 | `combinedEconomy` could cross-stitch multi-vehicle odometers if fed mixed records | Medium |

### P1 — Own cloud

| ID | Cause |
|---|---|
| P1-C | No Notion/Supabase/sync code in `src/`; only local JSON export |

---

## 2. Fixes（修复）

| Issue | Fix | Files |
|---|---|---|
| P0-1 | `validateImportJson`: format, schema 1‥APP_SCHEMA_VERSION, required fields, vehicleId refs | `src/lib/importValidate.ts` |
| P0-2 | Validate + decode media **before** mutation; single IDB tx for clear+puts (replace) / puts (merge) | `src/repositories/importExport.ts` |
| P0-3 | Unit tests: validation + fake-indexeddb import atomicity | `importValidate.test.ts`, `importExport.test.ts` |
| P1-1/2 | `deleteVehicle` / `deleteRecord` single-tx cascade; skip shared media; drop cover | `vehicles.ts`, `records.ts` |
| P1-3/4 | `fuelEconomySummary` / `electricEconomySummary`; SOC&lt;95 → lowConf; UI `eco.estimate` / hint | `economy.ts`, cards/stats/detail, i18n |
| P1-5 | `combinedEconomy` requires single `vehicleId` group | `economy.ts` |
| P1-C | Design-only doc | `docs/own-cloud-sync-architecture.md` |

---

## 3. Tests / commands / results

```bash
cd app
npm test          # 13 files, 143 tests — PASS
npx tsc -b        # PASS (no emit errors)
npm run build     # PASS — vite production + PWA precache
```

Logs: `artifacts/test-log.txt`, `artifacts/typecheck-log.txt`, `artifacts/build-log.txt`

New / extended cases:

- Cover-import does not clear on validation failure  
- Malformed JSON / bad structure / legacy schema 1–2  
- Vehicle delete cascade + shared media retention  
- Partial fill / partial charge caveats; multi-vehicle combined = null  

---

## 4. Commit SHA(s)

- `83c4e907bcac4b545aa6622686aff3e56b2c2493` (`83c4e90`) — main remediation
- `b8c1edfc9ab013f1ee692d06f19478576bf8be65` (`b8c1edf`) — report SHA note

---

## 5. Open items

1. Live multi-device sync **not implemented** (design only).  
2. Import does not deep-migrate obsolete field shapes beyond structural accept of schema 1–2.  
3. Media “shared across records” is rare; cascade uses reference scan (O(n) records) — fine for local PWA scale.  
4. No production deploy performed (per acceptance).  

---

## 6. File list (touched)

- `src/lib/importValidate.ts` (+ test)  
- `src/lib/economy.ts` (+ test extensions)  
- `src/repositories/importExport.ts` (+ test)  
- `src/repositories/vehicles.ts` (+ test)  
- `src/repositories/records.ts`  
- `src/db/index.ts` (`closeDBForTests`)  
- `src/components/VehicleCard.tsx`, `EconomyIntervalList.tsx`  
- `src/pages/StatsPage.tsx`, `VehicleDetailPage.tsx`  
- `src/i18n/messages.ts`  
- `docs/own-cloud-sync-architecture.md`  
- `artifacts/*`  
- `package.json` / lock (`fake-indexeddb`)  
