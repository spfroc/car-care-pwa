import { describe, expect, it } from 'vitest';
import { formatMoney } from './constants';

describe('formatMoney', () => {
  it('formats finite amounts to 2 decimals', () => {
    expect(formatMoney(3.77157)).toBe('¥3.77');
    expect(formatMoney(0, '$')).toBe('$0.00');
  });

  it('does not throw on non-finite values (Stats empty / migrated data)', () => {
    expect(formatMoney(Number.NaN)).toBe('¥0.00');
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('¥0.00');
  });
});
