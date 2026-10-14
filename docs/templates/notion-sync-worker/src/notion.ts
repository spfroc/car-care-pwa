import type { EntityKind, GatewayEnv, NotionPageLite } from './types.ts';

export class NotionHttpError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  body?: unknown;
  constructor(status: number, code: string, message: string, retryAfter?: number, body?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

function notionVersion(env: GatewayEnv): string {
  return env.NOTION_VERSION || '2026-03-11';
}

export async function notionFetch(
  env: GatewayEnv,
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    'Notion-Version': notionVersion(env),
    'Content-Type': 'application/json',
  };
  const res = await fetch(`https://api.notion.com${path}`, {
    method: init.method || (init.json !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const retryAfterRaw = res.headers.get('Retry-After');
  const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined;
  let body: any = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const code =
      res.status === 429
        ? 'rate_limited'
        : res.status === 404
          ? 'not_shared'
          : res.status >= 500
            ? 'notion_unavailable'
            : 'bad_request';
    throw new NotionHttpError(res.status, code, body?.message || res.statusText, retryAfter, body);
  }
  return body;
}

function richTextPlain(prop: any): string | null {
  if (!prop) return null;
  const arr = prop.title || prop.rich_text;
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.map((t: any) => t.plain_text ?? '').join('');
}

export function pageToLite(page: any): NotionPageLite {
  const props = page.properties || {};
  const amountProp = props.AmountPaid;
  const amountPaid =
    amountProp && typeof amountProp.number === 'number' ? amountProp.number : null;
  const archivedProp = props.Archived;
  const archived =
    archivedProp && typeof archivedProp.checkbox === 'boolean' ? archivedProp.checkbox : null;
  return {
    pageId: page.id,
    inTrash: !!(page.in_trash || page.archived),
    appEntityId: richTextPlain(props.AppEntityId) || '',
    appUpdatedAt: richTextPlain(props.AppUpdatedAt) || null,
    appDeletedAt: richTextPlain(props.AppDeletedAt) || null,
    deviceId: richTextPlain(props.DeviceId) || null,
    payloadJson: richTextPlain(props.PayloadJson) || null,
    name: richTextPlain(props.Name) || null,
    plate: richTextPlain(props.Plate),
    energyType: richTextPlain(props.EnergyType),
    archived,
    vehicleId: richTextPlain(props.VehicleAppId),
    recordType: richTextPlain(props.RecordType),
    recordDate: richTextPlain(props.RecordDate),
    amountPaid,
    rawProperties: props,
  };
}

export function rt(content: string) {
  return [{ type: 'text', text: { content: content.slice(0, 2000) } }];
}

export function buildProperties(entity: EntityKind, args: {
  name: string;
  appEntityId: string;
  appUpdatedAt: string;
  appDeletedAt?: string | null;
  deviceId?: string | null;
  payloadJson: string;
  payload?: Record<string, unknown>;
}) {
  const base: Record<string, unknown> = {
    Name: { title: rt(args.name || args.appEntityId) },
    AppEntityId: { rich_text: rt(args.appEntityId) },
    AppUpdatedAt: { rich_text: rt(args.appUpdatedAt) },
    AppDeletedAt: { rich_text: args.appDeletedAt ? rt(args.appDeletedAt) : [] },
    DeviceId: { rich_text: args.deviceId ? rt(args.deviceId) : [] },
    PayloadJson: { rich_text: rt(args.payloadJson) },
  };
  const p = args.payload || {};
  if (entity === 'vehicles') {
    if (typeof p.plate === 'string') base.Plate = { rich_text: rt(p.plate) };
    if (typeof p.energyType === 'string') base.EnergyType = { rich_text: rt(p.energyType) };
    if (typeof p.archived === 'boolean') base.Archived = { checkbox: p.archived };
  } else {
    if (typeof p.vehicleId === 'string') base.VehicleAppId = { rich_text: rt(p.vehicleId) };
    const rtType = (p.type || p.recordType) as string | undefined;
    if (typeof rtType === 'string') base.RecordType = { rich_text: rt(rtType) };
    const rd = (p.date || p.recordDate) as string | undefined;
    if (typeof rd === 'string') base.RecordDate = { rich_text: rt(rd) };
    if (typeof p.amountPaid === 'number') base.AmountPaid = { number: p.amountPaid };
  }
  return base;
}

export async function queryByAppEntityId(
  env: GatewayEnv,
  dataSourceId: string,
  appEntityId: string,
): Promise<NotionPageLite[]> {
  // Default query returns non-archived; trash rows typically excluded.
  const alive = await notionFetch(env, `/v1/data_sources/${dataSourceId}/query`, {
    json: {
      filter: { property: 'AppEntityId', rich_text: { equals: appEntityId } },
      page_size: 10,
    },
  });
  const pages: NotionPageLite[] = (alive.results || []).map(pageToLite);

  // Also try archived partition (is_archived) — trash may still be separate.
  try {
    const archived = await notionFetch(env, `/v1/data_sources/${dataSourceId}/query`, {
      json: {
        is_archived: true,
        filter: { property: 'AppEntityId', rich_text: { equals: appEntityId } },
        page_size: 10,
      },
    });
    for (const p of archived.results || []) {
      const lite = pageToLite(p);
      if (!pages.some((x) => x.pageId === lite.pageId)) pages.push(lite);
    }
  } catch {
    // ignore if API rejects is_archived
  }

  return pages;
}

export async function retrievePage(env: GatewayEnv, pageId: string): Promise<NotionPageLite | null> {
  try {
    const page = await notionFetch(env, `/v1/pages/${pageId}`);
    return pageToLite(page);
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export async function searchTrashByTitle(
  env: GatewayEnv,
  query: string,
): Promise<NotionPageLite[]> {
  const body = await notionFetch(env, '/v1/search', {
    json: {
      query,
      filter: { property: 'object', value: 'page', in_trash: true },
      page_size: 20,
    },
  });
  return (body.results || []).map(pageToLite);
}

export async function getBotMe(env: GatewayEnv) {
  return notionFetch(env, '/v1/users/me');
}

export async function searchDataSources(env: GatewayEnv) {
  return notionFetch(env, '/v1/search', {
    json: { filter: { property: 'object', value: 'data_source' }, page_size: 50 },
  });
}
