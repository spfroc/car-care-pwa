import type { AmountDialectPreference, CareRecord, LearningRow, Vehicle } from '../types';
import type { QuickEntryPrefill } from './quickEntryParse';
import {
  normalizeAlias,
  upsertStationAlias,
  upsertVehicleAlias,
  voteAmountDialect,
} from '../repositories/learning';

/** Snapshot carried from quick-entry → form for silent learn-on-save. */
export type QuickEntryLearnSnapshot = {
  raw: string;
  vehicleId?: string;
  /** Raw station snippet before favorite match expanded the name. */
  stationQuery?: string;
  fields: QuickEntryPrefill;
  /** Nickname candidate when user overrode parsed vehicle in the sheet. */
  pendingVehicleAlias?: string;
};

export type LearnFromSaveInput = {
  snapshot: QuickEntryLearnSnapshot;
  /** Final vehicle id on the form (URL). */
  vehicleId: string;
  /** Saved record after user confirm. */
  record: CareRecord;
  vehicles?: Pick<Vehicle, 'id' | 'name' | 'plate'>[];
};

export type LearnFromSaveResult = {
  stationAlias?: LearningRow | null;
  vehicleAlias?: LearningRow | null;
  amountDialect?: LearningRow | null;
};

/**
 * Silent local learn when a quick-entry-prefilled form is saved.
 * Never uploads; only called after explicit user save.
 */
export async function learnFromQuickEntrySave(
  input: LearnFromSaveInput,
): Promise<LearnFromSaveResult> {
  const { snapshot, vehicleId, record, vehicles = [] } = input;
  const out: LearnFromSaveResult = {};

  // 1) Station alias: raw snippet → chosen station
  const stationQuery = snapshot.stationQuery?.trim();
  const savedStationId =
    'stationId' in record && record.stationId ? record.stationId : undefined;
  const savedStationName =
    'stationName' in record && record.stationName ? String(record.stationName) : undefined;

  if (stationQuery && savedStationId && savedStationName) {
    const preId = snapshot.fields.stationId;
    const preName = snapshot.fields.stationName;
    const changed =
      preId !== savedStationId ||
      (preName != null && preName !== savedStationName) ||
      !preId;
    // Learn when user confirmed a station and query is a short alias (not already full name)
    const qNorm = normalizeAlias(stationQuery);
    const nameNorm = normalizeAlias(savedStationName);
    if (changed || qNorm !== nameNorm) {
      if (qNorm.length >= 1 && qNorm !== nameNorm) {
        out.stationAlias = await upsertStationAlias({
          alias: stationQuery,
          stationId: savedStationId,
          stationName: savedStationName,
        });
      }
    }
  }

  // 2) Vehicle alias when user overrode parse pick
  const pending = snapshot.pendingVehicleAlias?.trim();
  if (pending && vehicleId) {
    const parsedVid = snapshot.vehicleId;
    if (!parsedVid || parsedVid !== vehicleId) {
      out.vehicleAlias = await upsertVehicleAlias({
        alias: pending,
        vehicleId,
      });
    }
  } else if (
    snapshot.vehicleId &&
    vehicleId &&
    snapshot.vehicleId !== vehicleId
  ) {
    const candidate = findNicknameCandidate(snapshot.raw, vehicles);
    if (candidate) {
      out.vehicleAlias = await upsertVehicleAlias({
        alias: candidate,
        vehicleId,
      });
    }
  }

  // 3) Amount dialect: bare N + 优惠 consistency
  const disc = snapshot.fields.discount;
  const hadBareDiscount =
    disc != null &&
    disc > 0 &&
    snapshot.fields.amountPaid != null &&
    snapshot.fields.amountDue != null;

  if (hadBareDiscount) {
    const savedPaid = record.amountPaid;
    const savedDue = record.amountDue;
    const savedDisc = record.discount ?? disc;
    if (savedDue != null && savedDisc != null && savedDisc > 0) {
      const vote = inferAmountDialectVote({
        parsedPaid: snapshot.fields.amountPaid!,
        parsedDue: snapshot.fields.amountDue!,
        savedPaid,
        savedDue,
        discount: savedDisc,
      });
      if (vote) {
        out.amountDialect = await voteAmountDialect(vote);
      }
    }
  }

  return out;
}

