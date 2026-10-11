import { type FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { QuickEntryNavState } from '../components/QuickEntrySheet';
import type { QuickEntryPrefill } from '../lib/quickEntryParse';
import { learnFromQuickEntrySave } from '../lib/quickEntryLearn';
import { getVehicle, listVehicles, putVehicle } from '../repositories/vehicles';
import { getRecord, latestOdometer, putRecord } from '../repositories/records';
import { listStations } from '../repositories/stations';
import { getSetting } from '../repositories/settings';
import { putMediaFromFile } from '../repositories/media';
import { useSettings } from '../hooks/useAppData';
import { DateTimeField } from '../components/DateTimeField';
import { formatDateTimeLocal, nowISO, parkingKindLabel, recordTypeLabel, uid } from '../lib/constants';
import { assertSocOrder, parseSocPercent } from '../lib/energy';
import type {
  CareRecord,
  ChargeStationKind,
  GoodsCategory,
  MaintenanceCategory,
  ModArea,
  ParkingKind,
  RecordType,
  Station,
  Vehicle,
  WashKind,
} from '../types';

export function RecordFormPage() {
  const { vehicleId, recordId, type: typeParam } = useParams();
  const isNew = recordId === 'new' || !recordId;
  const nav = useNavigate();
  const routeLocation = useLocation();
  const qeNav = routeLocation.state as QuickEntryNavState | null;
  const quickPrefill = qeNav?.prefill;
  const learnSnapshot = qeNav?.learnSnapshot;
  const { settings, t, language } = useSettings();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [type, setType] = useState<RecordType>((typeParam as RecordType) || 'fuel');
  const [date, setDate] = useState(formatDateTimeLocal(new Date().toISOString()));
  const [odometer, setOdometer] = useState('');
  const [amountDue, setAmountDue] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [anomaly, setAnomaly] = useState(false);
  const [err, setErr] = useState('');

  // fuel
  const [stationName, setStationName] = useState('');
  const [stationId, setStationId] = useState('');
  const [fuelGrade, setFuelGrade] = useState('95#');
  const [unitPrice, setUnitPrice] = useState('');
  const [liters, setLiters] = useState('');
  const [filledUp, setFilledUp] = useState(true);
  const [grades, setGrades] = useState<string[]>([]);
  const [gasStations, setGasStations] = useState<Station[]>([]);
  const [chargeStations, setChargeStations] = useState<Station[]>([]);

  // charge
  const [stationKind, setStationKind] = useState<ChargeStationKind>('public');
  const [kWh, setKWh] = useState('');
  const [socBefore, setSocBefore] = useState('');
  const [socAfter, setSocAfter] = useState('');
  const [duration, setDuration] = useState('');

  // maintenance
  const [category, setCategory] = useState<MaintenanceCategory>('service');
  const [title, setTitle] = useState('');
  const [vendor, setVendor] = useState('');
  const [nextOdo, setNextOdo] = useState('');
  const [nextDate, setNextDate] = useState('');

  // mod
  const [area, setArea] = useState<ModArea>('exterior');
  const [brandSpec, setBrandSpec] = useState('');

  // wash
  const [washKind, setWashKind] = useState<WashKind>('basic');
  const [place, setPlace] = useState('');

  // goods
  const [goodsName, setGoodsName] = useState('');
  const [goodsCat, setGoodsCat] = useState<GoodsCategory>('other');
  const [qty, setQty] = useState('1');
  const [goodsUnit, setGoodsUnit] = useState('');
  const [channel, setChannel] = useState('');

  // ticket
  const [violation, setViolation] = useState('');
  const [location, setLocation] = useState('');
  const [points, setPoints] = useState('');
  const [paid, setPaid] = useState(true);
  const [paidAt, setPaidAt] = useState('');

  // parking
  const [parkingKind, setParkingKind] = useState<ParkingKind>('temporary');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [parkDuration, setParkDuration] = useState('');

  // toll
  const [route, setRoute] = useState('');

  // insurance
  const [insurer, setInsurer] = useState('');
  const [policyName, setPolicyName] = useState('');
  // reuses periodStart / periodEnd from parking when type is insurance

  function applyQuickPrefill(p?: QuickEntryPrefill) {
    if (!p) return;
    if (p.amountPaid != null) setAmountPaid(String(p.amountPaid));
    if (p.amountDue != null) setAmountDue(String(p.amountDue));
    if (p.discount != null) setDiscount(String(p.discount));
    if (p.liters != null) setLiters(String(p.liters));
    if (p.kWh != null) setKWh(String(p.kWh));
    if (p.odometer != null) setOdometer(String(p.odometer));
    if (p.unitPrice != null) setUnitPrice(String(p.unitPrice));
    if (p.stationName) setStationName(p.stationName);
    if (p.stationId) setStationId(p.stationId);
    if (p.fuelGrade) setFuelGrade(p.fuelGrade);
    if (p.note) setNote(p.note);
    if (p.place) setPlace(p.place);
    if (p.route) setRoute(p.route);
    if (p.title) setTitle(p.title);
    if (p.parkingKind) setParkingKind(p.parkingKind);
    if (p.insurer) setInsurer(p.insurer);
    if (p.policyName) setPolicyName(p.policyName);
    if (p.date) setDate(formatDateTimeLocal(p.date));
  }

  useEffect(() => {
    if (!vehicleId) return;
    getVehicle(vehicleId).then((v) => setVehicle(v ?? null));
    getSetting<string[]>('fuelGrades').then((g) => g && setGrades(g));
    getSetting<string>('defaultFuelGrade').then((g) => g && setFuelGrade(g));
    listStations('gas').then(setGasStations);
    listStations('charge').then(setChargeStations);
    if (typeParam) setType(typeParam as RecordType);

    if (!isNew && recordId) {
      getRecord(recordId).then((r) => {
        if (!r) return;
        setType(r.type);
        setDate(formatDateTimeLocal(r.date));
        setOdometer(r.odometer?.toString() ?? '');
        setAmountDue(r.amountDue?.toString() ?? '');
        setAmountPaid(r.amountPaid?.toString() ?? '0');
        setDiscount(r.discount?.toString() ?? '');
        setNote(r.note ?? '');
        setMediaIds(r.mediaIds ?? []);
        setAnomaly(!!r.flags?.odometerAnomaly);
        if (r.type === 'fuel') {
          setStationName(r.stationName ?? '');
          setStationId(r.stationId ?? '');
          setFuelGrade(r.fuelGrade);
          setUnitPrice(r.unitPrice?.toString() ?? '');
          setLiters(r.liters.toString());
          setFilledUp(r.filledUp);
        } else if (r.type === 'charge') {
          setStationName(r.stationName);
          setStationId(r.stationId ?? '');
          setStationKind(r.stationKind);
          setKWh(r.kWh.toString());
          setSocBefore(r.socBefore != null ? String(r.socBefore) : '');
          setSocAfter(r.socAfter != null ? String(r.socAfter) : '');
          setDuration(r.durationMinutes?.toString() ?? '');
        } else if (r.type === 'maintenance') {
          setCategory(r.category);
          setTitle(r.title);
          setVendor(r.vendor ?? '');
          setNextOdo(r.nextServiceOdometer?.toString() ?? '');
          setNextDate(r.nextServiceDate ? formatDateTimeLocal(r.nextServiceDate).slice(0, 10) : '');
        } else if (r.type === 'modification') {
          setArea(r.area);
          setTitle(r.title);
          setBrandSpec(r.brandSpec ?? '');
        } else if (r.type === 'wash') {
          setWashKind(r.washKind);
          setPlace(r.place ?? '');
        } else if (r.type === 'goods') {
          setGoodsName(r.name);
          setGoodsCat(r.category);
          setQty(r.quantity?.toString() ?? '');
          setGoodsUnit(r.unitPrice?.toString() ?? '');
          setChannel(r.channel ?? '');
        } else if (r.type === 'ticket') {
          setViolation(r.violationType ?? '');
          setLocation(r.location ?? '');
          setPoints(r.points?.toString() ?? '');
          setPaid(r.paid);
          setPaidAt(r.paidAt ? formatDateTimeLocal(r.paidAt).slice(0, 10) : '');
        } else if (r.type === 'parking') {
          setParkingKind(r.parkingKind);
          setPlace(r.place ?? '');
          setPeriodStart(r.periodStart ? formatDateTimeLocal(r.periodStart).slice(0, 10) : '');
          setPeriodEnd(r.periodEnd ? formatDateTimeLocal(r.periodEnd).slice(0, 10) : '');
          setParkDuration(r.durationMinutes?.toString() ?? '');
        } else if (r.type === 'toll') {
          setRoute(r.route ?? '');
        } else if (r.type === 'insurance') {
          setInsurer(r.insurer ?? '');
          setPolicyName(r.policyName ?? '');
          setPeriodStart(r.periodStart ? formatDateTimeLocal(r.periodStart).slice(0, 10) : '');
          setPeriodEnd(r.periodEnd ? formatDateTimeLocal(r.periodEnd).slice(0, 10) : '');
        }
      });
    } else if (isNew && vehicleId) {
      // Prefill 行驶里程 hint: last record odo, else vehicle initialOdometer.
      // Parser-provided odometer must win over the default latest seed.
      Promise.all([latestOdometer(vehicleId), getVehicle(vehicleId)]).then(([last, v]) => {
        const seed = last ?? v?.initialOdometer;
        if (seed != null && quickPrefill?.odometer == null) setOdometer(String(seed));
        // Quick-entry prefill overlays defaults (still user must submit to save).
        applyQuickPrefill(quickPrefill);
      });
    }
  }, [vehicleId, recordId, isNew, typeParam, quickPrefill]);

  function syncDiscount(due: string, paidVal: string) {
    const d = Number(due);
    const p = Number(paidVal);
    if (!Number.isNaN(d) && !Number.isNaN(p) && due !== '' && paidVal !== '') {
      setDiscount(Math.max(0, d - p).toFixed(2));
    }
  }

  async function onPickImages(files: FileList | null) {
    if (!files?.length) return;
    try {
      const ids = [...mediaIds];
      for (const f of Array.from(files)) {
        const m = await putMediaFromFile(f);
        ids.push(m.id);
      }
      setMediaIds(ids);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('rform.errMedia'));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!vehicleId || !vehicle) return;
    setErr('');
    const ts = nowISO();
    const existing = !isNew && recordId ? await getRecord(recordId) : undefined;
    const odoNum = odometer === '' ? undefined : Number(odometer);
    let odometerAnomaly = false;

    if (type === 'fuel' || type === 'charge') {
      if (odoNum == null || Number.isNaN(odoNum)) {
        setErr(t('rform.errOdoRequired'));
        return;
      }
      const last = await latestOdometer(vehicleId);
      if (last != null && odoNum < last && (!existing || existing.odometer !== odoNum)) {
        if (!confirm(t('rform.errOdoConfirm', { odo: odoNum, last }))) return;
        odometerAnomaly = true;
      }
    }

    const paidNum = Number(amountPaid || 0);
    const dueNum = amountDue === '' ? undefined : Number(amountDue);
    const discNum = discount === '' ? undefined : Number(discount);
    const common = {
      id: existing?.id ?? uid(),
      vehicleId,
      date: new Date(date).toISOString(),
      odometer: odoNum,
      amountDue: dueNum,
      amountPaid: paidNum,
      discount: discNum,
      note: note.trim() || undefined,
      mediaIds,
      flags: {
        odometerAnomaly: odometerAnomaly || anomaly,
        lowConfidenceEconomy: type === 'fuel' ? !filledUp : undefined,
      },
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };

    let rec: CareRecord;
    try {
      if (type === 'fuel') {
        if (!liters) throw new Error(t('rform.errLiters'));
        const L = Number(liters);
        let up = unitPrice === '' ? undefined : Number(unitPrice);
        if (up == null && L > 0 && paidNum > 0) up = paidNum / L;
        rec = {
          ...common,
          type: 'fuel',
          stationName: stationName || undefined,
          stationId: stationId || undefined,
          fuelGrade,
          unitPrice: up,
          liters: L,
          filledUp,
          odometer: odoNum!,
        };
      } else if (type === 'charge') {
        if (!stationName.trim()) throw new Error(t('rform.errStation'));
        if (!kWh) throw new Error(t('rform.errKWh'));
        const socB = parseSocPercent(socBefore, t('rform.socBeforeLabel'));
        const socA = parseSocPercent(socAfter, t('rform.socAfterLabel'));
        assertSocOrder(socB, socA);
        rec = {
          ...common,
          type: 'charge',
          stationName: stationName.trim(),
          stationId: stationId || undefined,
          stationKind,
          kWh: Number(kWh),
          socBefore: socB,
          socAfter: socA,
          durationMinutes: duration === '' ? undefined : Number(duration),
          odometer: odoNum!,
        };
      } else if (type === 'maintenance') {
        if (!title.trim()) throw new Error(t('rform.errTitle'));
        rec = {
          ...common,
          type: 'maintenance',
          category,
          title: title.trim(),
          vendor: vendor || undefined,
          nextServiceOdometer: nextOdo === '' ? undefined : Number(nextOdo),
          nextServiceDate: nextDate ? new Date(nextDate).toISOString() : undefined,
        };
      } else if (type === 'modification') {
        if (!title.trim()) throw new Error(t('rform.errTitle'));
        rec = {
          ...common,
          type: 'modification',
          area,
          title: title.trim(),
          brandSpec: brandSpec || undefined,
        };
      } else if (type === 'wash') {
        rec = {
          ...common,
          type: 'wash',
          washKind,
          place: place || undefined,
        };
      } else if (type === 'goods') {
        if (!goodsName.trim()) throw new Error(t('rform.errGoodsName'));
        rec = {
          ...common,
          type: 'goods',
          name: goodsName.trim(),
          category: goodsCat,
          quantity: qty === '' ? undefined : Number(qty),
          unitPrice: goodsUnit === '' ? undefined : Number(goodsUnit),
          channel: channel || undefined,
        };
      } else if (type === 'ticket') {
        rec = {
          ...common,
          type: 'ticket',
          violationType: violation || undefined,
          location: location || undefined,
          points: points === '' ? undefined : Number(points),
          paid,
          paidAt: paid && paidAt ? new Date(paidAt).toISOString() : paid ? ts : undefined,
        };
      } else if (type === 'parking') {
        if (parkingKind === 'fixed' && periodStart && periodEnd) {
          const ps = new Date(periodStart).getTime();
          const pe = new Date(periodEnd).getTime();
          if (!Number.isNaN(ps) && !Number.isNaN(pe) && pe < ps) {
            throw new Error(t('rform.errPeriod'));
          }
        }
        rec = {
          ...common,
          type: 'parking',
          parkingKind,
          place: place.trim() || undefined,
          periodStart:
            parkingKind === 'fixed' && periodStart
              ? new Date(periodStart).toISOString()
              : undefined,
          periodEnd:
            parkingKind === 'fixed' && periodEnd
              ? new Date(periodEnd).toISOString()
              : undefined,
          durationMinutes:
            parkingKind === 'temporary' && parkDuration !== ''
              ? Number(parkDuration)
              : undefined,
        };
      } else if (type === 'toll') {
        rec = {
          ...common,
          type: 'toll',
          route: route.trim() || undefined,
        };
      } else {
        if (periodStart && periodEnd) {
          const ps = new Date(periodStart).getTime();
          const pe = new Date(periodEnd).getTime();
          if (!Number.isNaN(ps) && !Number.isNaN(pe) && pe < ps) {
            throw new Error(t('rform.errCoverage'));
          }
        }
        rec = {
          ...common,
          type: 'insurance',
          insurer: insurer.trim() || undefined,
          policyName: policyName.trim() || undefined,
          periodStart: periodStart ? new Date(periodStart).toISOString() : undefined,
          periodEnd: periodEnd ? new Date(periodEnd).toISOString() : undefined,
        };
      }
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t('rform.errValidate'));
      return;
    }

    try {
      await putRecord(rec);
      await putVehicle({ ...vehicle, updatedAt: ts });
      // Silent local learn from quick-entry corrections (never upload; only after user save).
      if (isNew && learnSnapshot) {
        try {
          const allVehicles = await listVehicles();
          await learnFromQuickEntrySave({
            snapshot: learnSnapshot,
            vehicleId,
            record: rec,
            vehicles: allVehicles,
          });
        } catch {
          /* learning must not block save */
        }
      }
      nav(`/vehicles/${vehicleId}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t('rform.errSave'));
    }
  }

  if (!vehicle) return <div className="page"><p className="muted">{t('app.loading')}</p></div>;

  return (
    <div className="page">
      <header className="page-header">
        <Link to={`/vehicles/${vehicleId}`} className="btn ghost">
          {t('common.back')}
        </Link>
        <h1>
          {isNew ? t('rform.new') : t('rform.edit')}
          {recordTypeLabel(type, language)}
        </h1>
      </header>

      <form className="form" onSubmit={onSubmit}>
        <label>
          {t('rform.datetime')}
          <DateTimeField
            mode="datetime"
            value={date}
            onChange={setDate}
            required
            dateFormat={settings?.dateFormat}
            timeFormat={settings?.timeFormat}
            language={language}
          />
        </label>

        {(type === 'fuel' || type === 'charge' || type === 'maintenance' || type === 'modification' || type === 'wash') && (
          <label>
            {t('rform.odometer')}{type === 'fuel' || type === 'charge' ? ' *' : ''}
            <input type="number" value={odometer} onChange={(e) => setOdometer(e.target.value)} required={type === 'fuel' || type === 'charge'} />
            {(type === 'fuel' || type === 'charge') && (
              <span className="field-hint">{t('rform.odometerHint')}</span>
            )}
          </label>
        )}

        {type === 'fuel' && (
          <>
            <label>
              {t('rform.favGas')}
              <select
                value={stationId}
                onChange={(e) => {
                  const id = e.target.value;
                  setStationId(id);
                  const s = gasStations.find((x) => x.id === id);
                  if (s) {
                    setStationName(s.name);
                    if (s.preferredFuelGrade) setFuelGrade(s.preferredFuelGrade);
                  }
                }}
              >
                <option value="">{t('common.manualInput')}</option>
                {gasStations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('rform.station')}
              <input value={stationName} onChange={(e) => setStationName(e.target.value)} />
            </label>
            <label>
              {t('rform.fuelGrade')}
              <select value={fuelGrade} onChange={(e) => setFuelGrade(e.target.value)}>
                {grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('rform.liters')}
              <input type="number" step="0.01" value={liters} onChange={(e) => setLiters(e.target.value)} required />
            </label>
            <label>
              {t('rform.unitPrice')}
              <input type="number" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </label>
            <label className="row-check">
              <input type="checkbox" checked={filledUp} onChange={(e) => setFilledUp(e.target.checked)} />
              {t('rform.filledUp')}
            </label>
          </>
        )}

        {type === 'charge' && (
          <>
            <label>
              {t('rform.favCharge')}
              <select
                value={stationId}
                onChange={(e) => {
                  const id = e.target.value;
                  setStationId(id);
                  const s = chargeStations.find((x) => x.id === id);
                  if (s) {
                    setStationName(s.name);
                    if (s.isHome) setStationKind('home');
                  }
                }}
              >
                <option value="">{t('common.manualInput')}</option>
                {chargeStations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isHome ? t('rform.homeChargeParen') : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('rform.chargeStation')}
              <input value={stationName} onChange={(e) => setStationName(e.target.value)} required />
            </label>
            <label>
              {t('rform.stationKind')}
              <select value={stationKind} onChange={(e) => setStationKind(e.target.value as ChargeStationKind)}>
                <option value="public">{t('rform.kindPublic')}</option>
                <option value="home">{t('rform.kindHome')}</option>
                <option value="destination">{t('rform.kindDest')}</option>
                <option value="other">{t('rform.kindOther')}</option>
              </select>
            </label>
            <label>
              {t('rform.kWh')}
              <input type="number" step="0.01" value={kWh} onChange={(e) => setKWh(e.target.value)} required />
            </label>
            <label>
              {t('rform.socBefore')}
              <input
                type="number"
                min={0}
                max={100}
                step="1"
                value={socBefore}
                onChange={(e) => setSocBefore(e.target.value)}
                placeholder="0–100"
              />
            </label>
            <label>
              {t('rform.socAfter')}
              <input
                type="number"
                min={0}
                max={100}
                step="1"
                value={socAfter}
                onChange={(e) => setSocAfter(e.target.value)}
                placeholder="0–100"
              />
            </label>
            <label>
              {t('rform.chargeDuration')}
              <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </label>
          </>
        )}

        {type === 'maintenance' && (
          <>
            <label>
              {t('rform.category')}
              <select value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}>
                <option value="service">{t('rform.maintService')}</option>
                <option value="repair">{t('rform.maintRepair')}</option>
                <option value="beauty">{t('rform.maintBeauty')}</option>
                <option value="tire">{t('rform.maintTire')}</option>
                <option value="other">{t('common.other')}</option>
              </select>
            </label>
            <label>
              {t('rform.title')}
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label>
              {t('rform.vendor')}
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </label>
            <label>
              {t('rform.nextOdo')}
              <input type="number" value={nextOdo} onChange={(e) => setNextOdo(e.target.value)} />
            </label>
            <label>
              {t('rform.nextDate')}
              <DateTimeField
                mode="date"
                value={nextDate}
                onChange={setNextDate}
                dateFormat={settings?.dateFormat}
                timeFormat={settings?.timeFormat}
                language={language}
              />
            </label>
            <p className="muted small">{t('rform.nextHint')}</p>
          </>
        )}

        {type === 'modification' && (
          <>
            <label>
              {t('rform.modArea')}
              <select value={area} onChange={(e) => setArea(e.target.value as ModArea)}>
                <option value="exterior">{t('rform.areaExterior')}</option>
                <option value="interior">{t('rform.areaInterior')}</option>
                <option value="power">{t('rform.areaPower')}</option>
                <option value="chassis">{t('rform.areaChassis')}</option>
                <option value="electronics">{t('rform.areaElectronics')}</option>
                <option value="other">{t('common.other')}</option>
              </select>
            </label>
            <label>
              {t('rform.title')}
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label>
              {t('rform.brandSpec')}
              <input value={brandSpec} onChange={(e) => setBrandSpec(e.target.value)} />
            </label>
          </>
        )}

        {type === 'wash' && (
          <>
            <label>
              {t('rform.washKind')}
              <select value={washKind} onChange={(e) => setWashKind(e.target.value as WashKind)}>
                <option value="basic">{t('rform.washBasic')}</option>
                <option value="detail">{t('rform.washDetail')}</option>
                <option value="coating">{t('rform.washCoating')}</option>
                <option value="interior">{t('rform.washInterior')}</option>
                <option value="other">{t('common.other')}</option>
              </select>
            </label>
            <label>
              {t('rform.place')}
              <input value={place} onChange={(e) => setPlace(e.target.value)} />
            </label>
          </>
        )}

        {type === 'goods' && (
          <>
            <label>
              {t('rform.goodsName')}
              <input value={goodsName} onChange={(e) => setGoodsName(e.target.value)} required />
            </label>
            <label>
              {t('rform.category')}
              <select value={goodsCat} onChange={(e) => setGoodsCat(e.target.value as GoodsCategory)}>
                <option value="oil">{t('rform.goodsOil')}</option>
                <option value="filter">{t('rform.goodsFilter')}</option>
                <option value="tire">{t('rform.goodsTire')}</option>
                <option value="electronics">{t('rform.goodsElectronics')}</option>
                <option value="other">{t('common.other')}</option>
              </select>
            </label>
            <label>
              {t('rform.qty')}
              <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <label>
              {t('rform.goodsUnitPrice')}
              <input type="number" step="0.01" value={goodsUnit} onChange={(e) => setGoodsUnit(e.target.value)} />
            </label>
            <label>
              {t('rform.channel')}
              <input value={channel} onChange={(e) => setChannel(e.target.value)} />
            </label>
          </>
        )}

        {type === 'ticket' && (
          <>
            <label>
              {t('rform.violation')}
              <input value={violation} onChange={(e) => setViolation(e.target.value)} />
            </label>
            <label>
              {t('rform.place')}
              <input value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label>
              {t('rform.points')}
              <input type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
            </label>
            <label className="row-check">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
              {t('rform.paid')}
            </label>
            {paid && (
              <label>
                {t('rform.paidAt')}
                <DateTimeField
                  mode="date"
                  value={paidAt}
                  onChange={setPaidAt}
                  dateFormat={settings?.dateFormat}
                  timeFormat={settings?.timeFormat}
                  language={language}
                />
              </label>
            )}
            <p className="muted small">{t('rform.ticketHint')}</p>
          </>
        )}

        {type === 'parking' && (
          <>
            <label>
              {t('rform.parkingKind')}
              <select value={parkingKind} onChange={(e) => setParkingKind(e.target.value as ParkingKind)}>
                <option value="fixed">{parkingKindLabel('fixed', language)}</option>
                <option value="temporary">{parkingKindLabel('temporary', language)}</option>
              </select>
            </label>
            <label>
              {t('rform.parkingPlace')}
              <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('rform.parkingPlacePh')} />
            </label>
            {parkingKind === 'fixed' && (
              <>
                <label>
                  {t('rform.periodStart')}
                  <DateTimeField
                    mode="date"
                    value={periodStart}
                    onChange={setPeriodStart}
                    dateFormat={settings?.dateFormat}
                    timeFormat={settings?.timeFormat}
                    language={language}
                  />
                </label>
                <label>
                  {t('rform.periodEnd')}
                  <DateTimeField
                    mode="date"
                    value={periodEnd}
                    onChange={setPeriodEnd}
                    dateFormat={settings?.dateFormat}
                    timeFormat={settings?.timeFormat}
                    language={language}
                  />
                </label>
                <p className="muted small">{t('rform.parkingFixedHint')}</p>
              </>
            )}
            {parkingKind === 'temporary' && (
              <label>
                {t('rform.durationMin')}
                <input type="number" value={parkDuration} onChange={(e) => setParkDuration(e.target.value)} />
              </label>
            )}
          </>
        )}

        {type === 'toll' && (
          <label>
            {t('rform.route')}
            <input value={route} onChange={(e) => setRoute(e.target.value)} placeholder={t('rform.routePh')} />
          </label>
        )}

        {type === 'insurance' && (
          <>
            <label>
              {t('rform.insurer')}
              <input value={insurer} onChange={(e) => setInsurer(e.target.value)} placeholder={t('rform.insurerPh')} />
            </label>
            <label>
              {t('rform.policy')}
              <input value={policyName} onChange={(e) => setPolicyName(e.target.value)} placeholder={t('rform.policyPh')} />
            </label>
            <label>
              {t('rform.coverageStart')}
              <DateTimeField
                mode="date"
                value={periodStart}
                onChange={setPeriodStart}
                dateFormat={settings?.dateFormat}
                timeFormat={settings?.timeFormat}
                language={language}
              />
            </label>
            <label>
              {t('rform.coverageEnd')}
              <DateTimeField
                mode="date"
                value={periodEnd}
                onChange={setPeriodEnd}
                dateFormat={settings?.dateFormat}
                timeFormat={settings?.timeFormat}
                language={language}
              />
            </label>
            <p className="muted small">{t('rform.insuranceHint')}</p>
          </>
        )}

        {type !== 'ticket' && (
          <>
            <label>
              {t('rform.amountDue')}
              <input
                type="number"
                step="0.01"
                value={amountDue}
                onChange={(e) => {
                  setAmountDue(e.target.value);
                  syncDiscount(e.target.value, amountPaid);
                }}
              />
            </label>
            <label>
              {t('rform.amountPaid')}
              <input
                type="number"
                step="0.01"
                value={amountPaid}
                onChange={(e) => {
                  setAmountPaid(e.target.value);
                  syncDiscount(amountDue, e.target.value);
                }}
                required
              />
            </label>
            <label>
              {t('rform.discount')}
              <input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </label>
          </>
        )}

        {type === 'ticket' && (
          <label>
            {t('rform.fine')}
            <input type="number" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} required />
          </label>
        )}

        <label>
          {t('rform.note')}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>

        <label>
          {t('rform.media')}
          <input type="file" accept="image/*" multiple onChange={(e) => onPickImages(e.target.files)} />
        </label>
        {mediaIds.length > 0 && <p className="muted small">{t('rform.mediaCount', { n: mediaIds.length })}</p>}

        {err && <p className="error">{err}</p>}
        <button type="submit" className="btn primary block">
          {t('common.save')}
        </button>
      </form>
    </div>
  );
}
