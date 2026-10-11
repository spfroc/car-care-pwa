import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { QuickEntryFab } from '../components/QuickEntrySheet';
import { VehicleCard } from '../components/VehicleCard';
import { useSettings, useVehicles } from '../hooks/useAppData';
import { listAllRecords } from '../repositories/records';
import { listStations } from '../repositories/stations';
import type { CareRecord, Station } from '../types';

export function HomePage() {
  const { vehicles, loading, refresh } = useVehicles();
  const { settings, t } = useSettings();
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [stations, setStations] = useState<Station[]>([]);

  useEffect(() => {
    listAllRecords().then(setRecords);
    listStations().then(setStations);
    refresh();
  }, [refresh]);

  if (loading || !settings) return <div className="page"><p className="muted">{t('app.loading')}</p></div>;

  return (
    <div className="page page-home">
      <header className="page-header">
        <div>
          <h1>{t('app.name')}</h1>
          <p className="muted">{t('app.tagline')}</p>
        </div>
        <Link to="/vehicles/new" className="btn primary">
          {t('home.addVehicle')}
        </Link>
      </header>

      {vehicles.length === 0 ? (
        <div className="empty">
          <p>{t('home.empty')}</p>
          <Link to="/vehicles/new" className="btn primary">
            {t('home.addFirst')}
          </Link>
          <p className="muted small">{t('home.emptyHint')}</p>
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

      <QuickEntryFab vehicles={vehicles} records={records} stations={stations} />
    </div>
  );
}