/**
 * Infer whether user treated bare amount as 实付 or 应付.
 * Default parser: bare+优惠 → due=bare, paid=bare-discount.
 */
export function inferAmountDialectVote(args: {
  parsedPaid: number;
  parsedDue: number;
  savedPaid: number;
  savedDue: number;
  discount: number;
}): AmountDialectPreference | null {
  const { parsedPaid, parsedDue, savedPaid, savedDue, discount } = args;
  const round = (n: number) => Math.round(n * 100) / 100;
  // User flipped to bare-as-paid: paid≈parsedDue (bare), due≈bare+discount
  if (
    round(savedPaid) === round(parsedDue) &&
    round(savedDue) === round(parsedDue + discount)
  ) {
    return 'bareAsPaid';
  }
  // User confirmed default bare-as-due
  if (
    round(savedPaid) === round(parsedPaid) &&
    round(savedDue) === round(parsedDue)
  ) {
    return 'bareAsDue';
  }
  // Direct pattern from saved values alone
  if (round(savedDue - savedPaid) === round(discount)) {
    // If paid == parsed due (bare was kept as paid), that's bareAsPaid
    if (round(savedPaid) === round(parsedDue)) return 'bareAsPaid';
    if (round(savedDue) === round(parsedDue)) return 'bareAsDue';
  }
  return null;
}

const STRIP_FOR_NICK =
  /昨天|今日|今天|前日|前天|大前天|实付|应付|优惠|加油|充电|停车|高速|保险|保养|洗车|维保|维修|改装|罚单|违章|给|把|将|在|于|加了|加了个|的油|块钱|块|毛|分|升|公升|度|元|公里|千米|千瓦时/g;

/**
 * Pull a plausible vehicle nickname from utterance (not a known plate/name).
 */
export function findNicknameCandidate(
  raw: string,
  vehicles: Pick<Vehicle, 'id' | 'name' | 'plate'>[],
): string | undefined {
  const known = new Set<string>();
  for (const v of vehicles) {
    if (v.name) known.add(normalizeAlias(v.name));
    if (v.plate) known.add(normalizeAlias(v.plate.replace(/[\s·\-_.]/g, '')));
  }
  const work = raw.replace(STRIP_FOR_NICK, ' ');
  const cjk = work.match(/[\u4e00-\u9fff]{2,8}/g) ?? [];
  const latin = work.match(/[A-Za-z][A-Za-z0-9\-_]{1,20}/g) ?? [];
  for (const t of [...cjk, ...latin]) {
    const n = normalizeAlias(t);
    if (n.length < 2) continue;
    if (known.has(n)) continue;
    if (/^\d+$/.test(n)) continue;
    if (/中石化|中石油|壳牌|道达尔|特来电|国家电网|中凯|小桔|星星/.test(t)) continue;
    return t.trim();
  }
  return undefined;
}

/** Merge learned station aliases into match inputs (prepended / preferred). */
export function mergeStationAliases<
  T extends { id: string; name: string; aliases?: string[] },
>(
  stations: T[],
  learned: Array<{ alias: string; stationId: string; stationName: string }>,
): T[] {
  if (!learned.length) return stations;
  return stations.map((s) => {
    const extras = learned
      .filter((a) => a.stationId === s.id)
      .map((a) => a.alias);
    if (!extras.length) return s;
    const aliases = [...new Set([...(s.aliases ?? []), ...extras])];
    return { ...s, aliases };
  });
}

/** Merge learned vehicle aliases into match inputs. */
export function mergeVehicleAliases<
  T extends { id: string; name: string; aliases?: string[] },
>(
  vehicles: T[],
  learned: Array<{ alias: string; vehicleId: string }>,
): T[] {
  if (!learned.length) return vehicles;
  return vehicles.map((v) => {
    const extras = learned.filter((a) => a.vehicleId === v.id).map((a) => a.alias);
    if (!extras.length) return v;
    const aliases = [...new Set([...(v.aliases ?? []), ...extras])];
    return { ...v, aliases };
  });
}
