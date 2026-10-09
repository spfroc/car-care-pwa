import { getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { AmountDialectPreference, LearningRow } from '../types';

export function stationAliasKey(alias: string): string {
  return `stationAlias:${normalizeAlias(alias)}`;
}

export function vehicleAliasKey(alias: string): string {
  return `vehicleAlias:${normalizeAlias(alias)}`;
}

export const AMOUNT_DIALECT_KEY = 'amountDialect';

export function normalizeAlias(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

export async function listLearning(): Promise<LearningRow[]> {
  return (await getDB()).getAll('learning');
}

export async function listStationAliases(): Promise<LearningRow[]> {
  const db = await getDB();
  return db.getAllFromIndex('learning', 'byKind', 'stationAlias');
}

export async function listVehicleAliases(): Promise<LearningRow[]> {
  const db = await getDB();
  return db.getAllFromIndex('learning', 'byKind', 'vehicleAlias');
}

export async function getAmountDialect(): Promise<LearningRow | undefined> {
  return (await getDB()).get('learning', AMOUNT_DIALECT_KEY);
}

export async function upsertStationAlias(input: {
  alias: string;
  stationId: string;
  stationName: string;
}): Promise<LearningRow | null> {
  const alias = input.alias.trim();
  if (!alias || alias.length < 1) return null;
  if (!input.stationId) return null;
  const key = stationAliasKey(alias);
  const db = await getDB();
  const existing = await db.get('learning', key);
  const t = nowISO();
  const row: LearningRow = {
    key,
    kind: 'stationAlias',
    alias: normalizeAlias(alias),
    stationId: input.stationId,
    stationName: input.stationName,
    hitCount: (existing?.hitCount ?? 0) + 1,
    createdAt: existing?.createdAt ?? t,
    updatedAt: t,
  };
  await db.put('learning', row);
  return row;
}

export async function upsertVehicleAlias(input: {
  alias: string;
  vehicleId: string;
}): Promise<LearningRow | null> {
  const alias = input.alias.trim();
  if (!alias || alias.length < 2) return null;
  if (!input.vehicleId) return null;
  const key = vehicleAliasKey(alias);
  const db = await getDB();
  const existing = await db.get('learning', key);
  const t = nowISO();
  const row: LearningRow = {
    key,
    kind: 'vehicleAlias',
    alias: normalizeAlias(alias),
    vehicleId: input.vehicleId,
    hitCount: (existing?.hitCount ?? 0) + 1,
    createdAt: existing?.createdAt ?? t,
    updatedAt: t,
  };
  await db.put('learning', row);
  return row;
}

/**
 * Record a vote for bare-amount+优惠 dialect.
 * Preference flips when one side leads by ≥2 votes (light consistency).
 */
export async function voteAmountDialect(
  vote: AmountDialectPreference,
): Promise<LearningRow> {
  const db = await getDB();
  const existing = await db.get('learning', AMOUNT_DIALECT_KEY);
  const t = nowISO();
  let paidVotes = existing?.paidVotes ?? 0;
  let dueVotes = existing?.dueVotes ?? 0;
  if (vote === 'bareAsPaid') paidVotes += 1;
  else dueVotes += 1;
  let preference: AmountDialectPreference = existing?.preference ?? 'bareAsDue';
  if (paidVotes >= dueVotes + 2) preference = 'bareAsPaid';
  else if (dueVotes >= paidVotes + 2) preference = 'bareAsDue';
  else if (!existing) preference = vote;
  const row: LearningRow = {
    key: AMOUNT_DIALECT_KEY,
    kind: 'amountDialect',
    preference,
    paidVotes,
    dueVotes,
    hitCount: (existing?.hitCount ?? 0) + 1,
    createdAt: existing?.createdAt ?? t,
    updatedAt: t,
  };
  await db.put('learning', row);
  return row;
}

export async function putLearningRow(row: LearningRow): Promise<void> {
  await (await getDB()).put('learning', row);
}

export async function clearLearning(): Promise<void> {
  const db = await getDB();
  await db.clear('learning');
}

/** Bundle for parse options (in-memory). */
export type LearningBundle = {
  stationAliases: Array<{ alias: string; stationId: string; stationName: string }>;
  vehicleAliases: Array<{ alias: string; vehicleId: string }>;
  amountDialect?: AmountDialectPreference;
};

export async function loadLearningBundle(): Promise<LearningBundle> {
  const all = await listLearning();
  const stationAliases: LearningBundle['stationAliases'] = [];
  const vehicleAliases: LearningBundle['vehicleAliases'] = [];
  let amountDialect: AmountDialectPreference | undefined;
  for (const row of all) {
    if (row.kind === 'stationAlias' && row.alias && row.stationId && row.stationName) {
      stationAliases.push({
        alias: row.alias,
        stationId: row.stationId,
        stationName: row.stationName,
      });
    } else if (row.kind === 'vehicleAlias' && row.alias && row.vehicleId) {
      vehicleAliases.push({ alias: row.alias, vehicleId: row.vehicleId });
    } else if (row.kind === 'amountDialect' && row.preference) {
      amountDialect = row.preference;
    }
  }
  return { stationAliases, vehicleAliases, amountDialect };
}
