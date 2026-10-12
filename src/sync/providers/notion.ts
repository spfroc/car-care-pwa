import type { CloudProvider } from './types';
import type { CloudRow, CloudSnapshot, PushResult, SyncOutboxItem, VerifyResult } from '../types';

export class NotionNotImplementedError extends Error {
  constructor(message = 'Notion sync is not implemented yet. See docs/notion-sync-feasibility.md') {
    super(message);
    this.name = 'NotionNotImplementedError';
  }
}

/** Stub provider — no network, no secrets. */
export class NotionProvider implements CloudProvider {
  readonly id = 'notion' as const;

  async verify(): Promise<VerifyResult> {
    return {
      ok: false,
      error: 'Notion 同步尚未开放。请先使用自有 Supabase，或阅读 docs/notion-sync-feasibility.md',
    };
  }

  async pullAll(): Promise<CloudSnapshot> {
    throw new NotionNotImplementedError();
  }

  async pushOps(_ops: SyncOutboxItem[]): Promise<PushResult> {
    throw new NotionNotImplementedError();
  }

  async pushSnapshot(_rows: CloudRow[]): Promise<PushResult> {
    throw new NotionNotImplementedError();
  }
}
