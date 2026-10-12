import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nowISO } from '../../lib/constants';
import type { CloudProvider } from './types';
import type {
  CloudRow,
  CloudSnapshot,
  PushResult,
  SyncOutboxItem,
  VerifyResult,
} from '../types';
import { MEDIA_BUCKET } from '../types';
import type { MediaObjectStore, MediaObjectBytes } from '../mediaStorage';

type DbRow = {
  user_id: string;
  entity: string;
  id: string;
  payload: unknown;
  updated_at: string;
  deleted_at: string | null;
  device_id: string | null;
};

/** Default PostgREST max-rows; we page explicitly. */
export const SUPABASE_PULL_PAGE_SIZE = 1000;

export class SupabaseProvider implements CloudProvider {
  readonly id = 'supabase' as const;
  private client: SupabaseClient;
  private deviceId: string;
  /** Test hook: override page size */
  pageSize = SUPABASE_PULL_PAGE_SIZE;

  constructor(opts: { url: string; anonKey: string; deviceId: string; client?: SupabaseClient }) {
    if (/service_role/i.test(opts.anonKey)) {
      throw new Error('Refusing to initialize Supabase client with a service_role key');
    }
    if (opts.anonKey && !opts.anonKey.includes('.') && opts.anonKey.length > 40) {
      throw new Error('anon key 格式异常：请粘贴 Project Settings → API → anon public key');
    }
    this.deviceId = opts.deviceId;
    this.client =
      opts.client ??
      createClient(opts.url, opts.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: `car-care-sb-${hashUrl(opts.url)}`,
        },
      });
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  async signIn(email: string, password: string, allowSignUp = true): Promise<VerifyResult> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      return { ok: true, userId: data.user.id, email: data.user.email ?? email };
    }
    if (allowSignUp) {
      const signed = await this.client.auth.signUp({ email, password });
      if (signed.error) return { ok: false, error: signed.error.message };
      if (signed.data.user) {
        return {
          ok: true,
          userId: signed.data.user.id,
          email: signed.data.user.email ?? email,
        };
      }
    }
    return { ok: false, error: error?.message ?? '登录失败' };
  }

  async verify(): Promise<VerifyResult> {
    const { data: userData, error: userError } = await this.client.auth.getUser();
    if (userError) return { ok: false, error: userError.message };
    const user = userData.user;
    if (!user) return { ok: false, error: '未登录：请先使用邮箱密码登录你的 Supabase 项目' };

    const { count, error } = await this.client
      .from('car_care_rows')
      .select('id', { count: 'exact', head: true });

    if (error) {
      return {
        ok: false,
        userId: user.id,
        email: user.email,
        error: `表探测失败：${error.message}。请确认已执行 docs/sql/supabase-car-care-rows.sql 且 RLS 策略存在。`,
      };
    }
    return {
      ok: true,
      userId: user.id,
      email: user.email,
      cloudRowCount: count ?? 0,
    };
  }

  async pullAll(): Promise<CloudSnapshot> {
    const user = await this.requireUser();
    const rows: CloudRow[] = [];
    let from = 0;
    const pageSize = this.pageSize;
    for (;;) {
      const to = from + pageSize - 1;
      const { data, error } = await this.client
        .from('car_care_rows')
        .select('entity,id,payload,updated_at,deleted_at,device_id')
        .eq('user_id', user.id)
        .order('entity', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      const batch = (data as DbRow[] | null) ?? [];
      for (const r of batch) rows.push(dbToCloud(r));
      if (batch.length < pageSize) break;
      from += pageSize;
    }
    return { rows, pulledAt: nowISO() };
  }

  /**
   * Push via DB-side atomic LWW RPC (no client read-then-write TOCTOU).
   * skipped_cloud_newer goes to conflicts only — NOT applied (so outbox/concurrent ops stay safe).
   */
  async pushOps(ops: SyncOutboxItem[]): Promise<PushResult> {
    await this.requireUser();
    const applied: string[] = [];
    const conflicts: PushResult['conflicts'] = [];

    for (const op of ops) {
      try {
        const deletedAt = op.op === 'delete' ? op.mutatedAt : null;
        const { data, error } = await this.client.rpc('car_care_upsert_lww', {
          p_entity: op.entity,
          p_id: op.entityId,
          p_payload: op.payload ?? {},
          p_updated_at: op.mutatedAt,
          p_deleted_at: deletedAt,
          p_device_id: this.deviceId,
        });
        if (error) {
          if (
            /function .*car_care_upsert_lww.* does not exist/i.test(error.message) ||
            error.code === 'PGRST202'
          ) {
            return {
              applied,
              conflicts,
              error: `缺少 car_care_upsert_lww RPC：请重新执行 docs/sql/supabase-car-care-rows.sql（${error.message}）`,
            };
          }
          throw error;
        }
        const result = typeof data === 'string' ? data : String(data);
        if (result === 'skipped_cloud_newer') {
          conflicts.push({
            opId: op.opId,
            reason: 'cloud_newer',
            entity: op.entity,
            entityId: op.entityId,
            attemptedAt: op.mutatedAt,
          });
        } else {
          applied.push(op.opId);
        }
      } catch (e) {
        return {
          applied,
          conflicts,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
    return { applied, conflicts };
  }

  /**
   * First upload / snapshot: DB-side LWW per row (never unconditional overwrite of cloud-newer).
   * applied keys are `entity:id` for ackOutboxCoveredByUpload.
   */
  async pushSnapshot(rows: CloudRow[]): Promise<PushResult> {
    const ops: SyncOutboxItem[] = rows.map((r) => ({
      opId: `${r.entity}:${r.id}`,
      entity: r.entity,
      entityId: r.id,
      op: r.deletedAt ? 'delete' : 'upsert',
      payload: r.payload,
      mutatedAt: r.updatedAt,
      attempts: 0,
      nextRetryAt: r.updatedAt,
    }));
    // Chunk to avoid huge single RPC storms
    const chunkSize = 50;
    const applied: string[] = [];
    const conflicts: PushResult['conflicts'] = [];
    for (let i = 0; i < ops.length; i += chunkSize) {
      const chunk = ops.slice(i, i + chunkSize);
      const one = await this.pushOps(chunk);
      applied.push(...one.applied);
      conflicts.push(...one.conflicts);
      if (one.error) {
        return { applied, conflicts, error: one.error };
      }
    }
    return { applied, conflicts };
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  getMediaObjectStore(): MediaObjectStore {
    return new SupabaseMediaObjectStore(this.client);
  }

  async getAuthUserId(): Promise<string | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) return null;
    return data.user.id;
  }

  private async requireUser() {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) throw new Error(error?.message ?? '未登录');
    return data.user;
  }
}

function dbToCloud(r: DbRow): CloudRow {
  return {
    entity: r.entity as CloudRow['entity'],
    id: r.id,
    payload: r.payload,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    deviceId: r.device_id,
  };
}

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}


