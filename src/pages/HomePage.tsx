import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { VehicleCard } from '../components/VehicleCard';
import { useSettings, useVehicles } from '../hooks/useAppData';
import { listAllRecords } from '../repositories/records';
import type { CareRecord } from '../types';

export function HomePage() {
  const { vehicles, loading, refresh } = useVehicles();
  const { settings } = useSettings();
  const [records, setRecords] = useState<CareRecord[]>([]);

  useEffect(() => {
    listAllRecords().then(setRecords);
    refresh();
  }, [refresh]);

  if (loading || !settings) return <div className="page"><p className="muted">加载中…</p></div>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>车护助手</h1>
          <p className="muted">离线车辆养护账本</p>
        </div>
        <Link to="/vehicles/new" className="btn primary">
          + 车辆
        </Link>
      </header>

      {vehicles.length === 0 ? (
        <div className="empty">
          <p>还没有车辆</p>
          <Link to="/vehicles/new" className="btn primary">
            添加第一辆车
          </Link>
          <p className="muted small">或到设置中载入演示数据</p>
        </div>
      ) : (
        <div className="stack">
          {vehicles.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              records={records}
              hevAllowCharge={settings.hevAllowCharge}
              fuelUnit={settings.fuelEconomyUnit}
              electricUnit={settings.electricEconomyUnit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
