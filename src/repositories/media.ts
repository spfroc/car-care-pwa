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
    await (await getDB()).put('media', media);
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
  await (await getDB()).delete('media', id);
}

export async function listAllMedia(): Promise<Media[]> {
  return (await getDB()).getAll('media');
}
