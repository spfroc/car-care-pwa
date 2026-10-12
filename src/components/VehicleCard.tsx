import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CareRecord, Vehicle } from '../types';
import { ENERGY_COLORS, bodyIcon, energyLabel, formatMoney } from '../lib/constants';
import { homeCardFlags } from '../lib/energy';
import { summarizeSpend } from '../lib/spend';
import { electricEconomySummary, fuelEconomySummary, formatEconomy } from '../lib/economy';
import { heroEnergyCosts, summarizeMileage } from '../lib/vehicleStats';
import { useI18n } from '../i18n';

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
  const { t, language } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const mine = records.filter((r) => r.vehicleId === vehicle.id);
  const spend = summarizeSpend(vehicle.id, mine);
  const flags = homeCardFlags(vehicle.energyType, hevAllowCharge);
  const fuelEco = fuelEconomySummary(mine);
  const elecEco = electricEconomySummary(mine);
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
                {vehicle.plate || t('common.noPlate')} · {energyLabel(vehicle.energyType, language)}
              </div>
            </div>
          </div>
          <div className="vc-head-metrics">
            <div className="vc-metric">
              <div className="label">{t('card.odometer')}</div>
              <div className="value">
                {mileage.drivingOdometer == null ? t('common.dash') : `${formatKm(mileage.drivingOdometer)} km`}
              </div>
            </div>
            {flags.showFuelEconomy && (
              <div className="vc-metric">
                <div className="label">{t('card.fuelEco')}</div>
                <div className="value">
                  {fuelEco.value == null
                    ? t('common.dash')
                    : `${formatEconomy(fuelEco.value, fuelUnit)} ${fuelUnit}${fuelEco.lowConfidence ? t('eco.estimate') : ''}`}
                </div>
              </div>
            )}
            {flags.showElectricEconomy && (
              <div className="vc-metric">
                <div className="label">{t('card.elecEco')}</div>
                <div className="value">
                  {elecEco.value == null
                    ? t('common.dash')
                    : `${formatEconomy(elecEco.value, electricUnit)} ${electricUnit}${elecEco.lowConfidence ? t('eco.estimate') : ''}`}
                </div>
              </div>
            )}
            {!flags.showFuelEconomy && !flags.showElectricEconomy && (
              <div className="vc-metric">
                <div className="label">{t('card.fuelElecEco')}</div>
                <div className="value">{t('common.dash')}</div>
              </div>
            )}
          </div>
        </Link>
        <button
          type="button"
          className={`vc-expand${expanded ? ' open' : ''}`}
          aria-expanded={expanded}
          aria-label={expanded ? t('card.collapse') : t('card.expand')}
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
          <p className="vc-spend-note muted small">{t('card.spendNote')}</p>
          {flags.showFuelCost && (
            <div>
              <div className="label" title={t('card.fuelTitle')}>
                {t('type.fuel')}
              </div>
              <div className="value">{formatMoney(energyCosts.fuelSpend)}</div>
            </div>
          )}
          {flags.showChargeCost && (
            <div>
              <div className="label" title={t('card.chargeTitle')}>
                {t('type.charge')}
              </div>
              <div className="value">{formatMoney(energyCosts.chargeSpend)}</div>
            </div>
          )}
          <div>
            <div className="label">{t('type.maintenance')}</div>
            <div className="value">{formatMoney(spend.maintenanceCost)}</div>
          </div>
          <div>
            <div className="label">{t('type.modification')}</div>
            <div className="value">{formatMoney(spend.modificationCost)}</div>
          </div>
          <div>
            <div className="label">{t('type.wash')}</div>
            <div className="value">{formatMoney(spend.washCost)}</div>
          </div>
          <div>
            <div className="label">{t('type.goods')}</div>
            <div className="value">{formatMoney(spend.goodsCost)}</div>
          </div>
          <div>
            <div className="label">{t('type.ticket')}</div>
            <div className="value">{formatMoney(spend.ticketCost)}</div>
          </div>
          <div>
            <div className="label">{t('type.parkingShort')}</div>
            <div className="value">{formatMoney(spend.parkingCost)}</div>
          </div>
          <div>
            <div className="label">{t('type.tollShort')}</div>
            <div className="value">{formatMoney(spend.tollCost)}</div>
          </div>
          <div>
            <div className="label">{t('type.insurance')}</div>
            <div className="value">{formatMoney(spend.insuranceCost)}</div>
          </div>
        </Link>
      )}
    </article>
  );
}
