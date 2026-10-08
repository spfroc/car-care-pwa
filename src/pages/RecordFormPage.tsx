import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getVehicle, putVehicle } from '../repositories/vehicles';
import { getRecord, latestOdometer, putRecord } from '../repositories/records';
import { listStations } from '../repositories/stations';
import { getSetting } from '../repositories/settings';
import { putMediaFromFile } from '../repositories/media';
import { formatDateTimeLocal, nowISO, uid } from '../lib/constants';
import type {
  CareRecord,
  ChargeStationKind,
  GoodsCategory,
  MaintenanceCategory,
  ModArea,
  RecordType,
  Station,
  Vehicle,
  WashKind,
} from '../types';

export function RecordFormPage() {
  const { vehicleId, recordId, type: typeParam } = useParams();
  const isNew = recordId === 'new' || !recordId;
  const nav = useNavigate();
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
        }
      });
    }
  }, [vehicleId, recordId, isNew, typeParam]);

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
      setErr(e instanceof Error ? e.message : '图片保存失败');
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!vehicleId || !vehicle) return;
    setErr('');
    const t = nowISO();
    const existing = !isNew && recordId ? await getRecord(recordId) : undefined;
    const odoNum = odometer === '' ? undefined : Number(odometer);
    let odometerAnomaly = false;

    if (type === 'fuel' || type === 'charge') {
      if (odoNum == null || Number.isNaN(odoNum)) {
        setErr('补能记录必须填写里程');
        return;
      }
      const last = await latestOdometer(vehicleId);
      if (last != null && odoNum < last && (!existing || existing.odometer !== odoNum)) {
        if (!confirm(`里程 ${odoNum} 小于已有最大里程 ${last}，仍要保存并标记「里程异常」？`)) return;
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
      createdAt: existing?.createdAt ?? t,
      updatedAt: t,
    };

    let rec: CareRecord;
    try {
      if (type === 'fuel') {
        if (!liters) throw new Error('请填写加油量');
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
        if (!stationName.trim()) throw new Error('请填写充电站/地点');
        if (!kWh) throw new Error('请填写充电量');
        const parseSoc = (raw: string, label: string): number | undefined => {
          if (raw === '') return undefined;
          const n = Number(raw);
          if (Number.isNaN(n) || n < 0 || n > 100) {
            throw new Error(`${label}须为 0–100 的电量百分比`);
          }
          return n;
        };
        const socB = parseSoc(socBefore, '充电前电量');
        const socA = parseSoc(socAfter, '充电后电量');
        if (socB != null && socA != null && socA < socB) {
          throw new Error('充电后电量不能低于充电前电量');
        }
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
        if (!title.trim()) throw new Error('请填写项目名称');
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
        if (!title.trim()) throw new Error('请填写项目名称');
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
        if (!goodsName.trim()) throw new Error('请填写名称');
        rec = {
          ...common,
          type: 'goods',
          name: goodsName.trim(),
          category: goodsCat,
          quantity: qty === '' ? undefined : Number(qty),
          unitPrice: goodsUnit === '' ? undefined : Number(goodsUnit),
          channel: channel || undefined,
        };
      } else {
        rec = {
          ...common,
          type: 'ticket',
          violationType: violation || undefined,
          location: location || undefined,
          points: points === '' ? undefined : Number(points),
          paid,
          paidAt: paid && paidAt ? new Date(paidAt).toISOString() : paid ? t : undefined,
        };
      }
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : '校验失败');
      return;
    }

    try {
      await putRecord(rec);
      await putVehicle({ ...vehicle, updatedAt: t });
      nav(`/vehicles/${vehicleId}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : '保存失败');
    }
  }

  if (!vehicle) return <div className="page"><p className="muted">加载中…</p></div>;

  return (
    <div className="page">
      <header className="page-header">
        <Link to={`/vehicles/${vehicleId}`} className="btn ghost">
          ← 返回
        </Link>
        <h1>
          {isNew ? '新增' : '编辑'}
          {type === 'fuel' && '加油'}
          {type === 'charge' && '充电'}
          {type === 'maintenance' && '维保'}
          {type === 'modification' && '改装'}
          {type === 'wash' && '洗车'}
          {type === 'goods' && '配件'}
          {type === 'ticket' && '罚单'}
        </h1>
      </header>

      <form className="form" onSubmit={onSubmit}>
        <label>
          日期时间 *
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>

        {(type === 'fuel' || type === 'charge' || type === 'maintenance' || type === 'modification' || type === 'wash') && (
          <label>
            当前里程 (km){type === 'fuel' || type === 'charge' ? ' *' : ''}
            <input type="number" value={odometer} onChange={(e) => setOdometer(e.target.value)} required={type === 'fuel' || type === 'charge'} />
          </label>
        )}

        {type === 'fuel' && (
          <>
            <label>
              收藏加油站
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
                <option value="">手动输入</option>
                {gasStations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              加油站
              <input value={stationName} onChange={(e) => setStationName(e.target.value)} />
            </label>
            <label>
              燃油标号 *
              <select value={fuelGrade} onChange={(e) => setFuelGrade(e.target.value)}>
                {grades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label>
              加油量 (L) *
              <input type="number" step="0.01" value={liters} onChange={(e) => setLiters(e.target.value)} required />
            </label>
            <label>
              单价 (元/L)
              <input type="number" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </label>
            <label className="row-check">
              <input type="checkbox" checked={filledUp} onChange={(e) => setFilledUp(e.target.checked)} />
              是否加满
            </label>
          </>
        )}

        {type === 'charge' && (
          <>
            <label>
              收藏充电站
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
                <option value="">手动输入</option>
                {chargeStations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isHome ? '（家充）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              充电站/地点 *
              <input value={stationName} onChange={(e) => setStationName(e.target.value)} required />
            </label>
            <label>
              站类型 *
              <select value={stationKind} onChange={(e) => setStationKind(e.target.value as ChargeStationKind)}>
                <option value="public">公共站</option>
                <option value="home">家充</option>
                <option value="destination">目的地桩</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              充电量 (kWh) *
              <input type="number" step="0.01" value={kWh} onChange={(e) => setKWh(e.target.value)} required />
            </label>
            <label>
              充电前电量 (%)
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
              充电后电量 (%)
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
              充电时长 (分钟)
              <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </label>
          </>
        )}

        {type === 'maintenance' && (
          <>
            <label>
              类别
              <select value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}>
                <option value="service">保养</option>
                <option value="repair">维修</option>
                <option value="beauty">美容</option>
                <option value="tire">轮胎</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              项目名称 *
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label>
              服务商
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </label>
            <label>
              下次保养里程
              <input type="number" value={nextOdo} onChange={(e) => setNextOdo(e.target.value)} />
            </label>
            <label>
              下次保养日期
              <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            </label>
            <p className="muted small">下次保养仅存储，不产生提醒</p>
          </>
        )}

        {type === 'modification' && (
          <>
            <label>
              部位
              <select value={area} onChange={(e) => setArea(e.target.value as ModArea)}>
                <option value="exterior">外观</option>
                <option value="interior">内饰</option>
                <option value="power">动力</option>
                <option value="chassis">底盘</option>
                <option value="electronics">电子</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              项目名称 *
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label>
              品牌/规格
              <input value={brandSpec} onChange={(e) => setBrandSpec(e.target.value)} />
            </label>
          </>
        )}

        {type === 'wash' && (
          <>
            <label>
              类型
              <select value={washKind} onChange={(e) => setWashKind(e.target.value as WashKind)}>
                <option value="basic">普洗</option>
                <option value="detail">精洗</option>
                <option value="coating">镀膜</option>
                <option value="interior">内饰清洁</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              地点
              <input value={place} onChange={(e) => setPlace(e.target.value)} />
            </label>
          </>
        )}

        {type === 'goods' && (
          <>
            <label>
              名称 *
              <input value={goodsName} onChange={(e) => setGoodsName(e.target.value)} required />
            </label>
            <label>
              类别
              <select value={goodsCat} onChange={(e) => setGoodsCat(e.target.value as GoodsCategory)}>
                <option value="oil">机油</option>
                <option value="filter">滤芯</option>
                <option value="tire">轮胎</option>
                <option value="electronics">电子</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              数量
              <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <label>
              单价
              <input type="number" step="0.01" value={goodsUnit} onChange={(e) => setGoodsUnit(e.target.value)} />
            </label>
            <label>
              购买渠道
              <input value={channel} onChange={(e) => setChannel(e.target.value)} />
            </label>
          </>
        )}

        {type === 'ticket' && (
          <>
            <label>
              违章类型
              <input value={violation} onChange={(e) => setViolation(e.target.value)} />
            </label>
            <label>
              地点
              <input value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label>
              扣分
              <input type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
            </label>
            <label className="row-check">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
              已缴费
            </label>
            {paid && (
              <label>
                缴费日期
                <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </label>
            )}
            <p className="muted small">仅记录单笔金额与扣分，不做驾驶证周期统计</p>
          </>
        )}

        {type !== 'ticket' && (
          <>
            <label>
              应付金额
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
              实付金额 *
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
              优惠金额
              <input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </label>
          </>
        )}

        {type === 'ticket' && (
          <label>
            罚款金额 *
            <input type="number" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} required />
          </label>
        )}

        <label>
          备注
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </label>

        <label>
          图片附件
          <input type="file" accept="image/*" multiple onChange={(e) => onPickImages(e.target.files)} />
        </label>
        {mediaIds.length > 0 && <p className="muted small">已附 {mediaIds.length} 张图（已压缩 JPEG）</p>}

        {err && <p className="error">{err}</p>}
        <button type="submit" className="btn primary block">
          保存
        </button>
      </form>
    </div>
  );
}
