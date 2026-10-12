import { base64ToBlob, blobToBase64 } from '../lib/image';
import type { Media } from '../types';
import type { CloudMediaPayload } from './types';

export async function mediaToCloudPayload(m: Media): Promise<CloudMediaPayload> {
  return {
    id: m.id,
    mimeType: m.mimeType,
    byteSize: m.byteSize,
    width: m.width,
    height: m.height,
    createdAt: m.createdAt,
    base64: await blobToBase64(m.blob),
  };
}

export function cloudPayloadToMedia(p: CloudMediaPayload): Media {
  return {
    id: p.id,
    mimeType: p.mimeType,
    byteSize: p.byteSize,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt,
    blob: base64ToBlob(p.base64, p.mimeType),
  };
}
