import { useCallback, useEffect, useState } from 'react';
import { listVehicles } from '../repositories/vehicles';
import { listAllRecords, listRecordsByVehicle } from '../repositories/records';
import type { CareRecord, Vehicle } from '../types';
import { useAppData } from '../i18n';

export function useVehicles() {
  const { dbReady } = useAppData();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setVehicles(await listVehicles());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!dbReady) return;
    refresh();
  }, [dbReady, refresh]);

  return { vehicles, loading, refresh };
}

export function useRecords(vehicleId?: string) {
  const { dbReady } = useAppData();
  const [records, setRecords] = useState<CareRecord[]>([]);
  const refresh = useCallback(async () => {
    if (vehicleId) {
      setRecords(await listRecordsByVehicle(vehicleId));
    } else {
      setRecords(await listAllRecords());
    }
  }, [vehicleId]);

  useEffect(() => {
    if (!dbReady) return;
    refresh();
  }, [dbReady, refresh]);

  return { records, refresh };
}

/** Shared settings from AppDataProvider — language changes re-render all consumers. */
export function useSettings() {
  const { settings, refresh, saveSetting, language, t, dbReady } = useAppData();
  return { settings, refresh, saveSetting, language, t, dbReady };
}
