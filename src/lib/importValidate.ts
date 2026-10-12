/**
 * Structural validation for car-care-export-v1 JSON before any IndexedDB mutation.
 * Supported appSchemaVersion: 1 .. APP_SCHEMA_VERSION (missing → treat as 1).
 */
import type {
  BodyType,
  CareRecord,
  CarCareExportV1,
  EnergyType,
  LearningRow,
  RecordType,
  SettingRow,
  Station,
  Vehicle,
} from '../types';
import { APP_SCHEMA_VERSION } from './constants';

const ENERGY_TYPES = new Set<EnergyType>(['ICE', 'EV', 'PHEV', 'HEV', 'REEV', 'FCEV', 'OTHER']);
const BODY_TYPES = new Set<BodyType>([
  'SEDAN', 'HATCHBACK', 'SUV', 'CROSSOVER', 'MPV', 'MINIVAN', 'PICKUP', 'TRUCK', 'VAN',
  'COUPE', 'CONVERTIBLE', 'WAGON', 'JEEP', 'SPORTS', 'MICRO', 'MOTORCYCLE', 'SCOOTER',
  'E_BIKE', 'BIKE', 'RV', 'BUS', 'OTHER',
]);
const RECORD_TYPES = new Set<RecordType>([
  'fuel', 'charge', 'maintenance', 'modification', 'wash', 'goods', 'ticket',
  'parking', 'toll', 'insurance',
]);
const STATION_TYPES = new Set(['gas', 'charge']);

export type ImportValidationOk = {
  ok: true;
  data: CarCareExportV1;
  schemaVersion: number;
  warnings: string[];
};

export type ImportValidationFail = {
  ok: false;
  message: string;
  errors: string[];
};

export type ImportValidationResult = ImportValidationOk | ImportValidationFail;

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function push(errors: string[], cond: boolean, msg: string): void {
  if (!cond) errors.push(msg);
}

function validateVehicle(v: unknown, i: number, errors: string[]): void {
  if (!isObj(v)) {
    errors.push(`vehicles[${i}]: 必须是对象`);
    return;
  }
  push(errors, isStr(v.id) && v.id.length > 0, `vehicles[${i}].id 必填`);
  push(errors, isStr(v.name) && v.name.length > 0, `vehicles[${i}].name 必填`);
  push(errors, isStr(v.energyType) && ENERGY_TYPES.has(v.energyType as EnergyType), `vehicles[${i}].energyType 无效`);
  push(errors, isStr(v.bodyType) && BODY_TYPES.has(v.bodyType as BodyType), `vehicles[${i}].bodyType 无效`);
  push(errors, isStr(v.createdAt), `vehicles[${i}].createdAt 必填`);
  push(errors, isStr(v.updatedAt), `vehicles[${i}].updatedAt 必填`);
}

