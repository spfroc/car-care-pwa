import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getVehicle } from '../repositories/vehicles';
import { deleteRecord, listRecordsByVehicle } from '../repositories/records';
import { useSettings } from '../hooks/useAppData';
import type { CareRecord, EconomyInterval, RecordType, Vehicle } from '../types';
import {
  ENERGY_COLORS,
  ENERGY_LABELS,
  RECORD_TYPE_ICONS,
  bodyIcon,
  formatDate,
  formatMoney,
  parkingKindLabel,
  recordTypeLabel,
} from '../lib/constants';
import { allowsCharge, allowsFuel } from '../lib/energy';
import { summarizeSpend } from '../lib/spend';
import {
  combinedEconomy,
  weightedAverage,
  fuelIntervals,
  electricIntervals,
} from '../lib/economy';
import {
  costPerKm,
  formatMileagePair,
  summarizeMileage,
  totalChargeKWh,
  totalFuelLiters,
} from '../lib/vehicleStats';

function filterLabels(lang?: string): { key: 'all' | RecordType; label: string }[] {
  const en = (lang ?? '').toLowerCase().startsWith('en');
  return [
    { key: 'all', label: en ? 'All' : '全部' },
    { key: 'fuel', label: recordTypeLabel('fuel', lang) },
    { key: 'charge', label: recordTypeLabel('charge', lang) },
    { key: 'maintenance', label: recordTypeLabel('maintenance', lang) },
    { key: 'modification', label: recordTypeLabel('modification', lang) },
    { key: 'wash', label: recordTypeLabel('wash', lang) },
    { key: 'goods', label: recordTypeLabel('goods', lang) },
    { key: 'ticket', label: recordTypeLabel('ticket', lang) },
    { key: 'parking', label: recordTypeLabel('parking', lang) },
    { key: 'toll', label: recordTypeLabel('toll', lang) },
    { key: 'insurance', label: recordTypeLabel('insurance', lang) },
  ];
}

function recordTitle(r: CareRecord, lang?: string): string {
  switch (r.type) {
    case 'fuel':
      return `${r.fuelGrade} ${r.liters}L · ${r.stationName || recordTypeLabel('fuel', lang)}`;
    case 'charge': {
      const soc =
        r.socBefore != null || r.socAfter != null
          ? ` · ${r.socBefore ?? '—'}%→${r.socAfter ?? '—'}%`
          : '';
      return `${r.kWh}kWh${soc} · ${r.stationName}`;
    }
    case 'maintenance':
      return r.title;
    case 'modification':
      return r.title;
    case 'wash':
      return recordTypeLabel('wash', lang) + (r.place ? ` · ${r.place}` : '');
    case 'goods':
      return r.name;
    case 'ticket':
      return r.violationType || recordTypeLabel('ticket', lang);
    case 'parking': {
      const kind = parkingKindLabel(r.parkingKind, lang);
      return kind + (r.place ? ` · ${r.place}` : '');
    }
    case 'toll':
      return r.route || recordTypeLabel('toll', lang);
    case 'insurance': {
      const name = r.policyName || r.insurer || recordTypeLabel('insurance', lang);
      if (r.policyName && r.insurer) return `${r.policyName} · ${r.insurer}`;
      return name;
    }
  }
}


function intervalLine(
  r: CareRecord,
  fuelByEnd: Map<string, EconomyInterval>,
  elecByEnd: Map<string, EconomyInterval>,
  fuelUnit: string,
  elecUnit: string,
): string | null {
  if (r.type === 'fuel') {
    const iv = fuelByEnd.get(r.id);
    if (!iv) return null;
    const dist = iv.toOdometer - iv.fromOdometer;
    return `本次加油行驶里程 ${dist.toFixed(0)} km · ${iv.economyPer100.toFixed(2)} ${fuelUnit}`;
  }
  if (r.type === 'charge') {
    const iv = elecByEnd.get(r.id);
    if (!iv) return null;
    const dist = iv.toOdometer - iv.fromOdometer;
    return `本次充电行驶里程 ${dist.toFixed(0)} km · ${iv.economyPer100.toFixed(2)} ${elecUnit}`;
  }
  return null;
}

