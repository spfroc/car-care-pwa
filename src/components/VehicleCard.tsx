import { Link } from 'react-router-dom';
import type { CareRecord, Vehicle } from '../types';
import { ENERGY_COLORS, ENERGY_LABELS, bodyIcon, formatMoney } from '../lib/constants';
import { homeCardFlags } from '../lib/energy';
import { summarizeSpend } from '../lib/spend';
import { latestElectricEconomy, latestFuelEconomy } from '../lib/economy';

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
  const mine = records.filter((r) => r.vehicleId === vehicle.id);
  const spend = summarizeSpend(vehicle.id, mine);
  const flags = homeCardFlags(vehicle.energyType, hevAllowCharge);
  const fuelEco = latestFuelEconomy(mine);
  const elecEco = latestElectricEconomy(mine);
  const bg = ENERGY_COLORS[vehicle.energyType];

  return (
    <Link to={`/vehicles/${vehicle.id}`} className="vehicle-card" style={{ borderLeftColor: bg }}>
      <div className="vc-head" style={{ background: `${bg}22` }}>
        <div className="vc-title">
          <span className="vc-icon">{bodyIcon(vehicle.bodyType)}</span>
          <div>
            <div className="vc-name">{vehicle.name}</div>
            <div className="vc-meta">
              {vehicle.plate || '无车牌'} · {ENERGY_LABELS[vehicle.energyType]}
            </div>
          </div>
        </div>
        <span className="badge" style={{ background: bg }}>
          {ENERGY_LABELS[vehicle.energyType]}
        </span>
      </div>
      <div className="vc-grid">
        {flags.showFuelCost && (
          <div>
            <div className="label">燃油</div>
            <div className="value">{formatMoney(spend.fuelCost)}</div>
          </div>
        )}
        {flags.showChargeCost && (
          <div>
            <div className="label">充电</div>
            <div className="value">{formatMoney(spend.chargeCost)}</div>
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
        {flags.showFuelEconomy && (
          <div>
            <div className="label">近况油耗</div>
            <div className="value">
              {fuelEco == null ? '—' : `${fuelEco.toFixed(1)} ${fuelUnit}`}
            </div>
          </div>
        )}
        {flags.showElectricEconomy && (
          <div>
            <div className="label">近况电耗</div>
            <div className="value">
              {elecEco == null ? '—' : `${elecEco.toFixed(1)} ${electricUnit}`}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
