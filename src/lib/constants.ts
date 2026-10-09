import type { BodyType, EnergyType } from '../types';
import {
  DEFAULT_DATE_FORMAT,
  formatDateBySetting,
  partsFromDate,
  toLocalDateTimeValue,
} from './datetime';

export const ENERGY_LABELS: Record<EnergyType, string> = {
  ICE: '燃油',
  EV: '纯电',
  PHEV: '插电混动',
  HEV: '油电混动',
  REEV: '增程式',
  FCEV: '氢燃料',
  OTHER: '其他',
};

export const ENERGY_COLORS: Record<EnergyType, string> = {
  ICE: '#f59e0b',
  EV: '#14b8a6',
  PHEV: '#8b5cf6',
  HEV: '#84cc16',
  REEV: '#6366f1',
  FCEV: '#64748b',
  OTHER: '#94a3b8',
};

export const BODY_TYPES: { value: BodyType; label: string; icon: string }[] = [
  { value: 'SEDAN', label: '轿车', icon: '🚗' },
  { value: 'HATCHBACK', label: '两厢', icon: '🚙' },
  { value: 'SUV', label: 'SUV', icon: '🚐' },
  { value: 'CROSSOVER', label: '跨界', icon: '🚘' },
  { value: 'MPV', label: 'MPV', icon: '🚌' },
  { value: 'MINIVAN', label: '面包/小客', icon: '🛻' },
  { value: 'PICKUP', label: '皮卡', icon: '🚛' },
  { value: 'TRUCK', label: '卡车', icon: '🚚' },
  { value: 'VAN', label: '厢式', icon: '📦' },
  { value: 'COUPE', label: '轿跑', icon: '🏎️' },
  { value: 'CONVERTIBLE', label: '敞篷', icon: '🌤️' },
  { value: 'WAGON', label: '旅行车', icon: '🚂' },
  { value: 'JEEP', label: '硬派越野', icon: '🏔️' },
  { value: 'SPORTS', label: '跑车', icon: '🏁' },
  { value: 'MICRO', label: '微型车', icon: '🚕' },
  { value: 'MOTORCYCLE', label: '摩托车', icon: '🏍️' },
  { value: 'SCOOTER', label: '踏板', icon: '🛵' },
  { value: 'E_BIKE', label: '电动自行车', icon: '⚡' },
  { value: 'BIKE', label: '自行车', icon: '🚲' },
  { value: 'RV', label: '房车', icon: '🏕️' },
  { value: 'BUS', label: '客车', icon: '🚍' },
  { value: 'OTHER', label: '其他', icon: '❓' },
];

export const RECORD_TYPE_LABELS: Record<string, string> = {
  fuel: '加油',
  charge: '充电',
  maintenance: '维保',
  modification: '改装',
  wash: '洗车',
  goods: '配件',
  ticket: '罚单',
  parking: '停车费',
  toll: '高速费',
};

export const RECORD_TYPE_LABELS_EN: Record<string, string> = {
  fuel: 'Fuel',
  charge: 'Charge',
  maintenance: 'Service',
  modification: 'Mods',
  wash: 'Wash',
  goods: 'Parts',
  ticket: 'Ticket',
  parking: 'Parking',
  toll: 'Toll',
};

export const RECORD_TYPE_ICONS: Record<string, string> = {
  fuel: '⛽',
  charge: '🔌',
  maintenance: '🔧',
  modification: '🛠️',
  wash: '🧼',
  goods: '📦',
  ticket: '📄',
  parking: '🅿️',
  toll: '🛣️',
};

export const PARKING_KIND_LABELS: Record<string, string> = {
  fixed: '固定停车费',
  temporary: '临时停车费',
};

export const PARKING_KIND_LABELS_EN: Record<string, string> = {
  fixed: 'Fixed parking',
  temporary: 'Temporary parking',
};

/** Resolve record-type label for zh-CN / en. */
export function recordTypeLabel(type: string, language?: string): string {
  const en = (language ?? '').toLowerCase().startsWith('en');
  if (en) return RECORD_TYPE_LABELS_EN[type] ?? type;
  return RECORD_TYPE_LABELS[type] ?? type;
}

export function parkingKindLabel(kind: string, language?: string): string {
  const en = (language ?? '').toLowerCase().startsWith('en');
  if (en) return PARKING_KIND_LABELS_EN[kind] ?? kind;
  return PARKING_KIND_LABELS[kind] ?? kind;
}

export const OCR_DEFAULTS = {
  main: '油量,升,L,单价,金额,加油站,充电量,度,kWh,实付,合计',
  date: '日期,时间,交易时间,订单时间,Date',
  amountDue: '应付,应收,订单金额,总金额,合计,账单金额',
  discount: '优惠,折扣,立减,满减,券抵扣',
};

export const DEFAULT_FUEL_GRADES = ['92#', '95#', '98#', '0#柴油'];

export function bodyIcon(bodyType: BodyType): string {
  return BODY_TYPES.find((b) => b.value === bodyType)?.icon ?? '❓';
}

export function bodyLabel(bodyType: BodyType): string {
  return BODY_TYPES.find((b) => b.value === bodyType)?.label ?? bodyType;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function uid(): string {
  return crypto.randomUUID();
}

export function formatMoney(n: number, symbol = '¥'): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return `${symbol}${v.toFixed(2)}`;
}

/** Display date using settings dateFormat (default yyyy-mm-dd). */
export function formatDate(iso: string, dateFormat: string = DEFAULT_DATE_FORMAT): string {
  return formatDateBySetting(iso, dateFormat);
}

/** Local `YYYY-MM-DDTHH:mm` for form state / DateTimeField value. */
export function formatDateTimeLocal(iso: string): string {
  return toLocalDateTimeValue(partsFromDate(new Date(iso)));
}
