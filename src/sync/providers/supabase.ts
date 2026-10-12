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

type DbRow = {
  user_id: string;
  entity: string;
  id: string;
  payload: unknown;
  updated_at: string;
  deleted_at: string | null;
  device_id: string | null;
};

export type SupabaseAuthOptions = {
  url: string;
  anonKey: string;
  email?: string;
  password?: string;
  /** When true, attempt signUp if signIn fails with invalid credentials */
  allowSignUp?: boolean;
};

export class SupabaseProvider implements CloudProvider {
  readonly id = 'supabase' as const;
  private client: SupabaseClient;
  private deviceId: string;

  constructor(opts: { url: string; anonKey: string; deviceId: string; client?: SupabaseClient }) {
    if (/service_role/i.test(opts.anonKey)) {
      throw new Error('Refusing to initialize Supabase client with a service_role key');
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
    const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
    if (sessionError) return { ok: false, error: sessionError.message };
    const user = sessionData.session?.user;
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
    const { data, error } = await this.client
      .from('car_care_rows')
      .select('entity,id,payload,updated_at,deleted_at,device_id')
      .eq('user_id', user.id);
    if (error) throw new Error(error.message);
    const rows: CloudRow[] = (data as DbRow[] | null)?.map(dbToCloud) ?? [];
    return { rows, pulledAt: nowISO() };
  }

  async pushOps(ops: SyncOutboxItem[]): Promise<PushResult> {
    const user = await this.requireUser();
    const applied: string[] = [];
    const conflicts: PushResult['conflicts'] = [];

    for (const op of ops) {
      try {
        if (op.op === 'delete') {
          const { error } = await this.client.from('car_care_rows').upsert(
            {
              user_id: user.id,
              entity: op.entity,
              id: op.entityId,
              payload: op.payload ?? {},
              updated_at: op.mutatedAt,
              deleted_at: op.mutatedAt,
              device_id: this.deviceId,
            },
            { onConflict: 'user_id,entity,id' },
          );
          if (error) throw error;
        } else {
          // LWW: only overwrite if cloud missing or older
          const { data: existing } = await this.client
            .from('car_care_rows')
            .select('updated_at')
            .eq('user_id', user.id)
            .eq('entity', op.entity)
            .eq('id', op.entityId)
            .maybeSingle();
          if (existing && existing.updated_at > op.mutatedAt) {
            conflicts.push({ opId: op.opId, reason: 'cloud_newer' });
            applied.push(op.opId); // drop from outbox; pull will reconcile
            continue;
          }
          const { error } = await this.client.from('car_care_rows').upsert(
            {
              user_id: user.id,
              entity: op.entity,
              id: op.entityId,
              payload: op.payload ?? {},
              updated_at: op.mutatedAt,
              deleted_at: null,
              device_id: this.deviceId,
            },
            { onConflict: 'user_id,entity,id' },
          );
          if (error) throw error;
        }
        applied.push(op.opId);
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

  async pushSnapshot(rows: CloudRow[]): Promise<PushResult> {
    const user = await this.requireUser();
    const batch = rows.map((r) => ({
      user_id: user.id,
      entity: r.entity,
      id: r.id,
      payload: r.payload,
      updated_at: r.updatedAt,
      deleted_at: r.deletedAt ?? null,
      device_id: r.deviceId ?? this.deviceId,
    }));
    // Chunk to avoid payload limits
    const chunkSize = 100;
    const applied: string[] = [];
    for (let i = 0; i < batch.length; i += chunkSize) {
      const chunk = batch.slice(i, i + chunkSize);
      const { error } = await this.client
        .from('car_care_rows')
        .upsert(chunk, { onConflict: 'user_id,entity,id' });
      if (error) return { applied, conflicts: [], error: error.message };
      for (const r of chunk) applied.push(`${r.entity}:${r.id}`);
    }
    return { applied, conflicts: [] };
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
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
