import { describe, expect, it } from 'vitest';
import {
  buildVehicleMatchInputs,
  detectRecordTypes,
  extractFields,
  extractRelativeDate,
  isParseReady,
  matchStations,
  matchVehicles,
  parseChineseYuan,
  parseQuickEntry,
  resolveVehicleWithoutMention,
} from './quickEntryParse';

const vehicles = [
  { id: 'v-spacy', name: 'Spacy125', plate: '鲁AZ7G61', energyType: 'ICE' as const },
  { id: 'v-xrv', name: 'X-RV', plate: '鲁A4GC10', energyType: 'ICE' as const },
  { id: 'v-ev', name: '城市纯电轿车', plate: '沪A12345', energyType: 'EV' as const },
];


const stations = [
  {
    id: 'st-zhongkai',
    name: '中凯石油窑头路',
    stationType: 'gas' as const,
    brand: '中凯',
    aliases: ['中凯'],
  },
  {
    id: 'st-sinopec',
    name: '中石化浦东站',
    stationType: 'gas' as const,
    brand: '中石化',
  },
  {
    id: 'st-shell',
    name: '壳牌世纪大道',
    stationType: 'gas' as const,
    brand: 'Shell',
  },
  {
    id: 'st-tely',
    name: '特来电商场桩',
    stationType: 'charge' as const,
    brand: '特来电',
  },
];

const FAIL_SENTENCE = '昨天在中凯加了300块的油, 优惠20块, 8块7毛2一升.';
/** 实付 N + 优惠 → paid=N, due=N+discount; odometer from N公里. */
const SHIFU_ODO_SENTENCE =
  '昨天在中凯加了 实付300块的油, 优惠20块, 7块5毛5一升，42563公里';

describe('detectRecordTypes', () => {
  it('detects fuel from 加油 / 升', () => {
    expect(detectRecordTypes('今天加油花了 320 元')).toEqual(['fuel']);
    expect(detectRecordTypes('加了 40 升')).toEqual(['fuel']);
  });
  it('detects fuel from 加了…油 / 块…一升', () => {
    expect(detectRecordTypes(FAIL_SENTENCE)).toEqual(['fuel']);
    expect(detectRecordTypes('8块7毛2一升')).toContain('fuel');
  });
  it('detects charge from 充电 / 度', () => {
    expect(detectRecordTypes('充电 45 度 花了 60 块')).toEqual(['charge']);
  });
  it('detects parking / toll / insurance / wash / ticket', () => {
    expect(detectRecordTypes('临时停车 25 元')).toContain('parking');
    expect(detectRecordTypes('过高速 ETC 扣了 40')).toContain('toll');
    expect(detectRecordTypes('交了交强险')).toContain('insurance');
    expect(detectRecordTypes('下午洗车')).toEqual(['wash']);
    expect(detectRecordTypes('收到罚单扣 6 分')).toContain('ticket');
  });
  it('detects maintenance / modification / goods', () => {
    expect(detectRecordTypes('去做保养')).toContain('maintenance');
    expect(detectRecordTypes('轮毂改装')).toContain('modification');
    expect(detectRecordTypes('买了空气滤芯配件')).toContain('goods');
  });
  it('returns empty when no type keyword', () => {
    expect(detectRecordTypes('随便说一句')).toEqual([]);
  });
});

describe('parseChineseYuan', () => {
  it('parses 块/毛/分', () => {
    expect(parseChineseYuan('8块7毛2')).toBe(8.72);
    expect(parseChineseYuan('8块7毛2分')).toBe(8.72);
    expect(parseChineseYuan('3块5毛')).toBe(3.5);
    expect(parseChineseYuan('10块')).toBe(10);
  });
});

describe('extractRelativeDate', () => {
  it('resolves 昨天/今天 relative to now', () => {
    const now = new Date('2026-10-09T14:00:00+08:00');
    const y = extractRelativeDate('昨天加油', now)!;
    const t = extractRelativeDate('今天加油', now)!;
    expect(new Date(y).toDateString()).toBe(new Date('2026-10-08T14:00:00+08:00').toDateString());
    expect(new Date(t).toDateString()).toBe(now.toDateString());
  });
});