export function VehicleDetailPage() {
  const { id } = useParams();
  const { settings } = useSettings();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [filter, setFilter] = useState<'all' | RecordType>('fuel');
  const [showAdd, setShowAdd] = useState(false);

  async function refresh() {
    if (!id) return;
    setVehicle((await getVehicle(id)) ?? null);
    setRecords(await listRecordsByVehicle(id));
  }

  useEffect(() => {
    refresh();
  }, [id]);

  useEffect(() => {
    if (!vehicle || !settings) return;
    const fuelOk = allowsFuel(vehicle.energyType);
    const chargeOk = allowsCharge(vehicle.energyType, settings.hevAllowCharge);
    setFilter(fuelOk ? 'fuel' : chargeOk ? 'charge' : 'all');
  }, [vehicle?.id, settings?.hevAllowCharge]);

  const filtered = useMemo(
    () => (filter === 'all' ? records : records.filter((r) => r.type === filter)),
    [records, filter],
  );

  if (!vehicle || !settings) return <div className="page"><p className="muted">加载中…</p></div>;

  const spend = summarizeSpend(vehicle.id, records);
  const canFuel = allowsFuel(vehicle.energyType);
  const canCharge = allowsCharge(vehicle.energyType, settings.hevAllowCharge);
  const fuelIvs = fuelIntervals(records);
  const elecIvs = electricIntervals(records);
  const fuelAvg = weightedAverage(fuelIvs);
  const elecAvg = weightedAverage(elecIvs);
  const combined = combinedEconomy(records, settings.kwhToLiterFactor);
  const fuelByEnd = new Map(fuelIvs.map((iv) => [iv.endRecordId, iv]));
  const elecByEnd = new Map(elecIvs.map((iv) => [iv.endRecordId, iv]));
  const bg = ENERGY_COLORS[vehicle.energyType];
  const mileage = summarizeMileage(vehicle, records);
  const perKm = costPerKm(spend.total, mileage.trackedMileage);
  const fuelLiters = totalFuelLiters(records);
  const chargeKWh = totalChargeKWh(records);

  async function onDelete(rid: string) {
    if (!confirm('删除这条记录？')) return;
    await deleteRecord(rid);
    refresh();
  }

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/" className="btn ghost">
          ← 首页
        </Link>
        <Link to={`/vehicles/${vehicle.id}/edit`} className="btn ghost">
          编辑
        </Link>
      </header>

      <div className="detail-hero" style={{ borderColor: bg }}>
        <div className="detail-hero-top">
          <div className="vc-title">
            <span className="vc-icon lg">{bodyIcon(vehicle.bodyType)}</span>
            <div>
              <h1>{vehicle.name}</h1>
              <p className="muted">
                {vehicle.plate || '无车牌'} · {ENERGY_LABELS[vehicle.energyType]}
              </p>
            </div>
          </div>
          <div className="mileage-pair" title="统计里程 / 行驶里程">
            <span className="label">统计/行驶</span>
            <strong>{formatMileagePair(mileage)}</strong>
          </div>
        </div>
        <div className="mini-stats">
          <div>
            <span className="label">总花费</span>
            <strong>{formatMoney(spend.total, settings.currency.symbol)}</strong>
          </div>
          <div>
            <span className="label">每公里成本</span>
            <strong>
              {perKm == null ? '—' : formatMoney(perKm, settings.currency.symbol)}
            </strong>
          </div>
          {canFuel && (
            <div>
              <span className="label">油耗</span>
              <strong>
                {fuelAvg == null ? '—' : `${fuelAvg.toFixed(2)} ${settings.fuelEconomyUnit}`}
              </strong>
            </div>
          )}
          {canCharge && (
            <div>
              <span className="label">电耗</span>
              <strong>
                {elecAvg == null ? '—' : `${elecAvg.toFixed(2)} ${settings.electricEconomyUnit}`}
              </strong>
            </div>
          )}
          {canFuel && (
            <div>
              <span className="label">总加油量</span>
              <strong>
                {fuelLiters > 0 ? `${fuelLiters.toFixed(2)} ${settings.volumeUnit}` : '—'}
              </strong>
            </div>
          )}
          {canCharge && (
            <div>
              <span className="label">总充电量</span>
              <strong>
                {chargeKWh > 0 ? `${chargeKWh.toFixed(2)} ${settings.energyUnit}` : '—'}
              </strong>
            </div>
          )}
          {(vehicle.energyType === 'PHEV' || vehicle.energyType === 'REEV') && (
            <div>
              <span className="label">综合</span>
              <strong>
                {combined == null ? '—' : `${combined.economyPer100.toFixed(2)} L/100km`}
              </strong>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar list-toolbar">
        <label className="filter-select-wrap">
          <span className="sr-only">筛选类型</span>
          <select
            className="filter-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | RecordType)}
            aria-label="筛选类型"
          >
            {filterLabels(settings.language)
              .filter((f) => {
                if (f.key === 'fuel' && !canFuel) return false;
                if (f.key === 'charge' && !canCharge) return false;
                return true;
              })
              .map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
          </select>
        </label>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn primary icon-btn"
            onClick={() => setShowAdd((s) => !s)}
            aria-label="新增记录"
            aria-expanded={showAdd}
          >
            <span aria-hidden="true">+</span>
          </button>
          <Link
            to={`/stats?vehicle=${vehicle.id}`}
            className="btn ghost icon-btn"
            aria-label="统计"
            title="统计"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 19V10M10 19V5M16 19v-7M22 19H2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </div>

      {showAdd && (
        <div className="add-menu">
          {canFuel && (
            <Link to={`/vehicles/${vehicle.id}/records/new/fuel`} className="btn block">
              ⛽ {recordTypeLabel('fuel', settings.language)}
            </Link>
          )}
          {canCharge && (
            <Link to={`/vehicles/${vehicle.id}/records/new/charge`} className="btn block">
              🔌 {recordTypeLabel('charge', settings.language)}
            </Link>
          )}
          <Link to={`/vehicles/${vehicle.id}/records/new/maintenance`} className="btn block">
            🔧 {recordTypeLabel('maintenance', settings.language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/modification`} className="btn block">
            🛠️ {recordTypeLabel('modification', settings.language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/wash`} className="btn block">
            🧼 {recordTypeLabel('wash', settings.language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/goods`} className="btn block">
            📦 {recordTypeLabel('goods', settings.language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/ticket`} className="btn block">
            📄 {recordTypeLabel('ticket', settings.language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/parking`} className="btn block">
            🅿️ {recordTypeLabel('parking', settings.language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/toll`} className="btn block">
            🛣️ {recordTypeLabel('toll', settings.language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/insurance`} className="btn block">
            🛡️ {recordTypeLabel('insurance', settings.language)}
          </Link>
        </div>
      )}

      <div className="timeline">
        {filtered.length === 0 && <p className="muted">暂无记录</p>}
        {filtered.map((r) => {
          const eco = intervalLine(
            r,
            fuelByEnd,
            elecByEnd,
            settings.fuelEconomyUnit,
            settings.electricEconomyUnit,
          );
          return (
            <div key={r.id} className={`timeline-item ${r.type === 'ticket' && !r.paid ? 'unpaid' : ''}`}>
              <Link to={`/vehicles/${vehicle.id}/records/${r.id}`} className="ti-main">
                <span className="ti-icon">{RECORD_TYPE_ICONS[r.type]}</span>
                <div>
                  <div className="ti-title">{recordTitle(r, settings.language)}</div>
                  <div className="muted small">
                    {recordTypeLabel(r.type, settings.language)} · {formatDate(r.date, settings.dateFormat)}
                    {typeof r.odometer === 'number' ? ` · ${r.odometer} km` : ''}
                    {r.type === 'fuel' && r.unitPrice != null
                      ? ` · ${(settings.language ?? '').toLowerCase().startsWith('en') ? 'Price' : '油价'} ${formatMoney(r.unitPrice, settings.currency.symbol)}/L`
                      : ''}
                    {r.flags?.odometerAnomaly ? ' · 里程异常' : ''}
                    {r.type === 'fuel' && !r.filledUp ? ' · 未加满' : ''}
                  </div>
                  {eco && <div className="ti-eco">{eco}</div>}
                </div>
                <div className="ti-amount">{formatMoney(r.amountPaid)}</div>
              </Link>
              <button
                type="button"
                className="btn ghost danger-text icon-btn"
                onClick={() => onDelete(r.id)}
                aria-label="删除"
                title="删除"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12zM10 11v6M14 11v6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
