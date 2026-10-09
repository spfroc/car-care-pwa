import { allowsCharge, allowsFuel } from './energy';
import type { AmountDialectPreference, EnergyType, ParkingKind, RecordType, Station, StationType, Vehicle } from '../types';
export type { AmountDialectPreference };

/** Prefill payload passed to the record form (never written to IDB by itself). */
export type QuickEntryPrefill = {
  amountPaid?: number;
  amountDue?: number;
  discount?: number;
  liters?: number;
  kWh?: number;
  odometer?: number;
  unitPrice?: number;
  stationName?: string;
  /** Matched favorite/common station id when short name resolves. */
  stationId?: string;
  fuelGrade?: string;
  note?: string;
  place?: string;
  route?: string;
  title?: string;
  parkingKind?: ParkingKind;
  insurer?: string;
  policyName?: string;
  /** ISO datetime for form date field (e.g. relative 昨天/今天). */
  date?: string;
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
  /** Raw station snippet before favorite / learned match expanded the name. */
  stationQuery?: string;
};

export type VehicleMatchInput = Pick<Vehicle, 'id' | 'name' | 'plate'> & {
  energyType?: EnergyType;
  /** Spoken / typed short names that should resolve to this vehicle (incl. learned). */
  aliases?: string[];
  /** ISO time of most recent fuel record for this vehicle. */
  lastFuelAt?: string;
  /** ISO time of most recent charge record for this vehicle. */
  lastChargeAt?: string;
};


export type StationMatchInput = Pick<Station, 'id' | 'name' | 'stationType'> & {
  brand?: string;
  /** Spoken / typed short names that should resolve to this station. */
  aliases?: string[];
};

export type ParseQuickEntryOptions = {
  /** Clock for relative dates (昨天/今天); defaults to now. */
  now?: Date;
  /** Favorite / common stations for short-name → stationId matching. */
  stations?: StationMatchInput[];
  /**
   * Learned station aliases applied before generic name/brand rules.
   * Prefer exact alias → stationId when the station is in `stations`.
   */
  learnedStationAliases?: Array<{ alias: string; stationId: string; stationName: string }>;
  /** Learned vehicle aliases merged into vehicle match inputs. */
  learnedVehicleAliases?: Array<{ alias: string; vehicleId: string }>;
  /**
   * When bare「N块」+优惠: prefer treating bare as 实付 (paid) or 应付 (due).
   * Default (unset): bareAsDue (current generic rule).
   */
  amountDialect?: AmountDialectPreference;
};

/** Keyword rules: longer / more specific phrases first within each type. */
const TYPE_RULES: { type: RecordType; patterns: RegExp[] }[] = [
  {
    type: 'fuel',
    patterns: [
      /加(?:了|了个)?\s*\d/i,
      /加了?.{0,12}油/,
      /加油/,
      /汽油/,
      /柴油/,
      /燃油/,
      /\d+(?:\.\d+)?\s*(?:L|升|公升)/i,
      /\d+\s*块(?:\s*\d+\s*毛)?(?:\s*\d+\s*分?)?\s*(?:一|\/|每)\s*(?:升|L)/i,
    ],
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
    // Learned / explicit aliases (before generic sole-vehicle fallback)
    for (const alias of v.aliases ?? []) {
      const a = normalizeLoose(alias);
      if (!a || a.length < 2) continue;
      if (loose.includes(a) || a === loose) score = Math.max(score, 95 + a.length);
      else {
        const aliasRe = new RegExp(escapeRegExp(alias), 'i');
        if (aliasRe.test(raw)) score = Math.max(score, 90 + alias.length);
      }
    }
    if (score > 0) scored.push({ v, score });
  }

  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return [];

  const top = scored[0].score;
  // Keep near-ties as ambiguous
  return scored.filter((s) => s.score >= top - 15).map((s) => s.v);
}


/**
 * Match stations by exact / prefix / substring name, brand, or alias.
 * Longer and more specific matches rank higher; optional preferredType boosts gas/charge.
 */
