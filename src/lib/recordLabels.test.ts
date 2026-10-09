import { describe, expect, it } from 'vitest';
import { parkingKindLabel, recordTypeLabel } from './constants';

describe('recordTypeLabel', () => {
  it('returns zh-CN by default', () => {
    expect(recordTypeLabel('parking')).toBe('停车费');
    expect(recordTypeLabel('toll')).toBe('高速费');
  });
  it('returns en when language is en', () => {
    expect(recordTypeLabel('parking', 'en')).toBe('Parking');
    expect(recordTypeLabel('toll', 'en-US')).toBe('Toll');
  });
});

describe('parkingKindLabel', () => {
  it('localizes fixed / temporary', () => {
    expect(parkingKindLabel('fixed')).toBe('固定停车费');
    expect(parkingKindLabel('temporary', 'en')).toBe('Temporary parking');
  });
});
