import { useCallback, useEffect, useState } from 'react';
import { useSettings } from '../hooks/useAppData';
import { listOpenConflicts, listResolvedConflicts } from '../sync/conflictStore';
import type { SyncConflictRecord } from '../sync/conflictTypes';
import {
  requiresDeleteConfirm,
  resolveConflict,
  type ResolveChoice,
} from '../sync/conflictResolve';
import { ConflictDetail } from './ConflictDetail';

export function ConflictList({ onResolved }: { onResolved?: () => void }) {
  const { t } = useSettings();
  const [open, setOpen] = useState<SyncConflictRecord[]>([]);
  const [resolved, setResolved] = useState<SyncConflictRecord[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    setOpen(await listOpenConflicts());
    setResolved(await listResolvedConflicts(20));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onResolve(conflict: SyncConflictRecord, choice: ResolveChoice) {
    if (requiresDeleteConfirm(choice, conflict)) {
      const side =
        choice === 'keep_local' ? t('conflict.confirmDeleteLocal') : t('conflict.confirmDeleteCloud');
      if (!confirm(side)) return;
    } else {
      const label =
        choice === 'keep_local' ? t('conflict.keepLocal') : t('conflict.takeCloud');
      if (!confirm(t('conflict.confirmResolve', { action: label }))) return;
    }
    setBusyId(conflict.id);
    setMsg('');
    try {
      const r = await resolveConflict(conflict.id, choice);
      setMsg(r.message);
      await refresh();
      onResolved?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!open.length && !resolved.length) return null;

  return (
    <div className="conflict-list" style={{ marginTop: 12 }}>
      {open.length > 0 && (
        <>
          <p>
            <strong>{t('conflict.openTitle', { n: open.length })}</strong>
          </p>
          <p className="hint tiny">{t('conflict.openHint')}</p>
          <ul className="simple-list">
            {open.map((c) => (
              <li key={c.id} style={{ marginBottom: 12 }}>
                <ConflictDetail conflict={c} t={t} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId !== null}
                    onClick={() => void onResolve(c, 'keep_local')}
                  >
                    {t('conflict.keepLocal')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId !== null}
                    onClick={() => void onResolve(c, 'take_cloud')}
                  >
                    {t('conflict.takeCloud')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {resolved.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved
              ? t('conflict.hideResolved')
              : t('conflict.showResolved', { n: resolved.length })}
          </button>
          {showResolved && (
            <ul className="simple-list muted small">
              {resolved.map((c) => (
                <li key={c.id}>
                  {c.entity}/{c.entityId} → {c.resolution ?? '—'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {msg && <p className="toast">{msg}</p>}
    </div>
  );
}