describe('matchVehicles', () => {
  it('matches by nickname', () => {
    const hits = matchVehicles('给 Spacy125 加油', vehicles);
    expect(hits.map((v) => v.id)).toEqual(['v-spacy']);
  });
  it('matches by full plate', () => {
    const hits = matchVehicles('鲁A4GC10 停车费 500', vehicles);
    expect(hits.map((v) => v.id)).toEqual(['v-xrv']);
  });
  it('matches plate tail without province', () => {
    const hits = matchVehicles('AZ7G61 洗车', vehicles);
    expect(hits.map((v) => v.id)).toEqual(['v-spacy']);
  });
  it('returns multiple when ambiguous nicknames absent but empty text', () => {
    expect(matchVehicles('', vehicles)).toEqual([]);
  });
  it('returns empty when no vehicle mentioned', () => {
    expect(matchVehicles('加油 200 元', vehicles)).toEqual([]);
  });
});

describe('resolveVehicleWithoutMention / vehicle-first', () => {
  it('picks sole vehicle', () => {
    const one = [vehicles[0]];
    const r = resolveVehicleWithoutMention(one, 'fuel');
    expect(r.picked?.id).toBe('v-spacy');
    expect(r.confidence).toBe('high');
  });
  it('picks sole fuel-capable among ICE+EV', () => {
    const mix = [vehicles[0], vehicles[2]];
    const r = resolveVehicleWithoutMention(mix, 'fuel');
    expect(r.picked?.id).toBe('v-spacy');
    expect(r.confidence).toBe('high');
  });
  it('picks most-recent fuel vehicle when multiple ICE', () => {
    const withLast = buildVehicleMatchInputs(vehicles, [
      { vehicleId: 'v-spacy', type: 'fuel', date: '2026-09-01T00:00:00.000Z' },
      { vehicleId: 'v-xrv', type: 'fuel', date: '2026-10-01T00:00:00.000Z' },
    ]);
    const r = resolveVehicleWithoutMention(withLast, 'fuel');
    expect(r.picked?.id).toBe('v-xrv');
    expect(r.confidence).toBe('low');
  });
  it('lists fuel-capable without pick when multiple and no lastFuelAt', () => {
    const r = resolveVehicleWithoutMention(vehicles, 'fuel');
    expect(r.picked).toBeUndefined();
    expect(r.vehicles.map((v) => v.id).sort()).toEqual(['v-spacy', 'v-xrv']);
    expect(r.confidence).toBe('low');
  });
});


