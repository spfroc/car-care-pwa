import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
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
  settings: AppSettings | null;
  language: AppLanguage;
  refresh: () => Promise<void>;
  saveSetting: (key: string, value: unknown) => Promise<void>;
  t: TFunction;
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const refresh = useCallback(async () => {
    setSettings(await loadAppSettings());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const language = normalizeLanguage(settings?.language);

  useEffect(() => {
    if (settings?.language) {
      document.documentElement.lang = documentLangFor(settings.language);
    }
  }, [settings?.language]);

  const saveSetting = useCallback(
    async (key: string, value: unknown) => {
      await setSetting(key, value);
      if (key === 'language' && typeof value === 'string') {
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
    () => ({ settings, language, refresh, saveSetting, t }),
    [settings, language, refresh, saveSetting, t],
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
