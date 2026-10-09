export type UUID = string;
export type ISODateTime = string;
export type Money = number;
export type Km = number;
export type Liter = number;
export type KWh = number;

export type EnergyType = 'ICE' | 'EV' | 'PHEV' | 'HEV' | 'REEV' | 'FCEV' | 'OTHER';

export type BodyType =
  | 'SEDAN' | 'HATCHBACK' | 'SUV' | 'CROSSOVER' | 'MPV' | 'MINIVAN'
  | 'PICKUP' | 'TRUCK' | 'VAN' | 'COUPE' | 'CONVERTIBLE' | 'WAGON'
  | 'JEEP' | 'SPORTS' | 'MICRO' | 'MOTORCYCLE' | 'SCOOTER' | 'E_BIKE'
  | 'BIKE' | 'RV' | 'BUS' | 'OTHER';

export type RecordType =
  | 'fuel' | 'charge' | 'maintenance' | 'modification' | 'wash' | 'goods' | 'ticket'
  | 'parking' | 'toll' | 'insurance';

export type ChargeStationKind = 'public' | 'home' | 'destination' | 'other';
export type MaintenanceCategory = 'service' | 'repair' | 'beauty' | 'tire' | 'other';
export type ModArea = 'exterior' | 'interior' | 'power' | 'chassis' | 'electronics' | 'other';
export type WashKind = 'basic' | 'detail' | 'coating' | 'interior' | 'other';
export type GoodsCategory = 'oil' | 'filter' | 'tire' | 'electronics' | 'other';
export type ParkingKind = 'fixed' | 'temporary';
export type StationType = 'gas' | 'charge';

export interface Vehicle {
  id: UUID;
  name: string;
  plate?: string;
  energyType: EnergyType;
  bodyType: BodyType;
  fuelGrade?: string;
  tankCapacityL?: Liter;
  batteryCapacityKWh?: KWh;
  initialOdometer?: Km;
  note?: string;
  coverMediaId?: UUID;
  sortOrder?: number;
  archived?: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RecordBase {
  id: UUID;
  vehicleId: UUID;
  type: RecordType;
  date: ISODateTime;
  odometer?: Km;
  amountDue?: Money;
  amountPaid: Money;
  discount?: Money;
  note?: string;
  mediaIds: UUID[];
  tags?: string[];
  flags?: { odometerAnomaly?: boolean; lowConfidenceEconomy?: boolean };
  ocrRawText?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface FuelRecord extends RecordBase {
  type: 'fuel';
  stationName?: string;
  stationId?: UUID;
  fuelGrade: string;
  unitPrice?: Money;
  liters: Liter;
  filledUp: boolean;
  odometer: Km;
}

export interface ChargeRecord extends RecordBase {
  type: 'charge';
  stationName: string;
  stationId?: UUID;
  stationKind: ChargeStationKind;
  kWh: KWh;
  /** Battery SOC % before charge (0–100). */
  socBefore?: number;
  /** Battery SOC % after charge (0–100). */
  socAfter?: number;
  durationMinutes?: number;
  odometer: Km;
}

export interface MaintenanceRecord extends RecordBase {
  type: 'maintenance';
  category: MaintenanceCategory;
  title: string;
  vendor?: string;
  nextServiceOdometer?: Km;
  nextServiceDate?: ISODateTime;
}

export interface ModificationRecord extends RecordBase {
  type: 'modification';
  area: ModArea;
  title: string;
  brandSpec?: string;
  odometer?: Km;
}

export interface WashRecord extends RecordBase {
  type: 'wash';
  washKind: WashKind;
  place?: string;
  odometer?: Km;
}

export interface GoodsRecord extends RecordBase {
  type: 'goods';
  name: string;
  category: GoodsCategory;
  quantity?: number;
  unitPrice?: Money;
  channel?: string;
}

export interface TicketRecord extends RecordBase {
  type: 'ticket';
  violationType?: string;
  location?: string;
  points?: number;
  paid: boolean;
  paidAt?: ISODateTime;
}

/** Fixed (periodic lot) or temporary (out-trip) parking fee. */
export interface ParkingRecord extends RecordBase {
  type: 'parking';
  parkingKind: ParkingKind;
  /** Lot name / place. */
  place?: string;
  /** Billing period start (fixed parking). */
  periodStart?: ISODateTime;
  /** Billing period end (fixed parking). */
  periodEnd?: ISODateTime;
  /** Parking duration in minutes (temporary). */
  durationMinutes?: number;
}

/** Highway / toll-road fee. */
export interface TollRecord extends RecordBase {
  type: 'toll';
  /** Route or entry→exit description. */
  route?: string;
}

/** Vehicle insurance premium. */
export interface InsuranceRecord extends RecordBase {
  type: 'insurance';
  /** Insurer / company name. */
  insurer?: string;
  /** Policy / product name (e.g. 交强险+商业险). */
  policyName?: string;
  /** Coverage / billing period start. */
  periodStart?: ISODateTime;
  /** Coverage / billing period end. */
  periodEnd?: ISODateTime;
}

export type CareRecord =
  | FuelRecord
  | ChargeRecord
  | MaintenanceRecord
  | ModificationRecord
  | WashRecord
  | GoodsRecord
  | TicketRecord
  | ParkingRecord
  | TollRecord
  | InsuranceRecord;

export interface Station {
  id: UUID;
  stationType: StationType;
  name: string;
  brand?: string;
  address?: string;
  preferredFuelGrade?: string;
  isHome?: boolean;
  connectorNote?: string;
  note?: string;
  sortOrder: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: ISODateTime;
}

export interface Media {
  id: UUID;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  blob: Blob;
  createdAt: ISODateTime;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface VehicleSpendSummary {
  vehicleId: UUID;
  fuelCost: Money;
  chargeCost: Money;
  maintenanceCost: Money;
  modificationCost: Money;
  washCost: Money;
  goodsCost: Money;
  ticketCost: Money;
  parkingCost: Money;
  tollCost: Money;
  insuranceCost: Money;
  total: Money;
}

export interface EconomyInterval {
  kind: 'fuel' | 'electric' | 'combined';
  fromOdometer: Km;
  toOdometer: Km;
  amount: number;
  economyPer100: number;
  lowConfidence: boolean;
  endRecordId: UUID;
}

export interface CarCareExportV1 {
  format: 'car-care-export-v1';
  exportedAt: ISODateTime;
  appSchemaVersion: number;
  vehicles: Vehicle[];
  records: CareRecord[];
  stations: Station[];
  settings: SettingRow[];
  media: Array<{
    id: UUID;
    mimeType: string;
    byteSize: number;
    width?: number;
    height?: number;
    base64: string;
    createdAt: ISODateTime;
  }>;
  meta?: SettingRow[];
}
