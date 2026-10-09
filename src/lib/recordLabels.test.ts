import { describe, expect, it } from 'vitest';
import { parkingKindLabel, recordTypeColor, recordTypeLabel, RECORD_TYPE_COLORS, RECORD_TYPE_ORDER } from './constants';

describe('recordTypeLabel', () => {
  it('returns zh-CN by default', () => {
    expect(recordTypeLabel('parking')).toBe('停车费');
    expect(recordTypeLabel('toll')).toBe('高速费');
    expect(recordTypeLabel('insurance')).toBe('保险');
  });
  it('returns en when language is en', () => {
    expect(recordTypeLabel('parking', 'en')).toBe('Parking');
    expect(recordTypeLabel('toll', 'en-US')).toBe('Toll');
    expect(recordTypeLabel('insurance', 'en')).toBe('Insurance');
  });
});

describe('parkingKindLabel', () => {
  it('localizes fixed / temporary', () => {
    expect(parkingKindLabel('fixed')).toBe('固定停车费');
    expect(parkingKindLabel('temporary', 'en')).toBe('Temporary parking');
  });
});

describe('recordTypeColor', () => {
  it('returns a stable color for every ordered type', () => {
    for (const type of RECORD_TYPE_ORDER) {
      expect(recordTypeColor(type)).toBe(RECORD_TYPE_COLORS[type]);
      expect(recordTypeColor(type)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('falls back for unknown types', () => {
    expect(recordTypeColor('unknown')).toBe('#94a3b8');
  });
});
