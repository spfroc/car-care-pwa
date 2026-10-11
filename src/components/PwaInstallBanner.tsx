import { useCallback, useState } from 'react';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useI18n } from '../i18n';

const PERSIST_DISMISS_KEY = 'car-care-pwa-persist-dismissed';

function GuideBody({ platform }: { platform: string }) {
  const { t } = useI18n();
  if (platform === 'ios') {
    return (
      <ol className="install-steps">
        <li>{t('pwa.ios1')}</li>
        <li>{t('pwa.ios2')}</li>
        <li>{t('pwa.ios3')}</li>
      </ol>
    );
  }
  if (platform === 'android') {
    return (
      <ol className="install-steps">
        <li>{t('pwa.android1')}</li>
        <li>{t('pwa.android2')}</li>
        <li>{t('pwa.android3')}</li>
        <li>{t('pwa.android4')}</li>
      </ol>
    );
  }
  return (
    <ol className="install-steps">
      <li>{t('pwa.desktop1')}</li>
      <li>{t('pwa.desktop2')}</li>
    </ol>
  );
}

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* ignore */
  }
}

/** Compact, dismissible strip for storage persist warning + PWA install (single first-screen bar). */
export function PwaInstallBanner({ persisted }: { persisted: boolean }) {
  const { t } = useI18n();
  const {
    platform,
    standalone,
    canNativePrompt,
    showInstallHint,
    installedToast,
    dismissBanner,
    dismissToast,
    promptInstall,
  } = usePwaInstall();
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [persistDismissed, setPersistDismissed] = useState(() =>
    readDismissed(PERSIST_DISMISS_KEY),
  );

  const showPersist = !persisted && !persistDismissed;
  const showInstall = showInstallHint && !standalone;
  const showStrip = showPersist || showInstall;

  const dismissPersist = useCallback(() => {
    setPersistDismissed(true);
    writeDismissed(PERSIST_DISMISS_KEY);
  }, []);

  const dismissStrip = useCallback(() => {
    if (showPersist) dismissPersist();
    if (showInstall) dismissBanner();
  }, [showPersist, showInstall, dismissPersist, dismissBanner]);

  return (
    <>
      {installedToast && (
        <div className="install-toast" role="status">
          <span>{t('pwa.installedToast')}</span>
          <button type="button" className="btn ghost tiny" onClick={dismissToast}>
            {t('common.gotIt')}
          </button>
        </div>
      )}

      {showStrip && (
        <div className="app-hints" role="status">
          <div className="app-hints-text">
            {showPersist && showInstall ? (
              <span>{t('pwa.persistAndInstall')}</span>
            ) : showPersist ? (
              <span>{t('pwa.persistOnly')}</span>
            ) : (
              <span>{t('pwa.installOnly')}</span>
            )}
          </div>
          <div className="app-hints-actions">
            {showInstall && canNativePrompt && (
              <button
                type="button"
                className="btn primary tiny"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await promptInstall();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('pwa.install')}
              </button>
            )}
            {showInstall && (
              <button type="button" className="btn tiny" onClick={() => setGuideOpen(true)}>
                {t('pwa.howTo')}
              </button>
            )}
            <button
              type="button"
              className="btn ghost tiny"
              onClick={dismissStrip}
              aria-label={t('pwa.closeHint')}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {guideOpen && (
        <div className="install-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('pwa.guideTitle')}>
          <div className="install-modal card">
            <header className="page-header" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{t('pwa.guideTitle')}</h2>
              <button type="button" className="btn ghost tiny" onClick={() => setGuideOpen(false)}>
                {t('common.close')}
              </button>
            </header>
            <p className="muted small">{t('pwa.guideIntro')}</p>
            <GuideBody platform={platform} />
            {canNativePrompt && (
              <button
                type="button"
                className="btn primary block"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await promptInstall();
                    setGuideOpen(false);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('pwa.nativePrompt')}
              </button>
            )}
            <p className="muted small" style={{ marginTop: 12 }}>
              {t('pwa.guideDocs')}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
