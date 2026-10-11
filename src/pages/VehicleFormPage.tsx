import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BODY_TYPES, bodyLabel, energyLabel, nowISO, uid } from '../lib/constants';
import { deleteVehicle, getVehicle, putVehicle } from '../repositories/vehicles';
import { getSetting } from '../repositories/settings';
import type { BodyType, EnergyType, Vehicle } from '../types';
import { useSettings } from '../hooks/useAppData';
import { ENERGY_LABELS } from '../lib/constants';

const ENERGY_OPTIONS = Object.keys(ENERGY_LABELS) as EnergyType[];

export function VehicleFormPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const nav = useNavigate();
  const { t, language } = useSettings();
  const [name, setName] = useState('');
  const [plate, setPlate] = useState('');
  const [energyType, setEnergyType] = useState<EnergyType>('ICE');
  const [bodyType, setBodyType] = useState<BodyType>('SUV');
  const [fuelGrade, setFuelGrade] = useState('95#');
  const [tank, setTank] = useState('');
  const [battery, setBattery] = useState('');
  const [odo, setOdo] = useState('');
  const [note, setNote] = useState('');
  const [grades, setGrades] = useState<string[]>(['95#']);
  const [err, setErr] = useState('');

  useEffect(() => {
    getSetting<string[]>('fuelGrades').then((g) => g && setGrades(g));
    getSetting<string>('defaultFuelGrade').then((g) => g && setFuelGrade(g));
    if (!isNew && id) {
      getVehicle(id).then((v) => {
        if (!v) return;
        setName(v.name);
        setPlate(v.plate ?? '');
        setEnergyType(v.energyType);
        setBodyType(v.bodyType);
        setFuelGrade(v.fuelGrade ?? '95#');
        setTank(v.tankCapacityL?.toString() ?? '');
        setBattery(v.batteryCapacityKWh?.toString() ?? '');
        setOdo(v.initialOdometer?.toString() ?? '');
        setNote(v.note ?? '');
      });
    }
  }, [id, isNew]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErr(t('vform.nameRequired'));
      return;
    }
    const ts = nowISO();
    const existing = !isNew && id ? await getVehicle(id) : undefined;
    const v: Vehicle = {
      id: existing?.id ?? uid(),
      name: name.trim(),
      plate: plate.trim() || undefined,
      energyType,
      bodyType,
      fuelGrade: ['ICE', 'HEV', 'PHEV', 'REEV'].includes(energyType) ? fuelGrade : undefined,
      tankCapacityL: tank ? Number(tank) : undefined,
      batteryCapacityKWh: battery ? Number(battery) : undefined,
      initialOdometer: odo ? Number(odo) : undefined,
      note: note.trim() || undefined,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };
    await putVehicle(v);
    nav(`/vehicles/${v.id}`);
  }

  async function onDelete() {
    if (!id || isNew) return;
    if (!confirm(t('vform.deleteConfirm1'))) return;
    if (!confirm(t('vform.deleteConfirm2'))) return;
    await deleteVehicle(id);
    nav('/');
  }

  return (
    <div className="page">
      <header className="page-header">
        <Link to={isNew ? '/' : `/vehicles/${id}`} className="btn ghost">
          {t('common.back')}
        </Link>
        <h1>{isNew ? t('vform.new') : t('vform.edit')}</h1>
      </header>
      <form className="form" onSubmit={onSubmit}>
        <label>
          {t('vform.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t('vform.plate')}
          <input value={plate} onChange={(e) => setPlate(e.target.value)} />
        </label>
        <label>
          {t('vform.energy')}
          <select value={energyType} onChange={(e) => setEnergyType(e.target.value as EnergyType)}>
            {ENERGY_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {energyLabel(k, language)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('vform.body')}
          <select value={bodyType} onChange={(e) => setBodyType(e.target.value as BodyType)}>
            {BODY_TYPES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.icon} {bodyLabel(b.value, language)}
              </option>
            ))}
          </select>
        </label>
        {['ICE', 'HEV', 'PHEV', 'REEV'].includes(energyType) && (
          <label>
            {t('vform.fuelGrade')}
            <select value={fuelGrade} onChange={(e) => setFuelGrade(e.target.value)}>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t('vform.tank')}
          <input type="number" step="0.1" value={tank} onChange={(e) => setTank(e.target.value)} />
        </label>
        <label>
          {t('vform.battery')}
          <input type="number" step="0.1" value={battery} onChange={(e) => setBattery(e.target.value)} />
        </label>
        <label>
          {t('vform.initialOdo')}
          <input
            type="number"
            value={odo}
            onChange={(e) => setOdo(e.target.value)}
            placeholder={t('vform.initialOdoPh')}
          />
          <span className="field-hint">{t('vform.initialOdoHint')}</span>
        </label>
        <label>
          {t('vform.note')}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
        {err && <p className="error">{err}</p>}
        <button type="submit" className="btn primary block">
          {t('common.save')}
        </button>
        {!isNew && (
          <button type="button" className="btn danger block" onClick={onDelete}>
            {t('vform.delete')}
          </button>
        )}
      </form>
    </div>
  );
}
