import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listVehicles } from '../repositories/vehicles';
import { listAllRecords, listRecordsByVehicle } from '../repositories/records';
import { useSettings } from '../hooks/useAppData';
import type { CareRecord, RecordType, Vehicle } from '../types';
import { formatMoney, recordTypeColor, recordTypeLabel, RECORD_TYPE_ORDER } from '../lib/constants';
import { summarizeSpend, filterByRange, monthlySpendByType } from '../lib/spend';
import {
  combinedEconomy,
  electricIntervals,
  fuelIntervals,
  weightedAverage,
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
  const { settings } = useSettings();
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

  // months must be computed with useMemo BEFORE any conditional return —
  // an early return above this hook caused a Rules of Hooks crash (blank Stats page)
  // once settings finished loading.
  const months = useMemo(() => monthlySpendByType(filtered, 6), [filtered]);
  const maxMonth = Math.max(1, ...months.map((m) => m.total));
  const legendTypes = useMemo(() => {
    const present = new Set<RecordType>();
    for (const m of months) {
      for (const s of m.segments) present.add(s.type);
    }
    return RECORD_TYPE_ORDER.filter((t) => present.has(t));
  }, [months]);

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const hev = settings?.hevAllowCharge ?? false;

  const fuelIvs = fuelIntervals(filtered);
  const elecIvs = electricIntervals(filtered);
  const fuelAvg = weightedAverage(fuelIvs);
  const elecAvg = weightedAverage(elecIvs);
  const combined = settings ? combinedEconomy(filtered, settings.kwhToLiterFactor) : null;

  if (!settings) return <div className="page"><p className="muted">加载中…</p></div>;

  const showFuelEco = vehicle
    ? allowsFuel(vehicle.energyType) && vehicle.energyType !== 'EV' && vehicle.energyType !== 'FCEV'
    : true;
  const showElecEco = vehicle ? allowsCharge(vehicle.energyType, hev) : true;
  const showCombined =
    vehicle && (vehicle.energyType === 'PHEV' || vehicle.energyType === 'REEV');

  return (
    <div className="page">
      <header className="page-header">
        <h1>统计</h1>
      </header>

      <label>
        车辆
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="all">全部车辆</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>

      <div className="chip-row">
        {(
          [
            ['30', '近30天'],
            ['90', '近90天'],
            ['365', '近1年'],
            ['all', '全部'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={range === k ? 'chip active' : 'chip'}
            onClick={() => setRange(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">总计</div>
          <div className="big">{formatMoney(spend.total)}</div>
        </div>
        <div className="stat-card">
          <div className="label">燃油</div>
          <div className="big">{formatMoney(spend.fuelCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">充电</div>
          <div className="big">{formatMoney(spend.chargeCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">维保</div>
          <div className="big">{formatMoney(spend.maintenanceCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">改装</div>
          <div className="big">{formatMoney(spend.modificationCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">洗车</div>
          <div className="big">{formatMoney(spend.washCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">配件</div>
          <div className="big">{formatMoney(spend.goodsCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">罚单</div>
          <div className="big">{formatMoney(spend.ticketCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">停车费</div>
          <div className="big">{formatMoney(spend.parkingCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">高速费</div>
          <div className="big">{formatMoney(spend.tollCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">保险</div>
          <div className="big">{formatMoney(spend.insuranceCost)}</div>
        </div>
      </div>

      <section className="card">
        <h2>能耗</h2>
        {showFuelEco && (
          <>
            <p>
              平均油耗：{' '}
              <strong>
                {fuelAvg == null ? '数据不足' : `${fuelAvg.toFixed(2)} ${settings.fuelEconomyUnit}`}
              </strong>
            </p>
            <h3 className="interval-meta" style={{ marginTop: 10, fontWeight: 600 }}>
              油耗区间明细
            </h3>
            <EconomyIntervalList
              intervals={fuelIvs}
              unitLabel={settings.fuelEconomyUnit}
              kindLabel="加油"
            />
          </>
        )}
        {showElecEco && (
          <>
            <p style={{ marginTop: showFuelEco ? 14 : undefined }}>
              平均电耗：{' '}
              <strong>
                {elecAvg == null
                  ? '数据不足'
                  : `${elecAvg.toFixed(2)} ${settings.electricEconomyUnit}`}
              </strong>
            </p>
            <h3 className="interval-meta" style={{ marginTop: 10, fontWeight: 600 }}>
              电耗区间明细
            </h3>
            <EconomyIntervalList
              intervals={elecIvs}
              unitLabel={settings.electricEconomyUnit}
              kindLabel="充电"
            />
          </>
        )}
        {showCombined && (
          <p style={{ marginTop: 14 }}>
            综合油耗（折算）：{' '}
            <strong>
              {combined == null ? '数据不足' : `${combined.economyPer100.toFixed(2)} L/100km`}
            </strong>
          </p>
        )}
        {!vehicle && <p className="muted small">选择单车可查看对应能耗公式分支</p>}
        {vehicle?.energyType === 'FCEV' && <p className="muted">能耗公式未启用（氢燃料）</p>}
      </section>

      <section className="card">
        <h2>近月花费</h2>
        <div className="bars">
          {months.length === 0 && <p className="muted">暂无数据</p>}
          {months.map((row) => (
            <div key={row.key} className="bar-row">
              <span className="bar-label">{row.key}</span>
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
                      width: `${(seg.amount / maxMonth) * 100}%`,
                      background: recordTypeColor(seg.type),
                    }}
                    title={`${recordTypeLabel(seg.type, settings.language)} ${formatMoney(seg.amount)}`}
                  />
                ))}
              </div>
              <span className="bar-val">{formatMoney(row.total)}</span>
            </div>
          ))}
        </div>
        {legendTypes.length > 0 && (
          <ul className="bar-legend" aria-label="花费类型图例">
            {legendTypes.map((type) => (
              <li key={type} className="bar-legend-item">
                <span
                  className="bar-legend-swatch"
                  style={{ background: recordTypeColor(type) }}
                  aria-hidden
                />
                <span>{recordTypeLabel(type, settings.language)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
