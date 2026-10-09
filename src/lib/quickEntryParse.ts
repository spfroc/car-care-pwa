import type { ParkingKind, RecordType, Vehicle } from '../types';

/** Prefill payload passed to the record form (never written to IDB by itself). */
export type QuickEntryPrefill = {
  amountPaid?: number;
  amountDue?: number;
  liters?: number;
  kWh?: number;
  odometer?: number;
  unitPrice?: number;
  stationName?: string;
  fuelGrade?: string;
  note?: string;
  place?: string;
  route?: string;
  title?: string;
  parkingKind?: ParkingKind;
  insurer?: string;
  policyName?: string;
};

export type MatchConfidence = 'high' | 'low' | 'none';

export type QuickEntryParseResult = {
  raw: string;
  vehicleId?: string;
  vehicleIds: string[];
  type?: RecordType;
  types: RecordType[];
  confidence: { vehicle: MatchConfidence; type: MatchConfidence };
  fields: QuickEntryPrefill;
};

export type VehicleMatchInput = Pick<Vehicle, 'id' | 'name' | 'plate'>;

/** Keyword rules: longer / more specific phrases first within each type. */
const TYPE_RULES: { type: RecordType; patterns: RegExp[] }[] = [
  {
    type: 'fuel',
    patterns: [/加(?:了|了个)?\s*\d/i, /加油/, /汽油/, /柴油/, /燃油/, /\d+(?:\.\d+)?\s*(?:L|升|公升)/i],
  },
  {
    type: 'charge',
    patterns: [/充电/, /补电/, /\d+(?:\.\d+)?\s*(?:度|kWh|千瓦时)/i],
  },
  {
    type: 'parking',
    patterns: [/停车费/, /停车/, /泊车/],
  },
  {
    type: 'toll',
    patterns: [/高速费/, /高速/, /通行费/, /过路费/, /\bETC\b/i, /过桥费/],
  },
  {
    type: 'insurance',
    patterns: [/交强险/, /商业险/, /车险/, /保险费/, /保险/],
  },
  {
    type: 'maintenance',
    patterns: [/保养/, /维保/, /维修/, /换机油/, /做保养/, /检修/],
  },
  {
    type: 'wash',
    patterns: [/洗车/, /精洗/, /打蜡/, /镀膜/, /内饰清洗/],
  },
  {
    type: 'goods',
    patterns: [/配件/, /滤芯/, /机油滤/, /空气滤/, /雨刷/, /买了(?:个|只|条)?/],
  },
  {
    type: 'ticket',
    patterns: [/罚单/, /违章/, /罚款/, /扣分/, /电子眼/],
  },
  {
    type: 'modification',
    patterns: [/改装/, /包围/, /轮毂/, /尾翼/, /排气改装/],
  },
];

function normalizePlate(s: string): string {
  return s.replace(/[\s·\-_.]/g, '').toUpperCase();
}

function normalizeLoose(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/** Extract record-type candidates from utterance (rule / regex). */
export function detectRecordTypes(text: string): RecordType[] {
  const hits: RecordType[] = [];
  for (const rule of TYPE_RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      if (!hits.includes(rule.type)) hits.push(rule.type);
    }
  }
  // Prefer fuel over charge when both "升" and vague energy words; keep both if explicit.
  if (hits.includes('fuel') && hits.includes('charge')) {
    const hasFuelKw = /加油|汽油|柴油|燃油|升|公升|\bL\b/i.test(text);
    const hasChargeKw = /充电|补电|度|kWh|千瓦时/i.test(text);
    if (hasFuelKw && !hasChargeKw) return ['fuel'];
    if (hasChargeKw && !/加油|汽油|柴油|燃油/.test(text)) return ['charge'];
  }
  return hits;
}

/**
 * Match vehicles by plate (normalized substring) or nickname (name substring).
 * Longer plate/name matches rank higher.
 */
