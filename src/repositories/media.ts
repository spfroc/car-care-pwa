import { getDB, isQuotaError } from '../db';
import type { Media } from '../types';
import { compressImage } from '../lib/image';
import { nowISO, uid } from '../lib/constants';
import {
  isCloudEnqueueEnabled,
  makeOutboxItem,
  putOutboxInTx,
  settleTx,
} from '../sync/outbox';

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
    const sync = await isCloudEnqueueEnabled();
    const stores = sync ? (['media', 'sync_outbox'] as const) : (['media'] as const);
    const tx = db.transaction(stores, 'readwrite');
    await settleTx(tx, async () => {
      await tx.objectStore('media').put(media);
      if (sync) {
        await putOutboxInTx(
          tx,
          makeOutboxItem({
            entity: 'media',
            entityId: media.id,
            op: 'upsert',
            mutatedAt: media.createdAt,
          }),
        );
      }
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
  const db = await getDB();
  const sync = await isCloudEnqueueEnabled();
  const stores = sync ? (['media', 'sync_outbox'] as const) : (['media'] as const);
  const tx = db.transaction(stores, 'readwrite');
  await settleTx(tx, async () => {
    await tx.objectStore('media').delete(id);
    if (sync) {
      await putOutboxInTx(
        tx,
        makeOutboxItem({
          entity: 'media',
          entityId: id,
          op: 'delete',
          mutatedAt: nowISO(),
        }),
      );
    }
  });
}

export async function listAllMedia(): Promise<Media[]> {
  return (await getDB()).getAll('media');
}
