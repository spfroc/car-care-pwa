import { useCallback, useEffect, useState } from 'react';
import { useSettings } from '../hooks/useAppData';
import {
  getCloudStorageConfig,
  setCloudStorageConfig,
} from '../sync/config';
import {
  bidirectionalSync,
  claimLegacyOutboxOwner,
  disconnectCloud,
  discardOrphanOutboxOwner,
  firstUploadToCloud,
  getSyncStatusSummary,
  resolveProvider,
  restoreFromCloud,
  verifyConnection,
} from '../sync/engine';
import { SupabaseProvider } from '../sync/providers/supabase';
import { listConflicts } from '../sync/outbox';
import { ConflictList } from './ConflictList';
import {
  clearNotionRuntimeSession,
  getNotionRuntimeSession,
  hasValidNotionRuntimeSession,
  setNotionSessionBearer,
} from '../sync/notionSession';
import type { CloudProviderId, CloudStorageConfig, SyncConflict } from '../sync/types';
import type { MessageKey } from '../i18n/messages';

export function DataStorageSettings() {
  const { t } = useSettings();
  const [cfg, setCfg] = useState<CloudStorageConfig>({ provider: 'none' });
  const [url, setUrl] = useState('');
  const [anon, setAnon] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [notionHint, setNotionHint] = useState('');
  const [notionApiKey, setNotionApiKey] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionWorkspace, setSessionWorkspace] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [statusLine, setStatusLine] = useState('');
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [outboxCount, setOutboxCount] = useState(0);
  const [outboxReadyCount, setOutboxReadyCount] = useState(0);
  const [openConflictCount, setOpenConflictCount] = useState(0);
  const [orphanOutboxCount, setOrphanOutboxCount] = useState(0);
  const [orphanOwners, setOrphanOwners] = useState<
    Array<{
      ownerUserId: string;
      count: number;
      notionTargetId?: string;
      gatewayKeyFp?: string;
      kind?: string;
    }>
  >([]);
  const [legacyOutboxCount, setLegacyOutboxCount] = useState(0);
  const [sessionGatewayFp, setSessionGatewayFp] = useState('');

  const refreshSessionUi = useCallback(() => {
    const s = getNotionRuntimeSession();
    const valid = hasValidNotionRuntimeSession();
    setSessionReady(valid);
    setSessionWorkspace(valid ? (s?.workspaceKey ?? '') : '');
    setSessionGatewayFp(valid ? (s?.gatewayKeyFp ?? '') : '');
    // Do not echo bearer into controlled input after hydrate — keep field empty unless user is typing
    if (!s?.bearer) setNotionApiKey('');
  }, []);

  const refreshStatus = useCallback(async () => {
    const summary = await getSyncStatusSummary();
    setCfg(summary.config);
    setUrl(summary.config.supabaseUrl ?? '');
    setAnon(summary.config.supabaseAnonKey ?? '');
    setGatewayUrl(summary.config.notionGatewayUrl ?? '');
    setNotionHint(summary.config.notionWorkspaceHint ?? '');
    setOutboxCount(summary.outboxCount);
    setOutboxReadyCount(summary.outboxReadyCount);
    setOpenConflictCount(summary.openConflictCount ?? 0);
    setOrphanOutboxCount(summary.orphanOutboxCount ?? 0);
    setOrphanOwners(summary.orphanOwners ?? []);
    setLegacyOutboxCount(summary.legacyOutboxCount ?? 0);
    setConflicts(await listConflicts());
    refreshSessionUi();
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
  }, [t, refreshSessionUi]);

  useEffect(() => {
    void (async () => {
      const c = await getCloudStorageConfig();
      setCfg(c);
      setUrl(c.supabaseUrl ?? '');
      setAnon(c.supabaseAnonKey ?? '');
      setGatewayUrl(c.notionGatewayUrl ?? '');
      setNotionHint(c.notionWorkspaceHint ?? '');
      await refreshStatus();
    })();
  }, [refreshStatus]);

  async function saveProvider(provider: CloudProviderId) {
    setBusy(true);
    setMsg('');
    try {
      // D2.7: single `provider` — never enable supabase+notion together.
      // Preserve inactive side’s non-secret URL fields for easier switch-back.
      if (provider !== 'notion') {
        clearNotionRuntimeSession();
        setNotionApiKey('');
      }
      const next: CloudStorageConfig = {
        provider,
        supabaseUrl: (provider === 'supabase' ? url.trim() : cfg.supabaseUrl) || undefined,
        supabaseAnonKey:
          (provider === 'supabase' ? anon.trim() : cfg.supabaseAnonKey) || undefined,
        notionGatewayUrl:
          (provider === 'notion' ? gatewayUrl.trim() : cfg.notionGatewayUrl) || undefined,
        notionWorkspaceHint:
          (provider === 'notion' ? notionHint.trim() : cfg.notionWorkspaceHint) ||
          undefined,
        workspaceKey: cfg.workspaceKey,
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

  async function saveNotionUrl() {
    setBusy(true);
    setMsg('');
    try {
      const next: CloudStorageConfig = {
        provider: 'notion',
        supabaseUrl: cfg.supabaseUrl,
        supabaseAnonKey: cfg.supabaseAnonKey,
        notionGatewayUrl: gatewayUrl.trim() || undefined,
        notionWorkspaceHint: notionHint.trim() || undefined,
        workspaceKey: cfg.workspaceKey,
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
        notionGatewayUrl: cfg.notionGatewayUrl,
        notionWorkspaceHint: cfg.notionWorkspaceHint,
        workspaceKey: cfg.workspaceKey,
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

  async function onVerifyNotion() {
    setBusy(true);
    setMsg('');
    try {
      const key = notionApiKey.trim();
      const gw = gatewayUrl.trim();
      if (!gw || !key) {
        setMsg(t('storage.notionVerifyNeedKey'));
        return;
      }
      await setCloudStorageConfig({
        provider: 'notion',
        supabaseUrl: cfg.supabaseUrl,
        supabaseAnonKey: cfg.supabaseAnonKey,
        notionGatewayUrl: gw,
        notionWorkspaceHint: notionHint.trim() || undefined,
        workspaceKey: cfg.workspaceKey,
      });
      // Bearer in memory (optional sessionStorage) before /verify; workspaceKey filled on success
      setNotionSessionBearer(key);
      const r = await verifyConnection();
      if (r.ok && r.verify?.userId) {
        await setCloudStorageConfig({
          provider: 'notion',
          supabaseUrl: cfg.supabaseUrl,
          supabaseAnonKey: cfg.supabaseAnonKey,
          notionGatewayUrl: gw,
          notionWorkspaceHint: notionHint.trim() || undefined,
          workspaceKey: r.verify.userId,
        });
        // Clear the visible key field after successful bind — session holds bearer
        setNotionApiKey('');
      } else if (!r.ok) {
        // 401 path clears session inside gateway client; keep input so user can retry
      }
      setMsg(r.message);
      await refreshStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onClearNotionSession() {
    clearNotionRuntimeSession();
    setNotionApiKey('');
    refreshSessionUi();
    setMsg(t('storage.notionSessionMissing'));
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
        <div style={{ marginTop: 8 }}>
          <p className="hint">{t('storage.notionExperimental')}</p>
          <p className="muted small">{t('storage.notionMutualExclusion')}</p>
          <p className="muted small">{t('storage.notionMediaNotice')}</p>
          <p className="muted small">{t('storage.notionDocs')}</p>

          <label>
            {t('storage.notionGatewayUrl')}
            <input
              value={gatewayUrl}
              disabled={busy}
              placeholder="https://your-worker.example.workers.dev"
              onChange={(e) => setGatewayUrl(e.target.value)}
              autoComplete="off"
            />
          </label>
          <p className="hint tiny">{t('storage.notionGatewayUrlHint')}</p>

          <label>
            {t('storage.notionWorkspaceHint')}
            <input
              value={notionHint}
              disabled={busy}
              onChange={(e) => setNotionHint(e.target.value)}
              autoComplete="off"
            />
          </label>

          <button
            type="button"
            className="btn block"
            disabled={busy}
            onClick={() => void saveNotionUrl()}
          >
            {t('storage.notionSaveUrl')}
          </button>

          <label>
            {t('storage.notionApiKey')}
            <input
              type="password"
              value={notionApiKey}
              disabled={busy}
              placeholder="Gateway API Key"
              onChange={(e) => setNotionApiKey(e.target.value)}
              autoComplete="off"
            />
          </label>
          <p className="hint tiny">{t('storage.notionApiKeyHint')}</p>
          <p className="muted small">
            {sessionReady
              ? t('storage.notionSessionActive', { key: sessionWorkspace })
              : t('storage.notionSessionMissing')}
          </p>
          <p className="hint tiny">{t('storage.notionOriginHint')}</p>

          <button
            type="button"
            className="btn block"
            disabled={busy}
            onClick={() => void onVerifyNotion()}
          >
            {t('storage.verify')}
          </button>
          <button
            type="button"
            className="btn ghost block"
            disabled={busy}
            onClick={onClearNotionSession}
          >
            {t('storage.notionClearSession')}
          </button>
          <button
            type="button"
            className="btn primary block"
            disabled={busy || !sessionReady}
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
              disabled={busy || !sessionReady}
              onClick={() => void run(bidirectionalSync)}
            >
              {t('storage.retryOutbox')}
            </button>
          )}

          {sessionReady && sessionGatewayFp ? (
            <p className="muted small">
              {t('storage.notionGatewayFp', { fp: sessionGatewayFp })}
            </p>
          ) : null}

          {legacyOutboxCount > 0 && sessionReady && sessionGatewayFp ? (
            <div className="legacy-claim-panel" style={{ marginTop: 12 }}>
              <p className="hint">{t('storage.legacyClaimTitle')}</p>
              <p className="muted small">{t('storage.legacyClaimHint')}</p>
              <p className="muted small">
                {t('storage.legacyClaimCount', { n: legacyOutboxCount })}
              </p>
              <button
                type="button"
                className="btn block"
                disabled={busy}
                onClick={() => {
                  if (!confirm(t('storage.legacyClaimConfirm1'))) return;
                  if (!confirm(t('storage.legacyClaimConfirm2'))) return;
                  void run(() => claimLegacyOutboxOwner({ confirmToken: 'CLAIM' }));
                }}
              >
                {t('storage.legacyClaimButton')}
              </button>
            </div>
          ) : null}

          <div className="orphan-outbox-panel" style={{ marginTop: 12 }}>
            <p className="hint">{t('storage.orphanOutboxTitle')}</p>
            <p className="muted small">{t('storage.orphanOutboxHint')}</p>
            <p className="muted small">{t('storage.disconnectRetainNote')}</p>
            {orphanOutboxCount === 0 ? (
              <p className="muted small">{t('storage.orphanOutboxEmpty')}</p>
            ) : (
              <ul className="small" style={{ paddingLeft: 18 }}>
                {orphanOwners.map((o) => {
                  const rowKey = o.notionTargetId ?? `${o.kind ?? 'wk'}:${o.ownerUserId}`;
                  let label: string;
                  if (o.kind === 'same_workspace_diff_gateway') {
                    label = t('storage.orphanOutboxRowDiffGw', {
                      fp: (o.gatewayKeyFp ?? o.notionTargetId ?? '').slice(0, 8),
                      n: o.count,
                    });
                  } else if (o.kind === 'legacy_no_fp') {
                    label = t('storage.orphanOutboxRowLegacy', {
                      key: o.ownerUserId.slice(0, 8),
                      n: o.count,
                    });
                  } else if (o.kind === 'cross_workspace') {
                    label = t('storage.orphanOutboxRowCrossWk', {
                      key: o.ownerUserId.slice(0, 8),
                      n: o.count,
                    });
                  } else {
                    label = t('storage.orphanOutboxRow', {
                      key: o.ownerUserId.slice(0, 8),
                      n: o.count,
                    });
                  }
                  return (
                    <li key={rowKey} style={{ marginBottom: 8 }}>
                      {label}
                      <button
                        type="button"
                        className="btn danger"
                        style={{ marginLeft: 8 }}
                        disabled={busy}
                        onClick={() => {
                          if (!confirm(t('storage.orphanDiscardConfirm'))) return;
                          void run(() =>
                            discardOrphanOutboxOwner({
                              ownerUserId: o.ownerUserId,
                              notionTargetId: o.notionTargetId,
                              confirmToken: 'DISCARD',
                            }),
                          );
                        }}
                      >
                        {t('storage.orphanDiscard')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {cfg.provider === 'supabase' && (
        <>
          <p className="muted small">{t('storage.supabaseSetup')}</p>
          <p className="muted small">{t('storage.notionMutualExclusion')}</p>
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

      <ConflictList onResolved={() => void refreshStatus()} />

      {openConflictCount > 0 && (
        <p className="muted small" style={{ marginTop: 6 }}>
          <strong>{t('conflict.badge', { n: openConflictCount })}</strong>
        </p>
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