export function matchVehicles(text: string, vehicles: VehicleMatchInput[]): VehicleMatchInput[] {
  if (!vehicles.length) return [];
  const raw = text.trim();
  if (!raw) return [];

  const plateNorm = normalizePlate(raw);
  const loose = normalizeLoose(raw);
  const scored: { v: VehicleMatchInput; score: number }[] = [];

  for (const v of vehicles) {
    let score = 0;
    if (v.plate) {
      const p = normalizePlate(v.plate);
      if (p && plateNorm.includes(p)) score = Math.max(score, 100 + p.length);
      else if (p && p.length >= 4 && plateNorm.includes(p.slice(-4))) score = Math.max(score, 80);
      // Plate fragment spoken without province char, e.g. "AZ7G61"
      else if (p.length >= 5) {
        const tail = p.slice(1);
        if (plateNorm.includes(tail)) score = Math.max(score, 90 + tail.length);
      }
    }
    if (v.name) {
      const n = normalizeLoose(v.name);
      if (n && (loose.includes(n) || n.includes(loose))) {
        // Avoid matching tiny substrings of the whole utterance when name is long
        if (loose.includes(n)) score = Math.max(score, 70 + n.length);
      }
      // Token-ish: name appears as contiguous run in original (case-insensitive for ASCII)
      const nameRe = new RegExp(escapeRegExp(v.name), 'i');
      if (nameRe.test(raw)) score = Math.max(score, 75 + v.name.length);
    }
    if (score > 0) scored.push({ v, score });
  }

  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return [];

  const top = scored[0].score;
  // Keep near-ties as ambiguous
  return scored.filter((s) => s.score >= top - 15).map((s) => s.v);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function num(m: RegExpMatchArray | null, group = 1): number | undefined {
  if (!m?.[group]) return undefined;
  const n = Number(m[group]);
  return Number.isFinite(n) ? n : undefined;
}

/** Pull common numeric / string fields from free text. */
export function extractFields(text: string, preferredType?: RecordType): QuickEntryPrefill {
  const fields: QuickEntryPrefill = {};

  const yen = text.match(/(?:¥|￥)\s*(\d+(?:\.\d+)?)/);
  const yuan = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块钱|块)/);
  const paid = num(yen) ?? num(yuan);
  if (paid != null) fields.amountPaid = paid;

  const liters = num(text.match(/(\d+(?:\.\d+)?)\s*(?:L|升|公升)/i));
  if (liters != null) fields.liters = liters;

  const kWh = num(text.match(/(\d+(?:\.\d+)?)\s*(?:度|kWh|千瓦时)/i));
  if (kWh != null) fields.kWh = kWh;

  const odo =
    num(text.match(/(?:里程|码表|表显)\s*[为是:]?\s*(\d{3,7})/i)) ??
    num(text.match(/(\d{4,7})\s*(?:公里|千米|km)\b/i));
  if (odo != null) fields.odometer = odo;

  const unit =
    num(text.match(/单价\s*[为是:]?\s*(\d+(?:\.\d+)?)/)) ??
    num(text.match(/(\d+(?:\.\d+)?)\s*元\s*\/\s*[Ll升]/));
  if (unit != null) fields.unitPrice = unit;

  const grade = text.match(/(?:^|[^0-9])(92|95|98)\s*[#号]?/) ?? text.match(/(0\s*#\s*柴油)/);
  if (grade) {
    const g = grade[1].replace(/\s+/g, '');
    fields.fuelGrade = g.includes('柴油') ? '0#柴油' : `${g.replace('#', '')}#`;
  }

  const station =
    text.match(/(?:在|于)\s*([^\s，,。]{2,20}?(?:加油站|充电站|加油站点))/) ??
    text.match(/((?:中石化|中石油|壳牌|道达尔|国家电网|特来电|小桔|星星)[^\s，,。]{0,12})/);
  if (station?.[1]) fields.stationName = station[1];

  const place = text.match(/(?:在|于)\s*([^\s，,。]{2,20}?(?:停车场|车库|商场|小区))/);
  if (place?.[1]) fields.place = place[1];

  const route = text.match(/(?:走了?|从)?\s*([^\s，,。]{2,30}?(?:高速|高速路|路段))/);
  if (route?.[1]) fields.route = route[1];

  if (/固定停车|月租|包月/.test(text)) fields.parkingKind = 'fixed';
  else if (/临时停车|临停/.test(text)) fields.parkingKind = 'temporary';

  const insurer = text.match(/((?:人保|平安|太平洋|大地|阳光|太平)[^\s，,。]{0,8})/);
  if (insurer?.[1]) fields.insurer = insurer[1];

  if (/交强险\s*\+?\s*商业险|交商/.test(text)) fields.policyName = '交强险+商业险';
  else if (/交强险/.test(text)) fields.policyName = '交强险';
  else if (/商业险/.test(text)) fields.policyName = '商业险';

  // Soft title for maintenance / mod / goods
  if (preferredType === 'maintenance' || preferredType === 'modification') {
    const t = text.match(/(?:保养|维修|维保|改装)\s*([^\s，,。]{2,20})/);
    if (t?.[1]) fields.title = t[1];
  }

  const trimmed = text.trim();
  if (trimmed) fields.note = trimmed;

  return fields;
}

/**
 * Local-only parse: vehicle + record type + field guesses.
 * Ambiguous matches leave multiple candidates and omit the singular id/type.
 */
export function parseQuickEntry(
  text: string,
  vehicles: VehicleMatchInput[],
): QuickEntryParseResult {
  const raw = text.trim();
  const vehicleHits = matchVehicles(raw, vehicles);
  const typeHits = detectRecordTypes(raw);

  let vehicleConf: MatchConfidence = 'none';
  let vehicleId: string | undefined;
  if (vehicleHits.length === 1) {
    vehicleId = vehicleHits[0].id;
    vehicleConf = 'high';
  } else if (vehicleHits.length > 1) {
    vehicleConf = 'low';
  }

  let typeConf: MatchConfidence = 'none';
  let type: RecordType | undefined;
  if (typeHits.length === 1) {
    type = typeHits[0];
    typeConf = 'high';
  } else if (typeHits.length > 1) {
    typeConf = 'low';
  }

  const fields = extractFields(raw, type ?? typeHits[0]);

  return {
    raw,
    vehicleId,
    vehicleIds: vehicleHits.map((v) => v.id),
    type,
    types: typeHits,
    confidence: { vehicle: vehicleConf, type: typeConf },
    fields,
  };
}

/** True when both vehicle and type are uniquely resolved (ready to navigate). */
export function isParseReady(r: QuickEntryParseResult): boolean {
  return !!r.vehicleId && !!r.type;
}

export const RECORD_TYPES_ALL: RecordType[] = [
  'fuel',
  'charge',
  'maintenance',
  'modification',
  'wash',
  'goods',
  'ticket',
  'parking',
  'toll',
  'insurance',
];