function validateRecord(r: unknown, i: number, vehicleIds: Set<string>, errors: string[]): void {
  if (!isObj(r)) {
    errors.push(`records[${i}]: 必须是对象`);
    return;
  }
  push(errors, isStr(r.id) && r.id.length > 0, `records[${i}].id 必填`);
  push(errors, isStr(r.vehicleId) && r.vehicleId.length > 0, `records[${i}].vehicleId 必填`);
  if (isStr(r.vehicleId) && vehicleIds.size > 0 && !vehicleIds.has(r.vehicleId)) {
    errors.push(`records[${i}].vehicleId 引用不存在的车辆 ${r.vehicleId}`);
  }
  push(errors, isStr(r.type) && RECORD_TYPES.has(r.type as RecordType), `records[${i}].type 无效`);
  push(errors, isStr(r.date), `records[${i}].date 必填`);
  push(errors, isNum(r.amountPaid), `records[${i}].amountPaid 必填且为数字`);
  push(errors, Array.isArray(r.mediaIds), `records[${i}].mediaIds 必须是数组`);
  push(errors, isStr(r.createdAt), `records[${i}].createdAt 必填`);
  push(errors, isStr(r.updatedAt), `records[${i}].updatedAt 必填`);

  const type = r.type as RecordType;
  if (type === 'fuel') {
    push(errors, isNum(r.liters), `records[${i}].liters 必填`);
    push(errors, isNum(r.odometer), `records[${i}].odometer 必填`);
    push(errors, isStr(r.fuelGrade), `records[${i}].fuelGrade 必填`);
    push(errors, typeof r.filledUp === 'boolean', `records[${i}].filledUp 必填`);
  } else if (type === 'charge') {
    push(errors, isNum(r.kWh), `records[${i}].kWh 必填`);
    push(errors, isNum(r.odometer), `records[${i}].odometer 必填`);
    push(errors, isStr(r.stationName), `records[${i}].stationName 必填`);
    push(errors, isStr(r.stationKind), `records[${i}].stationKind 必填`);
  } else if (type === 'maintenance') {
    push(errors, isStr(r.title), `records[${i}].title 必填`);
    push(errors, isStr(r.category), `records[${i}].category 必填`);
  } else if (type === 'modification') {
    push(errors, isStr(r.title), `records[${i}].title 必填`);
    push(errors, isStr(r.area), `records[${i}].area 必填`);
  } else if (type === 'wash') {
    push(errors, isStr(r.washKind), `records[${i}].washKind 必填`);
  } else if (type === 'goods') {
    push(errors, isStr(r.name), `records[${i}].name 必填`);
    push(errors, isStr(r.category), `records[${i}].category 必填`);
  } else if (type === 'ticket') {
    push(errors, typeof r.paid === 'boolean', `records[${i}].paid 必填`);
  } else if (type === 'parking') {
    push(errors, isStr(r.parkingKind), `records[${i}].parkingKind 必填`);
  }
}

function validateStation(s: unknown, i: number, errors: string[]): void {
  if (!isObj(s)) {
    errors.push(`stations[${i}]: 必须是对象`);
    return;
  }
  push(errors, isStr(s.id) && s.id.length > 0, `stations[${i}].id 必填`);
  push(errors, isStr(s.name) && s.name.length > 0, `stations[${i}].name 必填`);
  push(errors, isStr(s.stationType) && STATION_TYPES.has(s.stationType as string), `stations[${i}].stationType 无效`);
  push(errors, isNum(s.sortOrder), `stations[${i}].sortOrder 必填`);
}

function validateSetting(s: unknown, i: number, errors: string[]): void {
  if (!isObj(s)) {
    errors.push(`settings[${i}]: 必须是对象`);
    return;
  }
  push(errors, isStr(s.key) && s.key.length > 0, `settings[${i}].key 必填`);
  push(errors, 'value' in s, `settings[${i}].value 必填`);
}

function validateMedia(m: unknown, i: number, errors: string[]): void {
  if (!isObj(m)) {
    errors.push(`media[${i}]: 必须是对象`);
    return;
  }
  push(errors, isStr(m.id) && m.id.length > 0, `media[${i}].id 必填`);
  push(errors, isStr(m.mimeType), `media[${i}].mimeType 必填`);
  push(errors, isNum(m.byteSize), `media[${i}].byteSize 必填`);
  push(errors, isStr(m.base64) && m.base64.length > 0, `media[${i}].base64 必填`);
  push(errors, isStr(m.createdAt), `media[${i}].createdAt 必填`);
}

function validateLearning(row: unknown, i: number, errors: string[]): void {
  if (!isObj(row)) {
    errors.push(`learning[${i}]: 必须是对象`);
    return;
  }
  push(errors, isStr(row.key) && row.key.length > 0, `learning[${i}].key 必填`);
  push(errors, isStr(row.kind), `learning[${i}].kind 必填`);
  push(errors, isNum(row.hitCount), `learning[${i}].hitCount 必填`);
}

/**
 * Parse + validate export JSON text. Does not touch IndexedDB.
 * Rejects malformed JSON, wrong format, unsupported schema, and structural errors.
 */
