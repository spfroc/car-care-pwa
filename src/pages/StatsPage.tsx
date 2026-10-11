import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listVehicles } from '../repositories/vehicles';
import { listAllRecords, listRecordsByVehicle } from '../repositories/records';
import { useSettings } from '../hooks/useAppData';
import type { CareRecord, RecordType, Vehicle } from '../types';
import { formatMoney, recordTypeColor, recordTypeLabel, RECORD_TYPE_ORDER } from '../lib/constants';
import { summarizeSpend, filterByRange, monthlySpendByType } from '../lib/spend';
import {
  averageElectricEconomy,
  averageFuelEconomy,
  combinedEconomy,
  electricIntervals,
  formatEconomy,
  fuelIntervals,
} from '../lib/economy';
import { allowsCharge, allowsFuel } from '../lib/energy';
import { EconomyIntervalList } from '../components/EconomyIntervalList';

type RangeKey = '30' | '90' | '365' | 'all';

function rangeDates(key: RangeKey): { from?: Date; to?: Date } {
  if (key === 'all') return {};
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - Number(key));
  return { from, to };
}

export function StatsPage() {
  const [params] = useSearchParams();
  const { settings, t, language } = useSettings();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<string>(params.get('vehicle') || 'all');
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [range, setRange] = useState<RangeKey>('all');

  useEffect(() => {
    listVehicles().then(setVehicles);
  }, []);

  useEffect(() => {
    (async () => {
      if (vehicleId === 'all') setRecords(await listAllRecords());
      else setRecords(await listRecordsByVehicle(vehicleId));
    })();
  }, [vehicleId]);

  const filtered = useMemo(() => {
    const { from, to } = rangeDates(range);
    return filterByRange(records, from, to);
  }, [records, range]);

  const spend = useMemo(() => {
    if (vehicleId === 'all') {
      const base = {
        vehicleId: 'all',
        fuelCost: 0,
        chargeCost: 0,
        maintenanceCost: 0,
        modificationCost: 0,
        washCost: 0,
        goodsCost: 0,
        ticketCost: 0,
        parkingCost: 0,
        tollCost: 0,
        insuranceCost: 0,
        total: 0,
      };
      for (const v of vehicles) {
        const s = summarizeSpend(v.id, filtered);
        base.fuelCost += s.fuelCost;
        base.chargeCost += s.chargeCost;
        base.maintenanceCost += s.maintenanceCost;
        base.modificationCost += s.modificationCost;
        base.washCost += s.washCost;
        base.goodsCost += s.goodsCost;
        base.ticketCost += s.ticketCost;
        base.parkingCost += s.parkingCost;
        base.tollCost += s.tollCost;
        base.insuranceCost += s.insuranceCost;
        base.total += s.total;
      }
      return base;
    }
    return summarizeSpend(vehicleId, filtered);
  }, [filtered, vehicleId, vehicles]);

  const months = useMemo(() => monthlySpendByType(filtered, 6), [filtered]);
  const maxMonth = Math.max(1, ...months.map((m) => m.total));
  const legendTypes = useMemo(() => {
    const present = new Set<RecordType>();
    for (const m of months) {
      for (const s of m.segments) present.add(s.type);
    }
    return RECORD_TYPE_ORDER.filter((x) => present.has(x));
  }, [months]);

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const hev = settings?.hevAllowCharge ?? false;

  const fuelIvs = fuelIntervals(filtered);
  const elecIvs = electricIntervals(filtered);
  const fuelAvg = averageFuelEconomy(filtered);
  const elecAvg = averageElectricEconomy(filtered);
  const combined = settings ? combinedEconomy(filtered, settings.kwhToLiterFactor) : null;

  if (!settings) return <div className="page"><p className="muted">{t('app.loading')}</p></div>;

  const showFuelEco = vehicle
    ? allowsFuel(vehicle.energyType) && vehicle.energyType !== 'EV' && vehicle.energyType !== 'FCEV'
    : true;
  const showElecEco = vehicle ? allowsCharge(vehicle.energyType, hev) : true;
  const showCombined =
    vehicle && (vehicle.energyType === 'PHEV' || vehicle.energyType === 'REEV');

  const ranges: [RangeKey, 'stats.range30' | 'stats.range90' | 'stats.range365' | 'stats.rangeAll'][] = [
    ['30', 'stats.range30'],
    ['90', 'stats.range90'],
    ['365', 'stats.range365'],
    ['all', 'stats.rangeAll'],
  ];

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('stats.title')}</h1>
      </header>

      <label>
        {t('stats.vehicle')}
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="all">{t('stats.allVehicles')}</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>

      <div className="chip-row">
        {ranges.map(([k, labelKey]) => (
          <button
            key={k}
            type="button"
            className={range === k ? 'chip active' : 'chip'}
            onClick={() => setRange(k)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">{t('stats.total')}</div>
          <div className="big">{formatMoney(spend.total)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('type.fuel')}</div>
          <div className="big">{formatMoney(spend.fuelCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('type.charge')}</div>
          <div className="big">{formatMoney(spend.chargeCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('type.maintenance')}</div>
          <div className="big">{formatMoney(spend.maintenanceCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('type.modification')}</div>
          <div className="big">{formatMoney(spend.modificationCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('type.wash')}</div>
          <div className="big">{formatMoney(spend.washCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('type.goods')}</div>
          <div className="big">{formatMoney(spend.goodsCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('type.ticket')}</div>
          <div className="big">{formatMoney(spend.ticketCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('type.parking')}</div>
          <div className="big">{formatMoney(spend.parkingCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('type.toll')}</div>
          <div className="big">{formatMoney(spend.tollCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('type.insurance')}</div>
          <div className="big">{formatMoney(spend.insuranceCost)}</div>
        </div>
      </div>

      <section className="card">
        <h2>{t('stats.economy')}</h2>
        {showFuelEco && (
          <>
            <p>
              {t('stats.avgFuel')}{' '}
              <strong>
                {fuelAvg == null
                  ? t('stats.insufficient')
                  : `${formatEconomy(fuelAvg, settings.fuelEconomyUnit)} ${settings.fuelEconomyUnit}`}
              </strong>
            </p>
            <h3 className="interval-meta" style={{ marginTop: 10, fontWeight: 600 }}>
              {t('stats.fuelIntervals')}
            </h3>
            <EconomyIntervalList
              intervals={fuelIvs}
              unitLabel={settings.fuelEconomyUnit}
              kind="fuel"
            />
          </>
        )}
        {showElecEco && (
          <>
            <p style={{ marginTop: showFuelEco ? 14 : undefined }}>
              {t('stats.avgElec')}{' '}
              <strong>
                {elecAvg == null
                  ? t('stats.insufficient')
                  : `${formatEconomy(elecAvg, settings.electricEconomyUnit)} ${settings.electricEconomyUnit}`}
              </strong>
            </p>
            <h3 className="interval-meta" style={{ marginTop: 10, fontWeight: 600 }}>
              {t('stats.elecIntervals')}
            </h3>
            <EconomyIntervalList
              intervals={elecIvs}
              unitLabel={settings.electricEconomyUnit}
              kind="charge"
            />
          </>
        )}
        {showCombined && (
          <p style={{ marginTop: 14 }}>
            {t('stats.combined')}{' '}
            <strong>
              {combined == null
                ? t('stats.insufficient')
                : `${formatEconomy(combined.economyPer100, 'L/100km')} L/100km`}
            </strong>
          </p>
        )}
        {!vehicle && <p className="muted small">{t('stats.allVehiclesEcoHint')}</p>}
        {vehicle?.energyType === 'FCEV' && <p className="muted">{t('stats.fcevHint')}</p>}
      </section>

      <section className="card">
        <h2>{t('stats.monthly')}</h2>
        <div className="bars" role="list">
          {months.length === 0 && <p className="muted">{t('stats.noData')}</p>}
          {months.map((row) => (
            <div key={row.key} className="bar-col" role="listitem">
              <span className="bar-val" title={formatMoney(row.total)}>
                {formatMoney(row.total)}
              </span>
              <div
                className="bar-track"
                role="img"
                aria-label={`${row.key} ${formatMoney(row.total)}`}
              >
                {row.segments.map((seg) => (
                  <div
                    key={seg.type}
                    className="bar-seg"
                    style={{
                      height: `${(seg.amount / maxMonth) * 100}%`,
                      background: recordTypeColor(seg.type),
                    }}
                    title={`${recordTypeLabel(seg.type, language)} ${formatMoney(seg.amount)}`}
                  />
                ))}
              </div>
              <span className="bar-label">{row.key}</span>
            </div>
          ))}
        </div>
        {legendTypes.length > 0 && (
          <ul className="bar-legend" aria-label={t('stats.legend')}>
            {legendTypes.map((type) => (
              <li key={type} className="bar-legend-item">
                <span
                  className="bar-legend-swatch"
                  style={{ background: recordTypeColor(type) }}
                  aria-hidden
                />
                <span>{recordTypeLabel(type, language)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
