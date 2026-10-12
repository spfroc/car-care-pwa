import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { getVehicle } from '../repositories/vehicles';
import { deleteRecord, listRecordsByVehicle } from '../repositories/records';
import { useSettings } from '../hooks/useAppData';
import type { CareRecord, EconomyInterval, RecordType, Vehicle } from '../types';
import {
  ENERGY_COLORS,
  RECORD_TYPE_ICONS,
  bodyIcon,
  energyLabel,
  formatDate,
  formatMoney,
  parkingKindLabel,
  recordTypeLabel,
} from '../lib/constants';
import { allowsCharge, allowsFuel } from '../lib/energy';
import {
  combinedEconomy,
  electricEconomySummary,
  electricIntervals,
  fuelEconomySummary,
  formatEconomy,
  fuelIntervals,
} from '../lib/economy';
import {
  costPerKm,
  formatMileagePair,
  heroEnergyCosts,
  summarizeMileage,
  totalChargeKWh,
  totalFuelLiters,
} from '../lib/vehicleStats';


/** Hover (desktop) / tap·focus (mobile) formula tip after a metric label.
 *  Bubble is portaled + position:fixed so it overlays without expanding
 *  overflow:auto parents (e.g. .mini-stats → unwanted vertical scrollbar). */
function HelpTip({ text, ariaPrefix }: { text: string; ariaPrefix?: string }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const show = open || hovered;

  const updatePosition = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left + r.width / 2 });
  };

  useLayoutEffect(() => {
    if (!show) return;
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [show]);

  return (
    <span
      className={`help-tip${show ? ' open' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={btnRef}
        type="button"
        className="help-tip-btn"
        aria-label={ariaPrefix ? `${ariaPrefix}${text}` : text}
        aria-expanded={show}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {show &&
        coords &&
        createPortal(
          <span
            className="help-tip-bubble help-tip-bubble--portal"
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}

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
  translate: (key: 'detail.intervalFuel' | 'detail.intervalCharge', params: Record<string, string | number>) => string,
): string | null {
  if (r.type === 'fuel') {
    const iv = fuelByEnd.get(r.id);
    if (!iv) return null;
    const dist = iv.toOdometer - iv.fromOdometer;
    return translate('detail.intervalFuel', {
      dist: dist.toFixed(0),
      eco: formatEconomy(iv.economyPer100, fuelUnit),
      unit: fuelUnit,
    });
  }
  if (r.type === 'charge') {
    const iv = elecByEnd.get(r.id);
    if (!iv) return null;
    const dist = iv.toOdometer - iv.fromOdometer;
    return translate('detail.intervalCharge', {
      dist: dist.toFixed(0),
      eco: formatEconomy(iv.economyPer100, elecUnit),
      unit: elecUnit,
    });
  }
  return null;
}

export function VehicleDetailPage() {
  const { id } = useParams();
  const { settings, t, language } = useSettings();
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

  useEffect(() => {
    if (!vehicle || !settings) return;
    const fuelOk = allowsFuel(vehicle.energyType);
    const chargeOk = allowsCharge(vehicle.energyType, settings.hevAllowCharge);
    // Dual-energy (PHEV/REEV/HEV+charge): default 「全部」 so both fuel & charge show.
    if (fuelOk && chargeOk) setFilter('all');
    else setFilter(fuelOk ? 'fuel' : chargeOk ? 'charge' : 'all');
  }, [vehicle?.id, settings?.hevAllowCharge]);

  const filtered = useMemo(
    () => (filter === 'all' ? records : records.filter((r) => r.type === filter)),
    [records, filter],
  );

  const filterAmountSum = useMemo(
    () => filtered.reduce((sum, r) => sum + (r.amountPaid || 0), 0),
    [filtered],
  );

  if (!vehicle || !settings) return <div className="page"><p className="muted">{t('app.loading')}</p></div>;

  const canFuel = allowsFuel(vehicle.energyType);
  const canCharge = allowsCharge(vehicle.energyType, settings.hevAllowCharge);
  const fuelIvs = fuelIntervals(records);
  const elecIvs = electricIntervals(records);
  const fuelAvg = fuelEconomySummary(records);
  const elecAvg = electricEconomySummary(records);
  const combined = combinedEconomy(records, settings.kwhToLiterFactor);
  const fuelByEnd = new Map(fuelIvs.map((iv) => [iv.endRecordId, iv]));
  const elecByEnd = new Map(elecIvs.map((iv) => [iv.endRecordId, iv]));
  const bg = ENERGY_COLORS[vehicle.energyType];
  const mileage = summarizeMileage(vehicle, records);
  const energyCosts = heroEnergyCosts(
    vehicle.energyType,
    records,
    mileage.baselineOdometer,
    settings.hevAllowCharge,
  );
  const perKm = costPerKm(energyCosts.costPerKmNumerator, mileage.trackedMileage);
  const fuelLiters = totalFuelLiters(records);
  const chargeKWh = totalChargeKWh(records);

  async function onDelete(rid: string) {
    if (!confirm(t('detail.deleteConfirm'))) return;
    await deleteRecord(rid);
    refresh();
  }

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/" className="btn ghost">
          {t('common.home')}
        </Link>
        <Link to={`/vehicles/${vehicle.id}/edit`} className="btn ghost">
          {t('common.edit')}
        </Link>
      </header>

      <div className="detail-hero" style={{ borderColor: bg }}>
        <div className="detail-hero-top">
          <div className="vc-title">
            <span className="vc-icon lg">{bodyIcon(vehicle.bodyType)}</span>
            <div>
              <h1>{vehicle.name}</h1>
              <p className="muted">
                {vehicle.plate || t('common.noPlate')} · {energyLabel(vehicle.energyType, language)}
              </p>
            </div>
          </div>
          <div className="mileage-pair" title={t('detail.trackedDrivingTitle')}>
            <span className="label">{t('detail.trackedDriving')}</span>
            <strong>{formatMileagePair(mileage)}</strong>
          </div>
        </div>
        <div className="mini-stats">
          {energyCosts.showFuelSpend && (
            <div>
              <span className="label" title={t('detail.fuelSpendTitle')}>
                {t('detail.fuelSpend')}
              </span>
              <strong>{formatMoney(energyCosts.fuelSpend, settings.currency.symbol)}</strong>
            </div>
          )}
          {energyCosts.showChargeSpend && (
            <div>
              <span className="label" title={t('detail.chargeSpendTitle')}>
                {t('detail.chargeSpend')}
              </span>
              <strong>{formatMoney(energyCosts.chargeSpend, settings.currency.symbol)}</strong>
            </div>
          )}
          <div>
            <span className="label label-with-help">
              {t('detail.costPerKm')}
              <HelpTip
                text={
                  energyCosts.costPerKmHintKey === 'fuel'
                    ? t('hint.costPerKm.fuel')
                    : energyCosts.costPerKmHintKey === 'charge'
                      ? t('hint.costPerKm.charge')
                      : t('hint.costPerKm.combined')
                }
              />
            </span>
            <strong>
              {perKm == null ? t('common.dash') : formatMoney(perKm, settings.currency.symbol)}
            </strong>
          </div>
          {canFuel && (
            <div>
              <span className="label">{t('card.fuelEco')}</span>
              <strong>
                {fuelAvg.value == null
                  ? t('common.dash')
                  : `${formatEconomy(fuelAvg.value, settings.fuelEconomyUnit)} ${settings.fuelEconomyUnit}${fuelAvg.lowConfidence ? t('eco.estimate') : ''}`}
              </strong>
            </div>
          )}
          {canCharge && (
            <div>
              <span className="label">{t('card.elecEco')}</span>
              <strong>
                {elecAvg.value == null
                  ? t('common.dash')
                  : `${formatEconomy(elecAvg.value, settings.electricEconomyUnit)} ${settings.electricEconomyUnit}${elecAvg.lowConfidence ? t('eco.estimate') : ''}`}
              </strong>
            </div>
          )}
          {canFuel && (
            <div>
              <span className="label">{t('detail.totalFuel')}</span>
              <strong>
                {fuelLiters > 0 ? `${fuelLiters.toFixed(2)} ${settings.volumeUnit}` : t('common.dash')}
              </strong>
            </div>
          )}
          {canCharge && (
            <div>
              <span className="label">{t('detail.totalCharge')}</span>
              <strong>
                {chargeKWh > 0 ? `${chargeKWh.toFixed(2)} ${settings.energyUnit}` : t('common.dash')}
              </strong>
            </div>
          )}
          {(vehicle.energyType === 'PHEV' || vehicle.energyType === 'REEV') && (
            <div>
              <span className="label">{t('detail.combined')}</span>
              <strong>
                {combined == null ? t('common.dash') : `${formatEconomy(combined.economyPer100, 'L/100km')} L/100km`}
              </strong>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar list-toolbar">
        <label className="filter-select-wrap">
          <span className="sr-only">{t('detail.filterType')}</span>
          <select
            className="filter-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | RecordType)}
            aria-label={t('detail.filterType')}
          >
            {filterLabels(language)
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
        <div
          className="toolbar-filter-sum"
          title={filter === 'all' ? t('detail.filterSumAll') : t('detail.filterSumFiltered')}
          aria-label={filter === 'all' ? t('detail.filterSumAllAria') : t('detail.filterSumFilteredAria')}
        >
          {formatMoney(filterAmountSum, settings.currency.symbol)}
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn primary icon-btn"
            onClick={() => setShowAdd((s) => !s)}
            aria-label={t('detail.addRecord')}
            aria-expanded={showAdd}
          >
            <span aria-hidden="true">+</span>
          </button>
          <Link
            to={`/stats?vehicle=${vehicle.id}`}
            className="btn ghost icon-btn"
            aria-label={t('nav.stats')}
            title={t('nav.stats')}
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
              ⛽ {recordTypeLabel('fuel', language)}
            </Link>
          )}
          {canCharge && (
            <Link to={`/vehicles/${vehicle.id}/records/new/charge`} className="btn block">
              🔌 {recordTypeLabel('charge', language)}
            </Link>
          )}
          <Link to={`/vehicles/${vehicle.id}/records/new/maintenance`} className="btn block">
            🔧 {recordTypeLabel('maintenance', language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/modification`} className="btn block">
            🛠️ {recordTypeLabel('modification', language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/wash`} className="btn block">
            🧼 {recordTypeLabel('wash', language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/goods`} className="btn block">
            📦 {recordTypeLabel('goods', language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/ticket`} className="btn block">
            📄 {recordTypeLabel('ticket', language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/parking`} className="btn block">
            🅿️ {recordTypeLabel('parking', language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/toll`} className="btn block">
            🛣️ {recordTypeLabel('toll', language)}
          </Link>
          <Link to={`/vehicles/${vehicle.id}/records/new/insurance`} className="btn block">
            🛡️ {recordTypeLabel('insurance', language)}
          </Link>
        </div>
      )}

      <div className="timeline">
        {filtered.length === 0 && <p className="muted">{t('detail.noRecords')}</p>}
        {filtered.map((r) => {
          const eco = intervalLine(
            r,
            fuelByEnd,
            elecByEnd,
            settings.fuelEconomyUnit,
            settings.electricEconomyUnit,
            t,
          );
          return (
            <div key={r.id} className={`timeline-item ${r.type === 'ticket' && !r.paid ? 'unpaid' : ''}`}>
              <Link to={`/vehicles/${vehicle.id}/records/${r.id}`} className="ti-main">
                <span className="ti-icon">{RECORD_TYPE_ICONS[r.type]}</span>
                <div>
                  <div className="ti-title">{recordTitle(r, language)}</div>
                  <div className="muted small">
                    {recordTypeLabel(r.type, language)} · {formatDate(r.date, settings.dateFormat)}
                    {typeof r.odometer === 'number' ? ` · ${r.odometer} km` : ''}
                    {r.type === 'fuel' && r.unitPrice != null
                      ? ` · ${t('detail.unitPrice')} ${formatMoney(r.unitPrice, settings.currency.symbol)}/L`
                      : ''}
                    {r.flags?.odometerAnomaly ? ` · ${t('detail.odometerAnomaly')}` : ''}
                    {r.type === 'fuel' && !r.filledUp ? ` · ${t('detail.notFilledUp')}` : ''}
                  </div>
                  {eco && <div className="ti-eco">{eco}</div>}
                </div>
                <div className="ti-amount">{formatMoney(r.amountPaid)}</div>
              </Link>
              <button
                type="button"
                className="btn ghost danger-text icon-btn"
                onClick={() => onDelete(r.id)}
                aria-label={t('common.delete')}
                title={t('common.delete')}
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
