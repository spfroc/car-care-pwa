import type { SyncConflictRecord } from '../sync/conflictTypes';
import { summarizeConflictSide } from '../sync/conflictResolve';
import type { MessageKey } from '../i18n/messages';

type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;

export function ConflictDetail({
  conflict,
  t,
}: {
  conflict: SyncConflictRecord;
  t: TFn;
}) {
  const kindLabel =
    conflict.kind === 'edit_vs_delete'
      ? t('conflict.kindEditVsDelete')
      : conflict.kind === 'push_rejected'
        ? t('conflict.kindPushRejected')
        : t('conflict.kindEditEdit');
  const entityLabel =
    conflict.entity === 'vehicles' ? t('conflict.entityVehicle') : t('conflict.entityRecord');

  return (
    <div className="conflict-detail muted small">
      <p>
        <strong>
          {entityLabel} · {kindLabel}
        </strong>
      </p>
      <p>
        {t('conflict.localSide')}:{' '}
        {summarizeConflictSide(conflict.entity, conflict.localSnapshot, conflict.localUpdatedAt)}
      </p>
      <p>
        {t('conflict.cloudSide')}:{' '}
        {summarizeConflictSide(conflict.entity, conflict.cloudSnapshot, conflict.cloudUpdatedAt)}
      </p>
    </div>
  );
}