export function matchStations(
  query: string,
  stations: StationMatchInput[],
  preferredType?: StationType,
): StationMatchInput[] {
  if (!stations.length) return [];
  const q = normalizeLoose(query.trim());
  if (!q || q.length < 1) return [];

  // Learned / explicit aliases first: exact alias match outranks generic name/brand.
  const exactAliasHits: StationMatchInput[] = [];
  for (const s of stations) {
    for (const alias of s.aliases ?? []) {
      if (normalizeLoose(alias) === q) {
        exactAliasHits.push(s);
        break;
      }
    }
  }
  if (exactAliasHits.length === 1) {
    return exactAliasHits;
  }

  const scored: { s: StationMatchInput; score: number }[] = [];

  for (const s of stations) {
    let score = 0;
    const name = normalizeLoose(s.name);
    const brand = s.brand ? normalizeLoose(s.brand) : '';

    if (name) {
      if (name === q) score = Math.max(score, 120 + name.length);
      else if (name.startsWith(q)) score = Math.max(score, 100 + q.length);
      else if (q.startsWith(name) && name.length >= 2) score = Math.max(score, 90 + name.length);
      else if (q.length >= 2 && name.includes(q)) score = Math.max(score, 80 + q.length);
      else if (name.length >= 2 && q.includes(name)) score = Math.max(score, 70 + name.length);
    }

    if (brand) {
      if (brand === q) score = Math.max(score, 95 + brand.length);
      else if (brand.startsWith(q) || (q.length >= 2 && brand.includes(q))) {
        score = Math.max(score, 75 + Math.min(q.length, brand.length));
      }
    }

    for (const alias of s.aliases ?? []) {
      const a = normalizeLoose(alias);
      if (!a) continue;
      if (a === q) score = Math.max(score, 200 + a.length); // learned/explicit alias
      else if (a.startsWith(q) || q.startsWith(a)) score = Math.max(score, 95 + Math.min(a.length, q.length));
      else if (q.length >= 2 && (a.includes(q) || q.includes(a))) {
        score = Math.max(score, 85 + Math.min(a.length, q.length));
      }
    }

    if (score > 0) {
      if (preferredType && s.stationType === preferredType) score += 15;
      scored.push({ s, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || b.s.name.length - a.s.name.length);
  if (!scored.length) return [];

  const top = scored[0].score;
  return scored.filter((x) => x.score >= top - 15).map((x) => x.s);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function num(m: RegExpMatchArray | null, group = 1): number | undefined {
  if (!m?.[group]) return undefined;
  const n = Number(m[group]);
  return Number.isFinite(n) ? n : undefined;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parse Chinese money like `8块7毛2` / `8块7毛2分` / `3块5` → decimal yuan.
 * Returns undefined if the chunk is not a 块/毛/分 form.
 */
export function parseChineseYuan(chunk: string): number | undefined {
  const t = chunk.replace(/\s+/g, '');
  const m = t.match(/^(\d+)块(?:(\d+)毛)?(?:(\d+)分?)?$/);
  if (!m) return undefined;
  const yuan = Number(m[1]);
  const jiao = m[2] != null ? Number(m[2]) : 0;
  const fen = m[3] != null ? Number(m[3]) : 0;
  if (![yuan, jiao, fen].every((x) => Number.isFinite(x))) return undefined;
  return roundMoney(yuan + jiao / 10 + fen / 100);
}

function shiftLocalDay(base: Date, deltaDays: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + deltaDays);
  return d;
}

/** Resolve 昨天/今天/前天 relative to `now` → ISO string. */
export function extractRelativeDate(text: string, now: Date = new Date()): string | undefined {
  if (/大前天/.test(text)) return shiftLocalDay(now, -3).toISOString();
  if (/前天/.test(text)) return shiftLocalDay(now, -2).toISOString();
  if (/昨天|昨日/.test(text)) return shiftLocalDay(now, -1).toISOString();
  if (/今天|今日/.test(text)) return now.toISOString();
  return undefined;
}

/**
 * When plate/name is omitted: sole vehicle, sole fuel/charge-capable for the
 * detected type, or most-recently-used for that type.
 */
export function resolveVehicleWithoutMention(
  vehicles: VehicleMatchInput[],
  preferredType?: RecordType,
): { vehicles: VehicleMatchInput[]; confidence: MatchConfidence; picked?: VehicleMatchInput } {
  if (!vehicles.length) return { vehicles: [], confidence: 'none' };

  if (vehicles.length === 1) {
    return { vehicles, confidence: 'high', picked: vehicles[0] };
  }

  if (preferredType === 'fuel') {
    const capable = vehicles.filter((v) => (v.energyType ? allowsFuel(v.energyType) : true));
    if (capable.length === 1) {
      return { vehicles: capable, confidence: 'high', picked: capable[0] };
    }
    if (capable.length > 1) {
      const ranked = [...capable].sort((a, b) => {
        const ta = a.lastFuelAt ?? '';
        const tb = b.lastFuelAt ?? '';
        return tb.localeCompare(ta);
      });
      if (ranked[0]?.lastFuelAt) {
        return { vehicles: capable, confidence: 'low', picked: ranked[0] };
      }
      // Multiple fuel vehicles, no recency signal → ask user (list fuel-capable).
      return { vehicles: capable, confidence: 'low' };
    }
  }

  if (preferredType === 'charge') {
    const capable = vehicles.filter((v) =>
      v.energyType ? allowsCharge(v.energyType, true) : true,
    );
    if (capable.length === 1) {
      return { vehicles: capable, confidence: 'high', picked: capable[0] };
    }
    if (capable.length > 1) {
      const ranked = [...capable].sort((a, b) => {
        const ta = a.lastChargeAt ?? '';
        const tb = b.lastChargeAt ?? '';
        return tb.localeCompare(ta);
      });
      if (ranked[0]?.lastChargeAt) {
        return { vehicles: capable, confidence: 'low', picked: ranked[0] };
      }
      return { vehicles: capable, confidence: 'low' };
    }
  }

  return { vehicles: [], confidence: 'none' };
}

/** Build match inputs from vehicles + optional records (last fuel/charge times). */
export function buildVehicleMatchInputs(
  vehicles: Pick<Vehicle, 'id' | 'name' | 'plate' | 'energyType'>[],
  records?: { vehicleId: string; type: string; date: string }[],
): VehicleMatchInput[] {
  const lastFuel = new Map<string, string>();
  const lastCharge = new Map<string, string>();
  if (records) {
    for (const r of records) {
      if (r.type === 'fuel') {
        const prev = lastFuel.get(r.vehicleId);
        if (!prev || r.date > prev) lastFuel.set(r.vehicleId, r.date);
      } else if (r.type === 'charge') {
        const prev = lastCharge.get(r.vehicleId);
        if (!prev || r.date > prev) lastCharge.set(r.vehicleId, r.date);
      }
    }
  }
  return vehicles.map((v) => ({
    id: v.id,
    name: v.name,
    plate: v.plate,
    energyType: v.energyType,
    lastFuelAt: lastFuel.get(v.id),
    lastChargeAt: lastCharge.get(v.id),
  }));
}

/** Pull common numeric / string fields from free text. */
export function extractFields(
  text: string,
  preferredType?: RecordType,
  now: Date = new Date(),
  amountDialect: AmountDialectPreference = 'bareAsDue',
): QuickEntryPrefill {
  const fields: QuickEntryPrefill = {};

  const relDate = extractRelativeDate(text, now);
  if (relDate) fields.date = relDate;

  // Strip unit-price and discount spans before scanning generic amounts,
  // so `8块7毛2一升` / `优惠20块` are not mistaken for the fill total.
  let work = text;
  const cnUnit = work.match(
    /(\d+\s*块(?:\s*\d+\s*毛)?(?:\s*\d+\s*分?)?)\s*(?:一|\/|每)\s*(?:升|L)/i,
  );
  if (cnUnit?.[1]) {
    const u = parseChineseYuan(cnUnit[1].replace(/\s+/g, ''));
    if (u != null) fields.unitPrice = u;
    work = work.replace(cnUnit[0], ' ');
  }
  if (fields.unitPrice == null) {
    const unitM =
      work.match(/单价\s*[为是:]?\s*(\d+(?:\.\d+)?)/) ??
      work.match(/(\d+(?:\.\d+)?)\s*(?:元|块)\s*(?:一|\/|每)\s*(?:升|L)/i) ??
      work.match(/(\d+(?:\.\d+)?)\s*元\s*\/\s*[Ll升]/);
    const unit = num(unitM);
    if (unit != null) {
      fields.unitPrice = unit;
      if (unitM) work = work.replace(unitM[0], ' ');
    }
  }

  const discountM = work.match(/优惠\s*(\d+(?:\.\d+)?)\s*(?:元|块钱|块)?/);
  if (discountM) {
    fields.discount = num(discountM);
    work = work.replace(discountM[0], ' ');
  }

  // Explicit 实付 / 应付 before bare amounts.
  // 实付 N + 优惠 D → paid=N, due=N+D; 应付 N + 优惠 → due=N, paid=N-D.
  const paidExplicitM = work.match(
    /实付(?:金额)?\s*[为是:]?\s*(\d+(?:\.\d+)?)\s*(?:元|块钱|块)?/,
  );
  const dueExplicitM = work.match(
    /应付(?:金额)?\s*[为是:]?\s*(\d+(?:\.\d+)?)\s*(?:元|块钱|块)?/,
  );
  const paidExplicit = num(paidExplicitM);
  const dueExplicit = num(dueExplicitM);
  if (paidExplicitM) work = work.replace(paidExplicitM[0], ' ');
  if (dueExplicitM) work = work.replace(dueExplicitM[0], ' ');

  // Bare / fuel phrasing `加了300块的油` (no 实付/应付): may mean due or paid.
  const dueFromFuel =
    num(work.match(/加(?:了|了个)?\s*(\d+(?:\.\d+)?)\s*(?:元|块钱|块)(?:钱)?(?:的油)?/)) ??
    num(work.match(/(\d+(?:\.\d+)?)\s*(?:元|块钱|块)\s*的油/));
  const yen = work.match(/(?:¥|￥)\s*(\d+(?:\.\d+)?)/);
  const yuanBare = work.match(/(\d+(?:\.\d+)?)\s*(?:元|块钱|块)/);
  const bareGross = dueFromFuel ?? num(yen) ?? num(yuanBare);

  if (paidExplicit != null) {
    fields.amountPaid = roundMoney(paidExplicit);
    if (dueExplicit != null) {
      fields.amountDue = roundMoney(dueExplicit);
    } else if (fields.discount != null && fields.discount > 0) {
      fields.amountDue = roundMoney(paidExplicit + fields.discount);
    }
  } else if (dueExplicit != null) {
    fields.amountDue = roundMoney(dueExplicit);
    if (fields.discount != null && fields.discount > 0) {
      fields.amountPaid = roundMoney(Math.max(0, dueExplicit - fields.discount));
    } else {
      fields.amountPaid = roundMoney(dueExplicit);
    }
  } else if (bareGross != null && fields.discount != null && fields.discount > 0) {
    // Bare amount + 优惠: default 应付 (due); learned dialect may prefer 实付 (paid).
    if (amountDialect === 'bareAsPaid') {
      fields.amountPaid = roundMoney(bareGross);
      fields.amountDue = roundMoney(bareGross + fields.discount);
    } else {
      fields.amountDue = roundMoney(bareGross);
      fields.amountPaid = roundMoney(Math.max(0, bareGross - fields.discount));
    }
  } else if (bareGross != null) {
    fields.amountPaid = roundMoney(bareGross);
  }

  const liters = num(text.match(/(\d+(?:\.\d+)?)\s*(?:L|升|公升)/i));
  if (liters != null) fields.liters = liters;

  const kWh = num(text.match(/(\d+(?:\.\d+)?)\s*(?:度|kWh|千瓦时)/i));
  if (kWh != null) fields.kWh = kWh;

  // Note: do not use \b after 公里 — JS word boundaries fail at CJK / end-of-string.
  const odo =
    num(text.match(/(?:里程|码表|表显|行驶里程)\s*[为是:]?\s*(\d{3,7})/i)) ??
    num(text.match(/(\d{4,7})\s*(?:公里|千米|km)\b/i)) ??
    num(text.match(/(\d{4,7})\s*(?:公里|千米)/i));
  if (odo != null) fields.odometer = odo;

  const grade = text.match(/(?:^|[^0-9])(92|95|98)\s*[#号]?/) ?? text.match(/(0\s*#\s*柴油)/);
  if (grade) {
    const g = grade[1].replace(/\s+/g, '');
    fields.fuelGrade = g.includes('柴油') ? '0#柴油' : `${g.replace('#', '')}#`;
  }

  const station =
    text.match(/(?:在|于)\s*([^\s，,。、]{1,16}?)\s*(?:加(?:了|油)|充(?:了|电)|停(?:了|车))/) ??
    text.match(/(?:在|于)\s*([^\s，,。]{2,20}?(?:加油站|充电站|加油站点))/) ??
    text.match(
      /((?:中石化|中石油|壳牌|道达尔|国家电网|特来电|小桔|星星|中凯)[^\s，,。]{0,12})/,
    );
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

  // Derive liters from paid/due ÷ unit price when not spoken.
  // Prefer 实付 (amountPaid) when present; else 应付.
  if (fields.liters == null && fields.unitPrice != null && fields.unitPrice > 0) {
    const basis = fields.amountPaid ?? fields.amountDue;
    if (basis != null && basis > 0) {
      fields.liters = Math.round((basis / fields.unitPrice) * 1000) / 1000;
    }
  }

  const trimmed = text.trim();
  if (trimmed) fields.note = trimmed;

  return fields;
}

/**
 * Local-only parse: vehicle first, then record type + field guesses.
 * Ambiguous matches leave multiple candidates and omit the singular id/type.
 */
export function parseQuickEntry(
  text: string,
  vehicles: VehicleMatchInput[],
  options: ParseQuickEntryOptions = {},
): QuickEntryParseResult {
  const raw = text.trim();
  const now = options.now ?? new Date();

  // Merge learned vehicle aliases before generic plate/name rules.
  let vehicleInputs = vehicles;
  if (options.learnedVehicleAliases?.length) {
    vehicleInputs = vehicles.map((v) => {
      const extras = options.learnedVehicleAliases!
        .filter((a) => a.vehicleId === v.id)
        .map((a) => a.alias);
      if (!extras.length) return v;
      return { ...v, aliases: [...new Set([...(v.aliases ?? []), ...extras])] };
    });
  }

  // 1) Vehicle-first: explicit plate/name/alias, else sole / fuel-capable / last-used.
  const explicitHits = matchVehicles(raw, vehicleInputs);
  const typeHitsEarly = detectRecordTypes(raw);
  const earlyType = typeHitsEarly.length === 1 ? typeHitsEarly[0] : undefined;

  let vehicleHits = explicitHits;
  let vehicleConf: MatchConfidence = 'none';
  let vehicleId: string | undefined;

  if (explicitHits.length === 1) {
    vehicleId = explicitHits[0].id;
    vehicleConf = 'high';
  } else if (explicitHits.length > 1) {
    vehicleConf = 'low';
  } else {
    const fb = resolveVehicleWithoutMention(vehicleInputs, earlyType);
    vehicleHits = fb.vehicles.length ? fb.vehicles : [];
    vehicleConf = fb.confidence;
    if (fb.picked) vehicleId = fb.picked.id;
  }

  // 2) Type (+ fields)
  const typeHits = typeHitsEarly;
  let typeConf: MatchConfidence = 'none';
  let type: RecordType | undefined;
  if (typeHits.length === 1) {
    type = typeHits[0];
    typeConf = 'high';
  } else if (typeHits.length > 1) {
    typeConf = 'low';
  }

  const dialect = options.amountDialect ?? 'bareAsDue';
  const fields = extractFields(raw, type ?? typeHits[0], now, dialect);
  const stationQuery = fields.stationName;

  // 3) Resolve spoken/typed short station name → favorite / learned station.
  let stations = options.stations ?? [];
  if (options.learnedStationAliases?.length) {
    stations = stations.map((s) => {
      const extras = options.learnedStationAliases!
        .filter((a) => a.stationId === s.id)
        .map((a) => a.alias);
      if (!extras.length) return s;
      return { ...s, aliases: [...new Set([...(s.aliases ?? []), ...extras])] };
    });
    // If learned alias points at a station id not yet in list, still resolve by id map.
    if (stationQuery) {
      const q = stationQuery.replace(/\s+/g, '').toLowerCase();
      const learnedHit = options.learnedStationAliases.filter(
        (a) => a.alias.replace(/\s+/g, '').toLowerCase() === q,
      );
      if (learnedHit.length === 1) {
        const hit = learnedHit[0];
        const inList = stations.find((s) => s.id === hit.stationId);
        if (inList) {
          fields.stationId = inList.id;
          fields.stationName = inList.name;
        } else {
          fields.stationId = hit.stationId;
          fields.stationName = hit.stationName;
        }
      }
    }
  }

  if (fields.stationName && stations.length && !fields.stationId) {
    const preferredStationType: StationType | undefined =
      type === 'fuel' || typeHits[0] === 'fuel'
        ? 'gas'
        : type === 'charge' || typeHits[0] === 'charge'
          ? 'charge'
          : undefined;
    const stationHits = matchStations(
      stationQuery ?? fields.stationName,
      stations,
      preferredStationType,
    );
    if (stationHits.length === 1) {
      fields.stationId = stationHits[0].id;
      fields.stationName = stationHits[0].name;
    }
    // Ambiguous (≥2 near-ties): keep free-text stationName only.
  }

  return {
    raw,
    vehicleId,
    vehicleIds: vehicleHits.map((v) => v.id),
    type,
    types: typeHits,
    confidence: { vehicle: vehicleConf, type: typeConf },
    fields,
    stationQuery,
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
