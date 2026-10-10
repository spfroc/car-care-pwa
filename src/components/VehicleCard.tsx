import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CareRecord, Vehicle } from '../types';
import { ENERGY_COLORS, ENERGY_LABELS, bodyIcon, formatMoney } from '../lib/constants';
import { homeCardFlags } from '../lib/energy';
import { summarizeSpend } from '../lib/spend';
import { averageElectricEconomy, averageFuelEconomy, formatEconomy } from '../lib/economy';
import { heroEnergyCosts, summarizeMileage } from '../lib/vehicleStats';

function formatKm(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function VehicleCard({
  vehicle,
  records,
  hevAllowCharge,
  fuelUnit,
  electricUnit,
}: {
  vehicle: Vehicle;
  records: CareRecord[];
  hevAllowCharge: boolean;
  fuelUnit: string;
  electricUnit: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const mine = records.filter((r) => r.vehicleId === vehicle.id);
  const spend = summarizeSpend(vehicle.id, mine);
  const flags = homeCardFlags(vehicle.energyType, hevAllowCharge);
  const fuelEco = averageFuelEconomy(mine);
  const elecEco = averageElectricEconomy(mine);
  const mileage = summarizeMileage(vehicle, mine);
  const energyCosts = heroEnergyCosts(
    vehicle.energyType,
    mine,
    mileage.baselineOdometer,
    hevAllowCharge,
  );
  const bg = ENERGY_COLORS[vehicle.energyType];
  const detailTo = `/vehicles/${vehicle.id}`;

  return (
    <article className="vehicle-card" style={{ borderLeftColor: bg }}>
      <div className="vc-head" style={{ background: `${bg}22` }}>
        <Link to={detailTo} className="vc-head-main">
          <div className="vc-title">
            <span className="vc-icon">{bodyIcon(vehicle.bodyType)}</span>
            <div>
              <div className="vc-name">{vehicle.name}</div>
              <div className="vc-meta">
                {vehicle.plate || '无车牌'} · {ENERGY_LABELS[vehicle.energyType]}
              </div>
            </div>
          </div>
          <div className="vc-head-metrics">
            <div className="vc-metric">
              <div className="label">当前里程</div>
              <div className="value">
                {mileage.drivingOdometer == null ? '—' : `${formatKm(mileage.drivingOdometer)} km`}
              </div>
            </div>
            {flags.showFuelEconomy && (
              <div className="vc-metric">
                <div className="label">油耗</div>
                <div className="value">
                  {fuelEco == null ? '—' : `${formatEconomy(fuelEco, fuelUnit)} ${fuelUnit}`}
                </div>
              </div>
            )}
            {flags.showElectricEconomy && (
              <div className="vc-metric">
                <div className="label">电耗</div>
                <div className="value">
                  {elecEco == null ? '—' : `${formatEconomy(elecEco, electricUnit)} ${electricUnit}`}
                </div>
              </div>
            )}
            {!flags.showFuelEconomy && !flags.showElectricEconomy && (
              <div className="vc-metric">
                <div className="label">油耗/电耗</div>
                <div className="value">—</div>
              </div>
            )}
          </div>
        </Link>
        <button
          type="button"
          className={`vc-expand${expanded ? ' open' : ''}`}
          aria-expanded={expanded}
          aria-label={expanded ? '收起花费明细' : '展开花费明细'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {expanded && (
        <Link to={detailTo} className="vc-grid">
          <p className="vc-spend-note muted small">
            加油/充电与详情一致（统计起点后）；其余为全部记录
          </p>
          {flags.showFuelCost && (
            <div>
              <div
                className="label"
                title="里程严格大于统计基线的加油实付（与详情页一致）"
              >
                加油
              </div>
              <div className="value">{formatMoney(energyCosts.fuelSpend)}</div>
            </div>
          )}
          {flags.showChargeCost && (
            <div>
              <div
                className="label"
                title="里程严格大于统计基线的充电实付（与详情页一致）"
              >
                充电
              </div>
              <div className="value">{formatMoney(energyCosts.chargeSpend)}</div>
            </div>
          )}
          <div>
            <div className="label">维保</div>
            <div className="value">{formatMoney(spend.maintenanceCost)}</div>
          </div>
          <div>
            <div className="label">改装</div>
            <div className="value">{formatMoney(spend.modificationCost)}</div>
          </div>
          <div>
            <div className="label">洗车</div>
            <div className="value">{formatMoney(spend.washCost)}</div>
          </div>
          <div>
            <div className="label">配件</div>
            <div className="value">{formatMoney(spend.goodsCost)}</div>
          </div>
          <div>
            <div className="label">罚单</div>
            <div className="value">{formatMoney(spend.ticketCost)}</div>
          </div>
          <div>
            <div className="label">停车</div>
            <div className="value">{formatMoney(spend.parkingCost)}</div>
          </div>
          <div>
            <div className="label">高速</div>
            <div className="value">{formatMoney(spend.tollCost)}</div>
          </div>
          <div>
            <div className="label">保险</div>
            <div className="value">{formatMoney(spend.insuranceCost)}</div>
          </div>
        </Link>
      )}
    </article>
  );
}