describe('matchStations', () => {
  it('maps 中凯 → 中凯石油窑头路 (prefix / alias)', () => {
    const hits = matchStations('中凯', stations, 'gas');
    expect(hits.map((s) => s.id)).toEqual(['st-zhongkai']);
    expect(hits[0].name).toBe('中凯石油窑头路');
  });
  it('matches full station name', () => {
    const hits = matchStations('中凯石油窑头路', stations);
    expect(hits.map((s) => s.id)).toEqual(['st-zhongkai']);
  });
  it('matches brand 壳牌', () => {
    const hits = matchStations('壳牌', stations, 'gas');
    expect(hits.map((s) => s.id)).toEqual(['st-shell']);
  });
  it('returns empty when no station matches', () => {
    expect(matchStations('不存在的站', stations)).toEqual([]);
  });
  it('leaves ambiguous short prefix unresolved (multiple hits)', () => {
    const both = [
      ...stations,
      {
        id: 'st-zhongkai-2',
        name: '中凯石油解放路',
        stationType: 'gas' as const,
        brand: '中凯',
        aliases: ['中凯'],
      },
    ];
    const hits = matchStations('中凯', both, 'gas');
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe('extractFields', () => {
  it('extracts amount, liters, odometer, grade', () => {
    const f = extractFields('加了 40 升 320 元 95号 里程 12345', 'fuel');
    expect(f.liters).toBe(40);
    expect(f.amountPaid).toBe(320);
    expect(f.odometer).toBe(12345);
    expect(f.fuelGrade).toBe('95#');
    expect(f.note).toContain('加了');
  });
  it('extracts kWh and yen symbol', () => {
    const f = extractFields('充电 ¥60 45 度', 'charge');
    expect(f.amountPaid).toBe(60);
    expect(f.kWh).toBe(45);
  });
  it('extracts parking kind and place', () => {
    const f = extractFields('固定停车 在阳光停车场 1200 元', 'parking');
    expect(f.parkingKind).toBe('fixed');
    expect(f.place).toContain('停车场');
    expect(f.amountPaid).toBe(1200);
  });
  it('extracts insurer / policy', () => {
    const f = extractFields('平安交强险+商业险 4600 元', 'insurance');
    expect(f.insurer).toContain('平安');
    expect(f.policyName).toBe('交强险+商业险');
    expect(f.amountPaid).toBe(4600);
  });
  it('parses fail-case Chinese money, discount, station, unit price, liters', () => {
    const now = new Date('2026-10-09T14:30:00+08:00');
    const f = extractFields(FAIL_SENTENCE, 'fuel', now);
    expect(f.stationName).toBe('中凯');
    expect(f.amountDue).toBe(300);
    expect(f.discount).toBe(20);
    expect(f.amountPaid).toBe(280);
    expect(f.unitPrice).toBe(8.72);
    expect(f.liters).toBeCloseTo(280 / 8.72, 3);
    expect(f.date).toBeTruthy();
    expect(new Date(f.date!).toDateString()).toBe(
      new Date('2026-10-08T14:30:00+08:00').toDateString(),
    );
  });
  it('实付300 + 优惠20 → paid=300 due=320; 42563公里; liters from paid/price', () => {
    const now = new Date('2026-10-09T15:18:00+08:00');
    const f = extractFields(SHIFU_ODO_SENTENCE, 'fuel', now);
    expect(f.stationName).toBe('中凯');
    expect(f.amountPaid).toBe(300);
    expect(f.discount).toBe(20);
    expect(f.amountDue).toBe(320);
    expect(f.unitPrice).toBe(7.55);
    expect(f.odometer).toBe(42563);
    expect(f.liters).toBeCloseTo(300 / 7.55, 3);
    expect(new Date(f.date!).toDateString()).toBe(
      new Date('2026-10-08T15:18:00+08:00').toDateString(),
    );
  });
});

describe('parseQuickEntry', () => {
  it('resolves vehicle + type uniquely', () => {
    const r = parseQuickEntry('X-RV 加油 200 块 30 升', vehicles);
    expect(r.vehicleId).toBe('v-xrv');
    expect(r.type).toBe('fuel');
    expect(r.fields.amountPaid).toBe(200);
    expect(r.fields.liters).toBe(30);
    expect(isParseReady(r)).toBe(true);
  });
  it('leaves type ambiguous when multiple keywords', () => {
    const r = parseQuickEntry('Spacy125 加油后去洗车', vehicles);
    expect(r.vehicleId).toBe('v-spacy');
    expect(r.types.length).toBeGreaterThanOrEqual(2);
    expect(r.type).toBeUndefined();
    expect(isParseReady(r)).toBe(false);
  });
  it('vehicle-first: no name → ask pick among fuel vehicles (multi ICE)', () => {
    const r = parseQuickEntry('加油 100 元', vehicles);
    expect(r.vehicleId).toBeUndefined();
    expect(r.vehicleIds.sort()).toEqual(['v-spacy', 'v-xrv']);
    expect(r.confidence.vehicle).toBe('low');
    expect(r.type).toBe('fuel');
    expect(isParseReady(r)).toBe(false);
  });
  it('vehicle-first: sole fuel-capable when EV coexists', () => {
    const r = parseQuickEntry('加油 100 元', [vehicles[0], vehicles[2]]);
    expect(r.vehicleId).toBe('v-spacy');
    expect(r.confidence.vehicle).toBe('high');
    expect(r.type).toBe('fuel');
    expect(isParseReady(r)).toBe(true);
  });
  it('vehicle-first: last-used fuel when plate/name omitted', () => {
    const inputs = buildVehicleMatchInputs(vehicles, [
      { vehicleId: 'v-xrv', type: 'fuel', date: '2026-10-08T12:00:00.000Z' },
      { vehicleId: 'v-spacy', type: 'fuel', date: '2026-09-01T12:00:00.000Z' },
    ]);
    const r = parseQuickEntry(FAIL_SENTENCE, inputs, {
      now: new Date('2026-10-09T14:30:00+08:00'),
    });
    expect(r.type).toBe('fuel');
    expect(r.vehicleId).toBe('v-xrv');
    expect(r.confidence.vehicle).toBe('low');
    expect(r.fields.stationName).toBe('中凯');
    expect(r.fields.amountDue).toBe(300);
    expect(r.fields.discount).toBe(20);
    expect(r.fields.amountPaid).toBe(280);
    expect(r.fields.unitPrice).toBe(8.72);
    expect(r.fields.liters).toBeCloseTo(32.11, 2);
    expect(isParseReady(r)).toBe(true);
  });

  it('resolves 中凯 → 中凯石油窑头路 stationId when stations passed', () => {
    const now = new Date('2026-10-09T14:30:00+08:00');
    const r = parseQuickEntry(FAIL_SENTENCE, [vehicles[0], vehicles[2]], {
      now,
      stations,
    });
    expect(r.type).toBe('fuel');
    expect(r.fields.stationName).toBe('中凯石油窑头路');
    expect(r.fields.stationId).toBe('st-zhongkai');
    expect(r.fields.amountPaid).toBe(280);
  });
  it('keeps free-text stationName when stations list empty', () => {
    const r = parseQuickEntry(FAIL_SENTENCE, [vehicles[0]], {
      now: new Date('2026-10-09T14:30:00+08:00'),
      stations: [],
    });
    expect(r.fields.stationName).toBe('中凯');
    expect(r.fields.stationId).toBeUndefined();
  });

  it('parses exact fail sentence with sole ICE vehicle', () => {
    const now = new Date('2026-10-09T14:30:00+08:00');
    const r = parseQuickEntry(FAIL_SENTENCE, [vehicles[0], vehicles[2]], { now });
    expect(r.type).toBe('fuel');
    expect(r.vehicleId).toBe('v-spacy');
    expect(r.fields.stationName).toBe('中凯');
    expect(r.fields.amountPaid).toBe(280);
    expect(r.fields.amountDue).toBe(300);
    expect(r.fields.discount).toBe(20);
    expect(r.fields.unitPrice).toBe(8.72);
    expect(new Date(r.fields.date!).toDateString()).toBe(
      new Date('2026-10-08T14:30:00+08:00').toDateString(),
    );
  });

  it('parses 实付300+优惠20+7.55+42563公里 exactly (station match)', () => {
    const now = new Date('2026-10-09T15:18:00+08:00');
    const r = parseQuickEntry(SHIFU_ODO_SENTENCE, [vehicles[0], vehicles[2]], {
      now,
      stations,
    });
    expect(r.type).toBe('fuel');
    expect(r.vehicleId).toBe('v-spacy');
    expect(r.fields.stationName).toBe('中凯石油窑头路');
    expect(r.fields.stationId).toBe('st-zhongkai');
    expect(r.fields.amountPaid).toBe(300);
    expect(r.fields.discount).toBe(20);
    expect(r.fields.amountDue).toBe(320);
    expect(r.fields.unitPrice).toBe(7.55);
    expect(r.fields.odometer).toBe(42563);
    expect(r.fields.liters).toBeCloseTo(300 / 7.55, 3);
    expect(isParseReady(r)).toBe(true);
  });
});
