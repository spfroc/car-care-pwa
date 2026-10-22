import { usePwaUpdate } from '../hooks/usePwaUpdate';
import { useI18n } from '../i18n';

/** Prompt when a new Service Worker is waiting — user must confirm before reload. */
export function PwaUpdateBanner() {
  const { t } = useI18n();
  const { needRefresh, updating, updateNow, dismiss } = usePwaUpdate();

  if (!needRefresh) return null;

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-banner-text">{t('pwa.updateAvailable')}</div>
      <div className="update-banner-actions">
        <button
          type="button"
          className="btn primary tiny"
          disabled={updating}
          onClick={() => void updateNow()}
        >
          {updating ? t('pwa.updateBusy') : t('pwa.updateNow')}
        </button>
        <button type="button" className="btn ghost tiny" disabled={updating} onClick={dismiss}>
          {t('pwa.updateLater')}
        </button>
      </div>
    </div>
  );
}
