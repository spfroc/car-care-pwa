import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BODY_TYPES, ENERGY_LABELS, nowISO, uid } from '../lib/constants';
import { deleteVehicle, getVehicle, putVehicle } from '../repositories/vehicles';
import { getSetting } from '../repositories/settings';
import type { BodyType, EnergyType, Vehicle } from '../types';

const ENERGY_OPTIONS = Object.keys(ENERGY_LABELS) as EnergyType[];

export function VehicleFormPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const nav = useNavigate();
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
      setErr('请填写昵称');
      return;
    }
    const t = nowISO();
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
      createdAt: existing?.createdAt ?? t,
      updatedAt: t,
    };
    await putVehicle(v);
    nav(`/vehicles/${v.id}`);
  }

  async function onDelete() {
    if (!id || isNew) return;
    if (!confirm('删除车辆将一并删除其全部记录与图片，确定？')) return;
    if (!confirm('再次确认：此操作不可恢复')) return;
    await deleteVehicle(id);
    nav('/');
  }

  return (
    <div className="page">
      <header className="page-header">
        <Link to={isNew ? '/' : `/vehicles/${id}`} className="btn ghost">
          ← 返回
        </Link>
        <h1>{isNew ? '新增车辆' : '编辑车辆'}</h1>
      </header>
      <form className="form" onSubmit={onSubmit}>
        <label>
          昵称 *
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          车牌
          <input value={plate} onChange={(e) => setPlate(e.target.value)} />
        </label>
        <label>
          能源类型 *
          <select value={energyType} onChange={(e) => setEnergyType(e.target.value as EnergyType)}>
            {ENERGY_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {ENERGY_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          车身类型 *
          <select value={bodyType} onChange={(e) => setBodyType(e.target.value as BodyType)}>
            {BODY_TYPES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.icon} {b.label}
              </option>
            ))}
          </select>
        </label>
        {['ICE', 'HEV', 'PHEV', 'REEV'].includes(energyType) && (
          <label>
            燃油标号
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
          油箱容积 (L)
          <input type="number" step="0.1" value={tank} onChange={(e) => setTank(e.target.value)} />
        </label>
        <label>
          电池容量 (kWh)
          <input type="number" step="0.1" value={battery} onChange={(e) => setBattery(e.target.value)} />
        </label>
        <label>
          初始行驶里程 (km)
          <input
            type="number"
            value={odo}
            onChange={(e) => setOdo(e.target.value)}
            placeholder="建档时的表显总里程"
          />
          <span className="field-hint">
            用作统计里程基线；之后加油/充电填写的里程会更新「行驶里程」展示。
          </span>
        </label>
        <label>
          备注
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>
        {err && <p className="error">{err}</p>}
        <button type="submit" className="btn primary block">
          保存
        </button>
        {!isNew && (
          <button type="button" className="btn danger block" onClick={onDelete}>
            删除车辆
          </button>
        )}
      </form>
    </div>
  );
}
