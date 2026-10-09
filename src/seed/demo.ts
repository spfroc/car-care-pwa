import { getDB } from '../db';
import { nowISO } from '../lib/constants';
import type { CareRecord, Station, Vehicle } from '../types';
import { clearAllData } from '../repositories/importExport';
import { ensureDefaultSettings } from '../db';

const ts = (daysAgo: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export async function loadDemoSeed(replace = true): Promise<void> {
  if (replace) await clearAllData();
  await ensureDefaultSettings();
  const db = await getDB();
  const createdAt = nowISO();

  const vehicles: Vehicle[] = [
    {
      id: 'seed-vehicle-ice-001',
      name: '家用燃油 SUV',
      plate: '沪A·12345',
      energyType: 'ICE',
      bodyType: 'SUV',
      fuelGrade: '95#',
      tankCapacityL: 60,
      initialOdometer: 12000,
      note: '演示燃油车',
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 'seed-vehicle-ev-001',
      name: '城市纯电轿车',
      plate: '沪B·88888',
      energyType: 'EV',
      bodyType: 'SEDAN',
      batteryCapacityKWh: 60,
      initialOdometer: 5000,
      note: '演示纯电',
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 'seed-vehicle-phev-001',
      name: '插混家用 MPV',
      plate: '沪C·66666',
      energyType: 'PHEV',
      bodyType: 'MPV',
      fuelGrade: '95#',
      tankCapacityL: 50,
      batteryCapacityKWh: 25,
      initialOdometer: 8000,
      note: '演示插混',
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const stations: Station[] = [
    { id: 'seed-station-gas-1', stationType: 'gas', name: '中石化浦东站', brand: '中石化', address: '浦东新区', preferredFuelGrade: '95#', sortOrder: 0, createdAt, updatedAt: createdAt },
    { id: 'seed-station-gas-2', stationType: 'gas', name: '壳牌世纪大道', brand: 'Shell', preferredFuelGrade: '95#', sortOrder: 1, createdAt, updatedAt: createdAt },
    { id: 'seed-station-gas-3', stationType: 'gas', name: '中石油虹桥站', brand: '中石油', preferredFuelGrade: '92#', sortOrder: 2, createdAt, updatedAt: createdAt },
    { id: 'seed-station-chg-1', stationType: 'charge', name: '特来电商场桩', brand: '特来电', address: '徐汇', isHome: false, connectorNote: '60kW 快充', sortOrder: 0, createdAt, updatedAt: createdAt },
    { id: 'seed-station-chg-2', stationType: 'charge', name: '家充桩', brand: '自装', isHome: true, connectorNote: '7kW 慢充', sortOrder: 1, createdAt, updatedAt: createdAt },
    { id: 'seed-station-chg-3', stationType: 'charge', name: '小桔充电高速服务区', brand: '小桔', isHome: false, connectorNote: '120kW', sortOrder: 2, createdAt, updatedAt: createdAt },
  ];

  const iceId = 'seed-vehicle-ice-001';
  const evId = 'seed-vehicle-ev-001';
  const phevId = 'seed-vehicle-phev-001';

  const fuel = (
    id: string,
    vehicleId: string,
    daysAgo: number,
    odo: number,
    liters: number,
    paid: number,
    filled = true,
  ): CareRecord => ({
    id,
    vehicleId,
    type: 'fuel',
    date: ts(daysAgo),
    odometer: odo,
    liters,
    fuelGrade: '95#',
    unitPrice: liters > 0 ? Math.round((paid / liters) * 100) / 100 : undefined,
    filledUp: filled,
    amountPaid: paid,
    amountDue: paid,
    stationName: '中石化浦东站',
    stationId: 'seed-station-gas-1',
    mediaIds: [],
    createdAt,
    updatedAt: createdAt,
  });

  const charge = (
    id: string,
    vehicleId: string,
    daysAgo: number,
    odo: number,
    kWh: number,
    paid: number,
    kind: 'public' | 'home' = 'public',
    soc?: { before: number; after: number },
  ): CareRecord => ({
    id,
    vehicleId,
    type: 'charge',
    date: ts(daysAgo),
    odometer: odo,
    kWh,
    socBefore: soc?.before,
    socAfter: soc?.after,
    stationName: kind === 'home' ? '家充桩' : '特来电商场桩',
    stationId: kind === 'home' ? 'seed-station-chg-2' : 'seed-station-chg-1',
    stationKind: kind,
    amountPaid: paid,
    amountDue: paid,
    mediaIds: [],
    createdAt,
    updatedAt: createdAt,
  });

  // ICE: ~8 L/100km — 40L / 500km = 8
  const iceFuels: CareRecord[] = [
    fuel('seed-fuel-ice-1', iceId, 90, 12000, 48, 380),
    fuel('seed-fuel-ice-2', iceId, 75, 12500, 40, 320), // 8.0
    fuel('seed-fuel-ice-3', iceId, 60, 13020, 42, 336), // ~8.08
    fuel('seed-fuel-ice-4', iceId, 45, 13540, 41, 328),
    fuel('seed-fuel-ice-5', iceId, 30, 14060, 39, 312),
    fuel('seed-fuel-ice-6', iceId, 15, 14580, 40, 320),
    fuel('seed-fuel-ice-7', iceId, 5, 15100, 41.5, 332),
  ];

  // EV: ~15 kWh/100km — 30kWh / 200km
  const evCharges: CareRecord[] = [
    charge('seed-chg-ev-1', evId, 80, 5000, 45, 60, 'home', { before: 15, after: 95 }),
    charge('seed-chg-ev-2', evId, 65, 5200, 30, 45, 'public', { before: 20, after: 80 }), // 15
    charge('seed-chg-ev-3', evId, 50, 5400, 28, 42, 'public', { before: 25, after: 78 }),
    charge('seed-chg-ev-4', evId, 35, 5620, 33, 50, 'public', { before: 18, after: 85 }),
    charge('seed-chg-ev-5', evId, 20, 5850, 35, 52, 'home', { before: 12, after: 90 }),
    charge('seed-chg-ev-6', evId, 10, 6080, 32, 48, 'public', { before: 22, after: 82 }),
    charge('seed-chg-ev-7', evId, 3, 6300, 33, 49, 'public', { before: 19, after: 88 }),
  ];

  // PHEV: fuel + charge
  const phevRecords: CareRecord[] = [
    fuel('seed-fuel-phev-1', phevId, 85, 8000, 35, 280),
    charge('seed-chg-phev-1', phevId, 80, 8100, 18, 20, 'home', { before: 20, after: 95 }),
    fuel('seed-fuel-phev-2', phevId, 70, 8500, 20, 160), // 4L/100 over 500? 20/500*100=4
    charge('seed-chg-phev-2', phevId, 65, 8700, 20, 25, 'public', { before: 15, after: 90 }),
    fuel('seed-fuel-phev-3', phevId, 50, 9100, 22, 176),
    charge('seed-chg-phev-3', phevId, 45, 9300, 16, 18, 'home', { before: 25, after: 100 }),
    fuel('seed-fuel-phev-4', phevId, 30, 9700, 18, 144),
    charge('seed-chg-phev-4', phevId, 25, 9900, 19, 22, 'public', { before: 18, after: 92 }),
    fuel('seed-fuel-phev-5', phevId, 12, 10200, 20, 160),
    charge('seed-chg-phev-5', phevId, 8, 10400, 17, 15, 'home', { before: 22, after: 98 }),
  ];

  const extras: CareRecord[] = [
    {
      id: 'seed-maint-ice-1', vehicleId: iceId, type: 'maintenance', date: ts(40), category: 'service',
      title: '小保养换机油', vendor: '4S店', amountPaid: 680, amountDue: 680, odometer: 13600,
      nextServiceOdometer: 18600, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-wash-ice-1', vehicleId: iceId, type: 'wash', date: ts(20), washKind: 'basic',
      place: '小区门口', amountPaid: 30, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-mod-ice-1', vehicleId: iceId, type: 'modification', date: ts(100), area: 'exterior',
      title: '行车记录仪', brandSpec: '70迈', amountPaid: 399, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-goods-ice-1', vehicleId: iceId, type: 'goods', date: ts(55), name: '雨刮片',
      category: 'other', amountPaid: 68, quantity: 1, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-ticket-ice-1', vehicleId: iceId, type: 'ticket', date: ts(70), violationType: '闯红灯',
      location: '某某路口', amountPaid: 200, points: 6, paid: true, paidAt: ts(68),
      mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-maint-ev-1', vehicleId: evId, type: 'maintenance', date: ts(40), category: 'service',
      title: '空调滤芯', amountPaid: 120, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-wash-ev-1', vehicleId: evId, type: 'wash', date: ts(15), washKind: 'detail',
      amountPaid: 80, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-mod-phev-1', vehicleId: phevId, type: 'modification', date: ts(60), area: 'interior',
      title: '脚垫', amountPaid: 299, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-wash-phev-1', vehicleId: phevId, type: 'wash', date: ts(18), washKind: 'basic',
      amountPaid: 35, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-ticket-phev-1', vehicleId: phevId, type: 'ticket', date: ts(22), violationType: '超速',
      amountPaid: 200, points: 3, paid: false, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-park-ice-fixed', vehicleId: iceId, type: 'parking', date: ts(5), parkingKind: 'fixed',
      place: '小区地下车库', periodStart: ts(30), periodEnd: ts(0), amountPaid: 450,
      mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-park-ice-temp', vehicleId: iceId, type: 'parking', date: ts(3), parkingKind: 'temporary',
      place: '商场B1', durationMinutes: 120, amountPaid: 20,
      mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-toll-ice-1', vehicleId: iceId, type: 'toll', date: ts(10), route: '上海→苏州',
      amountPaid: 55, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-park-ev-temp', vehicleId: evId, type: 'parking', date: ts(4), parkingKind: 'temporary',
      place: '办公楼访客位', durationMinutes: 480, amountPaid: 40,
      mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-toll-phev-1', vehicleId: phevId, type: 'toll', date: ts(14), route: 'G15 沈海高速',
      amountPaid: 120, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-ins-ice-1', vehicleId: iceId, type: 'insurance', date: ts(90),
      insurer: '人保车险', policyName: '交强险+商业险', periodStart: ts(90), periodEnd: ts(-275),
      amountPaid: 5200, mediaIds: [], createdAt, updatedAt: createdAt,
    },
    {
      id: 'seed-ins-ev-1', vehicleId: evId, type: 'insurance', date: ts(60),
      insurer: '平安车险', policyName: '新能源专属', periodStart: ts(60), periodEnd: ts(-305),
      amountPaid: 3800, mediaIds: [], createdAt, updatedAt: createdAt,
    },
  ];

  for (const v of vehicles) await db.put('vehicles', v);
  for (const s of stations) await db.put('stations', s);
  for (const r of [...iceFuels, ...evCharges, ...phevRecords, ...extras]) await db.put('records', r);
  await db.put('meta', { key: 'seedLoadedAt', value: nowISO() });
}
