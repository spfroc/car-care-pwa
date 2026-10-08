import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getVehicle } from '../repositories/vehicles';
import { deleteRecord, listRecordsByVehicle } from '../repositories/records';
import { useSettings } from '../hooks/useAppData';
import type { CareRecord, RecordType, Vehicle } from '../types';
import {
  ENERGY_COLORS,
  ENERGY_LABELS,
  RECORD_TYPE_ICONS,
  RECORD_TYPE_LABELS,
  bodyIcon,
  formatDate,
  formatMoney,
} from '../lib/constants';
import { allowsCharge, allowsFuel } from '../lib/energy';
import { summarizeSpend } from '../lib/spend';
import {
  combinedEconomy,
  weightedAverage,
  fuelIntervals,
  electricIntervals,
} from '../lib/economy';

const FILTERS: { key: 'all' | RecordType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'fuel', label: '加油' },
  { key: 'charge', label: '充电' },
  { key: 'maintenance', label: '维保' },
  { key: 'modification', label: '改装' },
  { key: 'wash', label: '洗车' },
  { key: 'goods', label: '配件' },
  { key: 'ticket', label: '罚单' },
];

function recordTitle(r: CareRecord): string {
  switch (r.type) {
    case 'fuel':
      return `${r.fuelGrade} ${r.liters}L · ${r.stationName || '加油'}`;
    case 'charge':
      return `${r.kWh}kWh · ${r.stationName}`;
    case 'maintenance':
      return r.title;
    case 'modification':
      return r.title;
    case 'wash':
      return RECORD_TYPE_LABELS.wash + (r.place ? ` · ${r.place}` : '');
    case 'goods':
      return r.name;
    case 'ticket':
      return r.violationType || '罚单';
  }
}

export function VehicleDetailPage() {
  const { id } = useParams();
  const { settings } = useSettings();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [filter, setFilter] = useState<'all' | RecordType>('all');
  const [showAdd, setShowAdd] = useState(false);

  async function refresh() {
    if (!id) return;
    setVehicle((await getVehicle(id)) ?? null);
    setRecords(await listRecordsByVehicle(id));
  }

  useEffect(() => {
    refresh();
  }, [id]);

  const filtered = useMemo(
    () => (filter === 'all' ? records : records.filter((r) => r.type === filter)),
    [records, filter],
  );

  if (!vehicle || !settings) return <div className="page"><p className="muted">加载中…</p></div>;

  const spend = summarizeSpend(vehicle.id, records);
  const canFuel = allowsFuel(vehicle.energyType);
  const canCharge = allowsCharge(vehicle.energyType, settings.hevAllowCharge);
  const fuelAvg = weightedAverage(fuelIntervals(records));
  const elecAvg = weightedAverage(electricIntervals(records));
  const combined = combinedEconomy(records, settings.kwhToLiterFactor);
  const bg = ENERGY_COLORS[vehicle.energyType];

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
        <div className="vc-title">
          <span className="vc-icon lg">{bodyIcon(vehicle.bodyType)}</span>
          <div>
            <h1>{vehicle.name}</h1>
            <p className="muted">
              {vehicle.plate || '无车牌'} · {ENERGY_LABELS[vehicle.energyType]}
            </p>
          </div>
        </div>
        <div className="mini-stats">
          <div>
            <span className="label">总花费</span>
            <strong>{formatMoney(spend.total)}</strong>
          </div>
          {canFuel && (
            <div>
              <span className="label">油耗</span>
              <strong>
                {fuelAvg == null ? '—' : `${fuelAvg.toFixed(1)} ${settings.fuelEconomyUnit}`}
              </strong>
            </div>
          )}
          {canCharge && (
            <div>
              <span className="label">电耗</span>
              <strong>
                {elecAvg == null ? '—' : `${elecAvg.toFixed(1)} ${settings.electricEconomyUnit}`}
              </strong>
            </div>
          )}
          {(vehicle.energyType === 'PHEV' || vehicle.energyType === 'REEV') && (
            <div>
              <span className="label">综合</span>
              <strong>
                {combined == null ? '—' : `${combined.economyPer100.toFixed(1)} L/100km`}
              </strong>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => setShowAdd((s) => !s)}>
          + 新增记录
        </button>
        <Link to={`/stats?vehicle=${vehicle.id}`} className="btn ghost">
          统计
        </Link>
      </div>

      {showAdd && (
        <div className="add-menu">
          {canFuel && (
            <Link to={`/vehicles/${vehicle.id}/records/new/fuel`} className="btn block">
              ⛽ 加油
            </Link>
          )}
          {canCharge && (
            <Link to={`/vehicles/${vehicle.id}/records/new/charge`} className="btn block">
              🔌 充电
            </Link>
          )}
          <Link to={`/vehicles/${vehicle.id}/records/new/maintenance`} className="btn block">
            🔧 维保
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/modification`} className="btn block">
            🛠️ 改装
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/wash`} className="btn block">
            🧼 洗车
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/goods`} className="btn block">
            📦 配件
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/ticket`} className="btn block">
            📄 罚单
          </Link>
        </div>
      )}

      <div className="chip-row">
        {FILTERS.filter((f) => {
          if (f.key === 'fuel' && !canFuel) return false;
          if (f.key === 'charge' && !canCharge) return false;
          return true;
        }).map((f) => (
          <button
            key={f.key}
            type="button"
            className={filter === f.key ? 'chip active' : 'chip'}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="timeline">
        {filtered.length === 0 && <p className="muted">暂无记录</p>}
        {filtered.map((r) => (
          <div key={r.id} className={`timeline-item ${r.type === 'ticket' && !r.paid ? 'unpaid' : ''}`}>
            <Link to={`/vehicles/${vehicle.id}/records/${r.id}`} className="ti-main">
              <span className="ti-icon">{RECORD_TYPE_ICONS[r.type]}</span>
              <div>
                <div className="ti-title">{recordTitle(r)}</div>
                <div className="muted small">
                  {RECORD_TYPE_LABELS[r.type]} · {formatDate(r.date)}
                  {typeof r.odometer === 'number' ? ` · ${r.odometer} km` : ''}
                  {r.flags?.odometerAnomaly ? ' · 里程异常' : ''}
                </div>
              </div>
              <div className="ti-amount">{formatMoney(r.amountPaid)}</div>
            </Link>
            <button type="button" className="btn ghost danger-text" onClick={() => onDelete(r.id)}>
              删
            </button>
          </div>
        ))}
      </div>
      {/* silence unused */}
    </div>
  );
}
