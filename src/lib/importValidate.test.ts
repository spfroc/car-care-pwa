import { describe, expect, it } from 'vitest';
import { validateImportJson } from './importValidate';
import { APP_SCHEMA_VERSION } from './constants';

function minimalExport(overrides: Record<string, unknown> = {}) {
  return {
    format: 'car-care-export-v1',
    exportedAt: '2026-01-01T00:00:00.000Z',
    appSchemaVersion: 3,
    vehicles: [
      {
        id: 'v1',
        name: '测试车',
        energyType: 'ICE',
        bodyType: 'SEDAN',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    records: [
      {
        id: 'r1',
        vehicleId: 'v1',
        type: 'fuel',
        date: '2026-01-02T10:00:00.000Z',
        amountPaid: 300,
        mediaIds: [],
        liters: 40,
        odometer: 1000,
        fuelGrade: '95#',
        filledUp: true,
        createdAt: '2026-01-02T10:00:00.000Z',
        updatedAt: '2026-01-02T10:00:00.000Z',
      },
    ],
    stations: [],
    settings: [{ key: 'language', value: 'zh-CN', updatedAt: '2026-01-01T00:00:00.000Z' }],
    media: [],
    ...overrides,
  };
}

describe('validateImportJson', () => {
  it('accepts a well-formed v1 export', () => {
    const r = validateImportJson(JSON.stringify(minimalExport()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.schemaVersion).toBe(3);
      expect(r.data.vehicles).toHaveLength(1);
    }
  });

  it('rejects malformed JSON', () => {
    const r = validateImportJson('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/JSON/);
  });

  it('rejects wrong format', () => {
    const r = validateImportJson(JSON.stringify(minimalExport({ format: 'other' })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/car-care-export-v1/);
  });

  it('rejects unsupported future schema version', () => {
    const r = validateImportJson(
      JSON.stringify(minimalExport({ appSchemaVersion: APP_SCHEMA_VERSION + 10 })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/schema/);
  });

  it('accepts legacy schema 1 / 2 and missing schema (as 1)', () => {
    for (const ver of [1, 2]) {
      const r = validateImportJson(JSON.stringify(minimalExport({ appSchemaVersion: ver })));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.schemaVersion).toBe(ver);
    }
    const payload = minimalExport();
    delete (payload as { appSchemaVersion?: number }).appSchemaVersion;
    const r = validateImportJson(JSON.stringify(payload));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.schemaVersion).toBe(1);
      expect(r.warnings.some((w) => /appSchemaVersion/.test(w))).toBe(true);
    }
  });

  it('rejects missing required vehicle fields', () => {
    const r = validateImportJson(
      JSON.stringify(
        minimalExport({
          vehicles: [{ id: 'v1', energyType: 'ICE', bodyType: 'SEDAN' }],
        }),
      ),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects record.vehicleId that does not exist', () => {
    const r = validateImportJson(
      JSON.stringify(
        minimalExport({
          records: [
            {
              id: 'r1',
              vehicleId: 'missing',
              type: 'fuel',
              date: '2026-01-02T10:00:00.000Z',
              amountPaid: 1,
              mediaIds: [],
              liters: 10,
              odometer: 100,
              fuelGrade: '95#',
              filledUp: true,
              createdAt: '2026-01-02T10:00:00.000Z',
              updatedAt: '2026-01-02T10:00:00.000Z',
            },
          ],
        }),
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /vehicleId/.test(e))).toBe(true);
  });

  it('rejects fuel record missing filledUp / liters', () => {
    const r = validateImportJson(
      JSON.stringify(
        minimalExport({
          records: [
            {
              id: 'r1',
              vehicleId: 'v1',
              type: 'fuel',
              date: '2026-01-02T10:00:00.000Z',
              amountPaid: 1,
              mediaIds: [],
              odometer: 100,
              fuelGrade: '95#',
              createdAt: '2026-01-02T10:00:00.000Z',
              updatedAt: '2026-01-02T10:00:00.000Z',
            },
          ],
        }),
      ),
    );
    expect(r.ok).toBe(false);
  });

  it('accepts legacy export without learning / media arrays', () => {
    const payload = minimalExport({ appSchemaVersion: 2 });
    delete (payload as { learning?: unknown }).learning;
    delete (payload as { media?: unknown }).media;
    const r = validateImportJson(JSON.stringify(payload));
    expect(r.ok).toBe(true);
  });
});
