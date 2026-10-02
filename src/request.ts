import { initialBody } from './body/initial';
import { toValue } from './body/tree';
import { baseUrl, dtoName, responseFor, type OpenApiDoc, type Operation } from './openapi/spec';
import { captureObjects, getActiveApi, getState, setState, type ExecResult } from './store';

/** Name under which the request body of an operation is mapped (the DTO name, or a synthetic one for inline schemas). */
export function targetDtoOf(doc: OpenApiDoc, op: Operation): string {
  return dtoName(doc, op.requestBody?.schema).name ?? `${op.id} body`;
}

export function buildUrl(doc: OpenApiDoc, op: Operation, params: Record<string, string>): string {
  const api = getActiveApi();
  const base = api?.baseUrl.trim().replace(/\/$/, '') || baseUrl(doc, api?.specUrl ?? location.href);
  const path = op.path.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(params[`path:${name}`] ?? ''));
  const query = new URLSearchParams();
  for (const p of op.parameters) {
    const v = params[`query:${p.name}`];
    if (p.in === 'query' && v !== undefined && v !== '') query.append(p.name, v);
  }
  const qs = query.toString();
  return base + path + (qs ? `?${qs}` : '');
}

export async function execute(doc: OpenApiDoc, op: Operation): Promise<void> {
  const { useProxy, drafts } = getState();
  const api = getActiveApi();
  const draft = drafts[op.id] ?? { params: {} };
  const url = buildUrl(doc, op, draft.params);

  const headers: Record<string, string> = {};
  for (const p of op.parameters) {
    const v = draft.params[`header:${p.name}`];
    if (p.in === 'header' && v) headers[p.name] = v;
  }
  if (api?.bearerToken.trim()) headers.Authorization = `Bearer ${api.bearerToken.trim()}`;

  let body: string | undefined;
  const bodyNode = draft.body ?? initialBody(doc, op);
  if (op.requestBody && bodyNode && !['get', 'head'].includes(op.method)) {
    body = JSON.stringify(toValue(bodyNode));
    headers['Content-Type'] = op.requestBody.contentType.includes('json') ? op.requestBody.contentType : 'application/json';
  }

  // Cross-origin APIs usually lack CORS headers for this UI, so the dev server relays the request.
  const crossOrigin = new URL(url, location.href).origin !== location.origin;
  const viaProxy = useProxy && crossOrigin;
  const started = performance.now();
  let result: ExecResult;
  try {
    const res = await fetch(viaProxy ? '/__proxy' : url, {
      method: op.method.toUpperCase(),
      headers: viaProxy ? { ...headers, 'x-proxy-target': url } : headers,
      body,
    });
    const bodyText = await res.text();
    result = {
      url,
      status: res.status,
      statusText: res.statusText,
      durationMs: Math.round(performance.now() - started),
      headers: [...res.headers.entries()],
      bodyText,
    };
    try {
      result.json = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      // not JSON
    }
    if (res.ok && result.json !== undefined) result.captured = capture(doc, op, res.status, result.json);
  } catch (e) {
    result = { url, status: 0, statusText: '', durationMs: Math.round(performance.now() - started), headers: [], bodyText: '', error: String(e) };
  }
  setState((s) => ({ results: { ...s.results, [op.id]: result } }));
}

/** Stores returned DTOs in the cache, keyed by the DTO name from the documented response schema. */
function capture(doc: OpenApiDoc, op: Operation, status: number, json: unknown): ExecResult['captured'] {
  const schema = responseFor(op, status)?.schema;
  const { name } = dtoName(doc, schema);
  const dto = name ?? `${op.id} response`;
  const values = Array.isArray(json) ? json : [json];
  const count = captureObjects(dto, values, op.id);
  return count ? { dto, count } : undefined;
}
