import { getDB, isQuotaError } from '../db';
import type { Media } from '../types';
import { compressImage } from '../lib/image';
import { nowISO, uid } from '../lib/constants';

export async function putMediaFromFile(file: File): Promise<Media> {
  try {
    const { blob, width, height } = await compressImage(file);
    const media: Media = {
      id: uid(),
      mimeType: 'image/jpeg',
      byteSize: blob.size,
      width,
      height,
      blob,
      createdAt: nowISO(),
    };
    const db = await getDB();
    const { isCloudEnqueueEnabled, makeOutboxItem, putOutboxInTx, settleTx, stampOutboxOwner } =
      await import('../sync/outbox');
    const sync = await isCloudEnqueueEnabled('media');
    const outboxItem = sync
      ? await stampOutboxOwner(
          makeOutboxItem({
            entity: 'media',
            entityId: media.id,
            op: 'upsert',
            mutatedAt: media.createdAt,
          }),
        )
      : null;
    const stores = sync ? (['media', 'sync_outbox'] as const) : (['media'] as const);
    const tx = db.transaction(stores, 'readwrite');
    await settleTx(tx, async () => {
      await tx.objectStore('media').put(media);
      if (outboxItem) await putOutboxInTx(tx, outboxItem);
    });
    return media;
  } catch (e) {
    if (isQuotaError(e)) throw new Error('存储空间不足，无法保存图片。请导出备份或删除旧图片后重试。');
    throw e;
  }
}

export async function getMedia(id: string): Promise<Media | undefined> {
  return (await getDB()).get('media', id);
}

export async function deleteMedia(id: string): Promise<void> {
  const { isCloudEnqueueEnabled, makeOutboxItem, putOutboxInTx, settleTx, stampOutboxOwner } =
    await import('../sync/outbox');
  const db = await getDB();
  const sync = await isCloudEnqueueEnabled('media');
  const outboxItem = sync
    ? await stampOutboxOwner(
        makeOutboxItem({
          entity: 'media',
          entityId: id,
          op: 'delete',
          mutatedAt: nowISO(),
        }),
      )
    : null;
  const stores = sync ? (['media', 'sync_outbox'] as const) : (['media'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    await tx.objectStore('media').delete(id);
    if (outboxItem) await putOutboxInTx(tx, outboxItem);
  });
}

export async function listAllMedia(): Promise<Media[]> {
  return (await getDB()).getAll('media');
}
