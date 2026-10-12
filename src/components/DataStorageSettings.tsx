import { useCallback, useEffect, useState } from 'react';
import { useSettings } from '../hooks/useAppData';
import {
  getCloudStorageConfig,
  setCloudStorageConfig,
} from '../sync/config';
import {
  bidirectionalSync,
  disconnectCloud,
  firstUploadToCloud,
  getSyncStatusSummary,
  resolveProvider,
  restoreFromCloud,
  verifyConnection,
} from '../sync/engine';
import { SupabaseProvider } from '../sync/providers/supabase';
import { listConflicts } from '../sync/outbox';
import type { CloudProviderId, CloudStorageConfig, SyncConflict } from '../sync/types';
import type { MessageKey } from '../i18n/messages';

export function DataStorageSettings() {
  const { t } = useSettings();
  const [cfg, setCfg] = useState<CloudStorageConfig>({ provider: 'none' });
  const [url, setUrl] = useState('');
  const [anon, setAnon] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [statusLine, setStatusLine] = useState('');
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [outboxCount, setOutboxCount] = useState(0);
  const [outboxReadyCount, setOutboxReadyCount] = useState(0);

  const refreshStatus = useCallback(async () => {
    const summary = await getSyncStatusSummary();
    setCfg(summary.config);
    setUrl(summary.config.supabaseUrl ?? '');
    setAnon(summary.config.supabaseAnonKey ?? '');
    setOutboxCount(summary.outboxCount);
    setOutboxReadyCount(summary.outboxReadyCount);
    setConflicts(await listConflicts());
    const m = summary.meta;
    const parts = [
      t('storage.statusLabel', { status: statusLabel(m.status, t) }),
      m.lastSuccessAt
        ? t('storage.lastSuccess', { time: formatLocal(m.lastSuccessAt) })
        : t('storage.neverSynced'),
      summary.outboxCount
        ? t('storage.outboxCount', { n: summary.outboxCount })
        : t('storage.outboxEmpty'),
    ];
    if (m.lastError) parts.push(t('storage.lastError', { error: m.lastError }));
    setStatusLine(parts.join(' · '));
  }, [t]);

  useEffect(() => {
    void (async () => {
      const c = await getCloudStorageConfig();
      setCfg(c);
      setUrl(c.supabaseUrl ?? '');
      setAnon(c.supabaseAnonKey ?? '');
      await refreshStatus();
    })();
  }, [refreshStatus]);

  async function saveProvider(provider: CloudProviderId) {
    setBusy(true);
    setMsg('');
    try {
      const next: CloudStorageConfig = {
        provider,
        supabaseUrl: url.trim() || undefined,
        supabaseAnonKey: anon.trim() || undefined,
      };
      await setCloudStorageConfig(next);
      setCfg(next);
      setMsg(t('storage.savedProvider'));
      await refreshStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    setBusy(true);
    setMsg('');
    try {
      await setCloudStorageConfig({
        provider: 'supabase',
        supabaseUrl: url.trim(),
        supabaseAnonKey: anon.trim(),
      });
      const provider = await resolveProvider();
      if (provider instanceof SupabaseProvider && email && password) {
        const auth = await provider.signIn(email, password, true);
        if (!auth.ok) {
          setMsg(auth.error ?? t('storage.authFailed'));
          await refreshStatus();
          return;
        }
      }
      const r = await verifyConnection();
      setMsg(r.message);
      await refreshStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    setMsg('');
    try {
      const r = await action();
      setMsg(r.message);
      await refreshStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{t('storage.title')}</h2>
      <p className="hint">{t('storage.hint')}</p>
      <p className="muted small">{statusLine}</p>

      <label>
        {t('storage.provider')}
        <select
          value={cfg.provider}
          disabled={busy}
          onChange={(e) => {
            const p = e.target.value as CloudProviderId;
            void saveProvider(p);
          }}
        >
          <option value="none">{t('storage.providerLocal')}</option>
          <option value="supabase">{t('storage.providerSupabase')}</option>
          <option value="notion">{t('storage.providerNotion')}</option>
        </select>
      </label>

      {cfg.provider === 'notion' && (
        <div className="muted small" style={{ marginTop: 8 }}>
          <p>{t('storage.notionStub')}</p>
          <p>{t('storage.notionDocs')}</p>
        </div>
      )}

      {cfg.provider === 'supabase' && (
        <>
          <p className="muted small">{t('storage.supabaseSetup')}</p>
          <label>
            {t('storage.supabaseUrl')}
            <input
              value={url}
              disabled={busy}
              placeholder="https://xxxx.supabase.co"
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            {t('storage.supabaseAnon')}
            <input
              value={anon}
              disabled={busy}
              placeholder="eyJhbGciOi…"
              onChange={(e) => setAnon(e.target.value)}
              autoComplete="off"
            />
          </label>
          <p className="hint tiny">{t('storage.anonOnly')}</p>
          <label>
            {t('storage.email')}
            <input
              type="email"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            {t('storage.password')}
            <input
              type="password"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="button" className="btn block" disabled={busy} onClick={() => void onVerify()}>
            {t('storage.verify')}
          </button>
          <button
            type="button"
            className="btn block"
            disabled={busy}
            onClick={() => {
              if (!confirm(t('storage.firstUploadConfirm'))) return;
              void run(firstUploadToCloud);
            }}
          >
            {t('storage.firstUpload')}
          </button>
          <button
            type="button"
            className="btn block"
            disabled={busy}
            onClick={() => {
              if (!confirm(t('storage.restoreConfirm'))) return;
              void run(() => restoreFromCloud({ replaceLocal: false }));
            }}
          >
            {t('storage.restore')}
          </button>
          <button
            type="button"
            className="btn danger block"
            disabled={busy}
            onClick={() => {
              if (!confirm(t('storage.restoreReplaceConfirm1'))) return;
              if (!confirm(t('storage.restoreReplaceConfirm2'))) return;
              void run(() => restoreFromCloud({ replaceLocal: true }));
            }}
          >
            {t('storage.restoreReplace')}
          </button>
          <button
            type="button"
            className="btn primary block"
            disabled={busy}
            onClick={() => void run(bidirectionalSync)}
          >
            {t('storage.bidirectional')}
          </button>
          <button
            type="button"
            className="btn ghost block"
            disabled={busy}
            onClick={() => {
              if (!confirm(t('storage.disconnectConfirm'))) return;
              void run(disconnectCloud);
            }}
          >
            {t('storage.disconnect')}
          </button>
          {outboxCount > 0 && outboxReadyCount >= 0 && (
            <button
              type="button"
              className="btn block"
              disabled={busy}
              onClick={() => void run(bidirectionalSync)}
            >
              {t('storage.retryOutbox')}
            </button>
          )}
        </>
      )}

      {cfg.provider === 'none' && (
        <p className="muted small">{t('storage.localOnly')}</p>
      )}

      {conflicts.length > 0 && (
        <div className="muted small" style={{ marginTop: 10 }}>
          <p>
            <strong>{t('storage.conflicts', { n: conflicts.length })}</strong>
          </p>
          <ul className="simple-list">
            {conflicts.slice(-5).map((c) => (
              <li key={c.id}>
                {c.entity}/{c.entityId} → {c.resolution}
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && <p className="toast">{msg}</p>}
    </section>
  );
}

function statusLabel(
  status: string,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  switch (status) {
    case 'idle':
      return t('storage.statusIdle');
    case 'syncing':
      return t('storage.statusSyncing');
    case 'offline':
      return t('storage.statusOffline');
    case 'error':
      return t('storage.statusError');
    case 'disconnected':
    default:
      return t('storage.statusDisconnected');
  }
}

function formatLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