export class SupabaseMediaObjectStore implements MediaObjectStore {
  private client: SupabaseClient;
  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async uploadMediaObject(opts: {
    storageKey: string;
    body: MediaObjectBytes;
    contentType: string;
  }): Promise<void> {
    const { error } = await this.client.storage.from(MEDIA_BUCKET).upload(opts.storageKey, opts.body, {
      upsert: true,
      contentType: opts.contentType,
      cacheControl: '3600',
    });
    if (error) throw new Error(`storage upload: ${error.message}`);
  }

  async downloadMediaObject(storageKey: string): Promise<Blob> {
    const { data, error } = await this.client.storage.from(MEDIA_BUCKET).download(storageKey);
    if (error || !data) throw new Error(`storage download: ${error?.message ?? 'empty'}`);
    return data;
  }

  async removeMediaObject(storageKey: string): Promise<void> {
    const { error } = await this.client.storage.from(MEDIA_BUCKET).remove([storageKey]);
    if (error) throw new Error(`storage remove: ${error.message}`);
  }

  async listMediaObjectKeys(userId: string): Promise<string[]> {
    const keys: string[] = [];
    // List media_id folders under userId/
    const { data: folders, error: folderErr } = await this.client.storage
      .from(MEDIA_BUCKET)
      .list(userId, { limit: 1000 });
    if (folderErr) throw new Error(`storage list: ${folderErr.message}`);
    for (const entry of folders ?? []) {
      if (!entry.name) continue;
      // Each entry may be a media_id "folder"
      const prefix = `${userId}/${entry.name}`;
      const { data: files, error: fileErr } = await this.client.storage
        .from(MEDIA_BUCKET)
        .list(prefix, { limit: 100 });
      if (fileErr) continue;
      for (const f of files ?? []) {
        if (f.name) keys.push(`${prefix}/${f.name}`);
      }
    }
    return keys;
  }

  async headMediaObject(storageKey: string): Promise<{ exists: boolean; byteSize?: number }> {
    const parts = storageKey.split('/');
    if (parts.length < 3) return { exists: false };
    const folder = parts.slice(0, -1).join('/');
    const fileName = parts[parts.length - 1];
    const { data, error } = await this.client.storage.from(MEDIA_BUCKET).list(folder, {
      search: fileName,
      limit: 10,
    });
    if (error) return { exists: false };
    const hit = (data ?? []).find((f) => f.name === fileName);
    if (!hit) return { exists: false };
    const size = (hit.metadata as { size?: number } | null)?.size;
    return { exists: true, byteSize: typeof size === 'number' ? size : undefined };
  }
}
