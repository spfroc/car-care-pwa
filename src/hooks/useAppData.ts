import { useCallback, useEffect, useState } from 'react';
import { ensureDefaultSettings, getOpenError, tryPersistStorage } from '../db';
import { listVehicles } from '../repositories/vehicles';
import { listAllRecords, listRecordsByVehicle } from '../repositories/records';
import { loadAppSettings, type AppSettings } from '../repositories/settings';
import type { CareRecord, Vehicle } from '../types';

export function useAppBootstrap() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await ensureDefaultSettings();
        const p = await tryPersistStorage();
        setPersisted(p);
        setReady(true);
      } catch (e) {
        const oe = getOpenError();
        setError(
          oe?.message ||
            (e instanceof Error ? e.message : 'IndexedDB 不可用，无法启动应用'),
        );
      }
    })();
  }, []);

  return { ready, error, persisted };
}

export function useVehicles() {
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
    refresh();
  }, [refresh]);

  return { vehicles, loading, refresh };
}

export function useRecords(vehicleId?: string) {
  const [records, setRecords] = useState<CareRecord[]>([]);
  const refresh = useCallback(async () => {
    if (vehicleId) {
      setRecords(await listRecordsByVehicle(vehicleId));
    } else {
      setRecords(await listAllRecords());
    }
  }, [vehicleId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { records, refresh };
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const refresh = useCallback(async () => {
    setSettings(await loadAppSettings());
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { settings, refresh };
}
