/**
 * Notion CloudProvider — delegates to NotionGatewayClient (D2-P1 skeleton).
 * Media object store is intentionally null (no Notion media sync in D2).
 */

import type { CloudProvider } from './types';
import type { CloudRow, CloudSnapshot, PushResult, SyncOutboxItem, VerifyResult } from '../types';
import {
  clearNotionRuntimeSession,
  getNotionRuntimeSession,
  setNotionRuntimeSession,
  type NotionRuntimeSession,
} from '../notionSession';
import { NotionGatewayClient, type GatewayFetch } from './notionGatewayClient';

export class NotionNotImplementedError extends Error {
  constructor(message = 'Notion sync is not implemented yet. See docs/notion-sync-feasibility.md') {
    super(message);
    this.name = 'NotionNotImplementedError';
  }
}

export type NotionProviderOptions = {
  gatewayUrl: string;
  /** Optional inject for tests; default reads in-memory session. */
  getSession?: () => NotionRuntimeSession | null;
  fetchImpl?: GatewayFetch;
  /** When false, verify/push throw not-configured rather than calling network. */
  requireSession?: boolean;
};

export class NotionProvider implements CloudProvider {
  readonly id = 'notion' as const;
  private client: NotionGatewayClient | null;
  private getSession: () => NotionRuntimeSession | null;
  private requireSession: boolean;

  constructor(opts?: NotionProviderOptions) {
    this.getSession = opts?.getSession ?? getNotionRuntimeSession;
    this.requireSession = opts?.requireSession ?? true;
    const url = opts?.gatewayUrl?.trim();
    if (!url) {
      this.client = null;
      return;
    }
    this.client = new NotionGatewayClient({
      baseUrl: url,
      getBearer: () => this.getSession()?.bearer ?? null,
      fetchImpl: opts?.fetchImpl,
      onUnauthorized: () => clearNotionRuntimeSession(),
    });
  }

  getMediaObjectStore() {
    return null;
  }

  async getAuthUserId(): Promise<string | null> {
    return this.getSession()?.workspaceKey ?? null;
  }

  private ensureClient(): NotionGatewayClient {
    if (!this.client) {
      throw new NotionNotImplementedError(
        '未配置 Notion Gateway URL。请在设置中填写实验性 Gateway 地址。',
      );
    }
    if (this.requireSession && !this.getSession()?.bearer) {
      throw new NotionNotImplementedError(
        '无有效 Notion 会话。请输入 Gateway API Key 后再同步。',
      );
    }
    return this.client;
  }

  async verify(signal?: AbortSignal): Promise<VerifyResult> {
    if (!this.client) {
      return {
        ok: false,
        error: 'Notion 同步尚未配置 Gateway URL。见 docs/m3d-d2-plan.md',
      };
    }
    if (this.requireSession && !this.getSession()?.bearer) {
      return {
        ok: false,
        error: '缺少 Gateway API Key（会话）。请重新输入后再验证。',
      };
    }
    const result = await this.client.verify(signal);
    if (result.ok && result.userId) {
      const prev = this.getSession();
      if (prev?.bearer) {
        setNotionRuntimeSession({
          bearer: prev.bearer,
          workspaceKey: result.userId,
          expiresAt: prev.expiresAt,
        });
      }
    }
    return result;
  }

  async pullAll(signal?: AbortSignal): Promise<CloudSnapshot> {
    return this.ensureClient().pullAll(signal);
  }

  async pushOps(ops: SyncOutboxItem[], signal?: AbortSignal): Promise<PushResult> {
    return this.ensureClient().pushOps(ops, signal);
  }

  async pushSnapshot(rows: CloudRow[], signal?: AbortSignal): Promise<PushResult> {
    return this.ensureClient().pushSnapshot(rows, signal);
  }

  async signOut(): Promise<void> {
    clearNotionRuntimeSession();
  }
}
