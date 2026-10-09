import { describe, expect, it } from 'vitest';
import {
  findNicknameCandidate,
  inferAmountDialectVote,
  mergeStationAliases,
  mergeVehicleAliases,
} from './quickEntryLearn';
import { extractFields, matchStations, matchVehicles, parseQuickEntry } from './quickEntryParse';

const vehicles = [
  { id: 'v-spacy', name: 'Spacy125', plate: '鲁AZ7G61', energyType: 'ICE' as const },
  { id: 'v-xrv', name: 'X-RV', plate: '鲁A4GC10', energyType: 'ICE' as const },
];

const stations = [
  {
    id: 'st-zhongkai',
    name: '中凯石油窑头路',
    stationType: 'gas' as const,
    brand: '中凯',
  },
  {
    id: 'st-sinopec',
    name: '中石化浦东站',
    stationType: 'gas' as const,
    brand: '中石化',
  },
];

describe('inferAmountDialectVote', () => {
  it('detects flip to bareAsPaid when user keeps bare as 实付', () => {
    // Parser default: bare 300 + 优惠20 → due=300 paid=280
    const vote = inferAmountDialectVote({
      parsedPaid: 280,
      parsedDue: 300,
      savedPaid: 300,
      savedDue: 320,
      discount: 20,
    });
    expect(vote).toBe('bareAsPaid');
  });
  it('detects confirm bareAsDue', () => {
    const vote = inferAmountDialectVote({
      parsedPaid: 280,
      parsedDue: 300,
      savedPaid: 280,
      savedDue: 300,
      discount: 20,
    });
    expect(vote).toBe('bareAsDue');
  });
});

describe('findNicknameCandidate', () => {
  it('finds 小黑 when plate/name stripped', () => {
    expect(findNicknameCandidate('给小黑加油 200 块', vehicles)).toBe('小黑');
  });
  it('skips known vehicle names', () => {
    expect(findNicknameCandidate('X-RV 加油', vehicles)).toBeUndefined();
  });
});

describe('merge aliases', () => {
  it('merges station aliases onto matching station', () => {
    const merged = mergeStationAliases(stations, [
      { alias: '中凯', stationId: 'st-zhongkai', stationName: '中凯石油窑头路' },
    ]);
    expect(merged[0].aliases).toContain('中凯');
    expect(merged[1].aliases).toBeUndefined();
  });
  it('merges vehicle aliases', () => {
    const merged = mergeVehicleAliases(vehicles, [
      { alias: '小黑', vehicleId: 'v-xrv' },
    ]);
    expect(merged[1].aliases).toEqual(['小黑']);
  });
});

describe('learned aliases in parse / match', () => {
  it('matchStations prefers exact learned alias before brand ambiguity', () => {
    const withLearned = mergeStationAliases(
      [
        ...stations,
        {
          id: 'st-zhongkai-2',
          name: '中凯石油解放路',
          stationType: 'gas' as const,
          brand: '中凯',
        },
      ],
      [{ alias: '窑头', stationId: 'st-zhongkai', stationName: '中凯石油窑头路' }],
    );
    const hits = matchStations('窑头', withLearned, 'gas');
    expect(hits.map((s) => s.id)).toEqual(['st-zhongkai']);
  });

  it('parseQuickEntry applies learned station alias 中凯 → favorite', () => {
    const r = parseQuickEntry(
      '昨天在中凯加了300块的油, 优惠20块, 8块7毛2一升.',
      [vehicles[0]],
      {
        now: new Date('2026-10-09T14:30:00+08:00'),
        stations,
        learnedStationAliases: [
          { alias: '中凯', stationId: 'st-zhongkai', stationName: '中凯石油窑头路' },
        ],
      },
    );
    expect(r.stationQuery).toBe('中凯');
    expect(r.fields.stationId).toBe('st-zhongkai');
    expect(r.fields.stationName).toBe('中凯石油窑头路');
  });

  it('parseQuickEntry applies learned vehicle alias 小黑', () => {
    const r = parseQuickEntry('小黑加油 100 元', vehicles, {
      learnedVehicleAliases: [{ alias: '小黑', vehicleId: 'v-xrv' }],
    });
    expect(r.vehicleId).toBe('v-xrv');
    expect(r.type).toBe('fuel');
  });

  it('matchVehicles scores learned alias', () => {
    const withAlias = mergeVehicleAliases(vehicles, [
      { alias: '小黑', vehicleId: 'v-spacy' },
    ]);
    const hits = matchVehicles('小黑洗车', withAlias);
    expect(hits.map((v) => v.id)).toEqual(['v-spacy']);
  });

  it('amountDialect bareAsPaid: 300块+优惠20 → paid=300 due=320', () => {
    const f = extractFields(
      '在中凯加了300块的油, 优惠20块',
      'fuel',
      new Date('2026-10-09T14:30:00+08:00'),
      'bareAsPaid',
    );
    expect(f.amountPaid).toBe(300);
    expect(f.amountDue).toBe(320);
    expect(f.discount).toBe(20);
  });

  it('amountDialect default bareAsDue unchanged', () => {
    const f = extractFields(
      '在中凯加了300块的油, 优惠20块',
      'fuel',
      new Date('2026-10-09T14:30:00+08:00'),
      'bareAsDue',
    );
    expect(f.amountDue).toBe(300);
    expect(f.amountPaid).toBe(280);
  });

  it('parseQuickEntry respects amountDialect option', () => {
    const r = parseQuickEntry(
      '昨天在中凯加了300块的油, 优惠20块, 8块7毛2一升.',
      [vehicles[0]],
      {
        now: new Date('2026-10-09T14:30:00+08:00'),
        stations,
        amountDialect: 'bareAsPaid',
      },
    );
    expect(r.fields.amountPaid).toBe(300);
    expect(r.fields.amountDue).toBe(320);
  });
});