export function validateImportJson(jsonText: string): ImportValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { ok: false, message: 'JSON 解析失败', errors: ['JSON 解析失败'] };
  }

  if (!isObj(raw)) {
    return { ok: false, message: '根节点必须是对象', errors: ['根节点必须是对象'] };
  }

  if (raw.format !== 'car-care-export-v1') {
    return {
      ok: false,
      message: '格式不正确：需要 car-care-export-v1',
      errors: [`format 必须为 car-care-export-v1，实际为 ${String(raw.format)}`],
    };
  }

  const warnings: string[] = [];
  let schemaVersion = 1;
  if (raw.appSchemaVersion === undefined || raw.appSchemaVersion === null) {
    warnings.push('缺少 appSchemaVersion，按 schema 1 处理');
    schemaVersion = 1;
  } else if (!isNum(raw.appSchemaVersion) || raw.appSchemaVersion < 1) {
    return {
      ok: false,
      message: 'appSchemaVersion 无效',
      errors: ['appSchemaVersion 必须是 ≥1 的数字'],
    };
  } else if (raw.appSchemaVersion > APP_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `不支持的 schema 版本 ${raw.appSchemaVersion}（当前最高 ${APP_SCHEMA_VERSION}）`,
      errors: [`appSchemaVersion ${raw.appSchemaVersion} > ${APP_SCHEMA_VERSION}`],
    };
  } else {
    schemaVersion = raw.appSchemaVersion;
  }

  const errors: string[] = [];
  push(errors, isStr(raw.exportedAt), 'exportedAt 必填');
  push(errors, Array.isArray(raw.vehicles), 'vehicles 必须是数组');
  push(errors, Array.isArray(raw.records), 'records 必须是数组');
  push(errors, Array.isArray(raw.stations), 'stations 必须是数组');
  push(errors, Array.isArray(raw.settings), 'settings 必须是数组');
  // media may be omitted in no-media exports
  if (raw.media !== undefined) {
    push(errors, Array.isArray(raw.media), 'media 必须是数组');
  }
  if (raw.learning !== undefined) {
    push(errors, Array.isArray(raw.learning), 'learning 必须是数组');
  }
  if (raw.meta !== undefined) {
    push(errors, Array.isArray(raw.meta), 'meta 必须是数组');
  }

  if (errors.length) {
    return { ok: false, message: errors[0], errors };
  }

  const vehicles = raw.vehicles as unknown[];
  for (let i = 0; i < vehicles.length; i++) validateVehicle(vehicles[i], i, errors);

  const vehicleIds = new Set(
    vehicles.filter(isObj).map((v) => v.id).filter((id): id is string => isStr(id)),
  );

  const records = raw.records as unknown[];
  for (let i = 0; i < records.length; i++) validateRecord(records[i], i, vehicleIds, errors);

  const stations = raw.stations as unknown[];
  for (let i = 0; i < stations.length; i++) validateStation(stations[i], i, errors);

  const settings = raw.settings as unknown[];
  for (let i = 0; i < settings.length; i++) validateSetting(settings[i], i, errors);

  const media = (raw.media ?? []) as unknown[];
  for (let i = 0; i < media.length; i++) validateMedia(media[i], i, errors);

  const learning = (raw.learning ?? []) as unknown[];
  for (let i = 0; i < learning.length; i++) validateLearning(learning[i], i, errors);

  if (errors.length) {
    const preview = errors.slice(0, 5).join('；');
    const more = errors.length > 5 ? `（另有 ${errors.length - 5} 项）` : '';
    return { ok: false, message: `校验失败：${preview}${more}`, errors };
  }

  const data: CarCareExportV1 = {
    format: 'car-care-export-v1',
    exportedAt: raw.exportedAt as string,
    appSchemaVersion: schemaVersion,
    vehicles: vehicles as Vehicle[],
    records: records as CareRecord[],
    stations: stations as Station[],
    settings: settings as SettingRow[],
    media: media as CarCareExportV1['media'],
    meta: raw.meta as CarCareExportV1['meta'],
    learning: learning.length ? (learning as LearningRow[]) : undefined,
  };

  return { ok: true, data, schemaVersion, warnings };
}
