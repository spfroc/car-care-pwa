import { describe, expect, it } from 'vitest';
import {
  detectRecordTypes,
  extractFields,
  isParseReady,
  matchVehicles,
  parseQuickEntry,
} from './quickEntryParse';

const vehicles = [
  { id: 'v-spacy', name: 'Spacy125', plate: '鲁AZ7G61' },
  { id: 'v-xrv', name: 'X-RV', plate: '鲁A4GC10' },
  { id: 'v-ev', name: '城市纯电轿车', plate: '沪A12345' },
];

describe('detectRecordTypes', () => {
  it('detects fuel from 加油 / 升', () => {
    expect(detectRecordTypes('今天加油花了 320 元')).toEqual(['fuel']);
    expect(detectRecordTypes('加了 40 升')).toEqual(['fuel']);
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
  it('leaves vehicle unset when not mentioned', () => {
    const r = parseQuickEntry('加油 100 元', vehicles);
    expect(r.vehicleId).toBeUndefined();
    expect(r.type).toBe('fuel');
    expect(isParseReady(r)).toBe(false);
  });
});
