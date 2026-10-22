import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { readShellBootCache } from '../lib/shellBoot';
import { ensureDefaultSettings, getOpenError, tryPersistStorage } from '../db';
import {
  fallbackAppSettings,
  loadAppSettings,
  setSetting,
  type AppSettings,
} from '../repositories/settings';
import {
  documentLangFor,
  normalizeLanguage,
  type AppLanguage,
} from '../lib/datetime';
import { translate, type MessageKey } from './messages';

type TFunction = (key: MessageKey, params?: Record<string, string | number>) => string;

type AppDataContextValue = {
  settings: AppSettings;
  /** True after default settings are ensured and the settings row has been read. */
  dbReady: boolean;
  error: string | null;
  persisted: boolean;
  language: AppLanguage;
  refresh: () => Promise<void>;
  saveSetting: (key: string, value: unknown) => Promise<void>;
  t: TFunction;
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() =>
    fallbackAppSettings(readShellBootCache()),
  );
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(false);

  const refresh = useCallback(async () => {
    setSettings(await loadAppSettings());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Schema upgrade stays on this path so later reads see a migrated DB.
        await ensureDefaultSettings();
        const next = await loadAppSettings();
        if (cancelled) return;
        setSettings(next);
        setDbReady(true);
        // Persist can hang in some browsers. Never block paint on it.
        void tryPersistStorage().then((ok) => {
          if (!cancelled) setPersisted(ok);
        });
      } catch (e) {
        if (cancelled) return;
        const oe = getOpenError();
        setError(
          oe?.message ||
            (e instanceof Error ? e.message : 'IndexedDB 不可用，无法启动应用'),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const language = normalizeLanguage(settings?.language);

  useEffect(() => {
    if (typeof document === 'undefined' || !settings.language) return;
    document.documentElement.lang = documentLangFor(settings.language);
  }, [settings.language]);

  const saveSetting = useCallback(
    async (key: string, value: unknown) => {
      await setSetting(key, value);
      if (key === 'language' && typeof value === 'string' && typeof document !== 'undefined') {
        document.documentElement.lang = documentLangFor(value);
      }
      await refresh();
    },
    [refresh],
  );

  const t = useCallback<TFunction>(
    (key, params) => translate(language, key, params),
    [language],
  );

  const value = useMemo(
    () => ({ settings, dbReady, error, persisted, language, refresh, saveSetting, t }),
    [settings, dbReady, error, persisted, language, refresh, saveSetting, t],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}

/** Settings + i18n from shared provider (language changes re-render the tree). */
export function useI18n(): { language: AppLanguage; t: TFunction; isEn: boolean } {
  const { language, t } = useAppData();
  return { language, t, isEn: language === 'en' };
}
